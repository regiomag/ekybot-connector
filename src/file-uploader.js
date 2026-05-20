/**
 * File Uploader for Agent Responses
 *
 * Detects [FILE:/path/to/file] markers in agent responses,
 * uploads them to Vercel Blob via /api/upload, and returns
 * the file metadata for message attachment.
 *
 * Convention: agents include [FILE:/absolute/path/to/file.ext] in their response.
 * The marker is replaced by a download link in the message text.
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const FILE_MARKER_REGEX = /\[FILE:(\/[^\]]+)\]/g;
const UPLOAD_TIMEOUT_MS = 30_000;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

/**
 * Detect [FILE:/path] markers in text.
 * @param {string} text
 * @returns {string[]} Array of absolute file paths
 */
function detectFileMarkers(text) {
  if (!text) return [];
  const matches = [];
  let match;
  while ((match = FILE_MARKER_REGEX.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

/**
 * Upload a local file to the Ekybot upload API.
 * @param {string} filePath - Absolute path to the file
 * @param {string} uploadUrl - Base URL of the Ekybot app
 * @returns {Promise<{url: string, filename: string, size: number, mimeType: string} | null>}
 */
async function uploadFile(filePath, uploadUrl) {
  if (!fs.existsSync(filePath)) {
    console.warn(chalk.yellow(`[file-upload] File not found: ${filePath}`));
    return null;
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    console.warn(chalk.yellow(`[file-upload] File too large (${stat.size} bytes): ${filePath}`));
    return null;
  }

  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  // Map extension to MIME type
  const mimeMap = {
    '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
    '.csv': 'text/csv', '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
    '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript',
    '.html': 'text/html', '.css': 'text/css', '.xml': 'text/xml',
    '.yaml': 'text/yaml', '.yml': 'text/yaml',
    '.sql': 'text/plain', '.sh': 'text/plain', '.log': 'text/x-log',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', blob, filename);

    const agentToken = (process.env.AGENT_TOKEN || '').trim();
    const url = `${uploadUrl}/api/upload`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-agent-token': agentToken,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.warn(chalk.yellow(`[file-upload] Upload failed (${response.status}): ${errText}`));
      return null;
    }

    const result = await response.json();
    console.log(chalk.green(`[file-upload] Uploaded ${filename} → ${result.url} (${stat.size} bytes)`));

    return {
      url: result.url,
      filename,
      size: stat.size,
      mimeType,
    };
  } catch (err) {
    console.warn(chalk.yellow(`[file-upload] Upload error for ${filePath}: ${err.message}`));
    return null;
  }
}

/**
 * Process agent response: detect [FILE:...] markers, upload files,
 * replace markers with download links, return files metadata.
 *
 * @param {string} content - Agent response text
 * @param {string} uploadUrl - Base URL of the Ekybot app
 * @returns {Promise<{content: string, files: Array}>}
 */
async function processFileAttachments(content, uploadUrl) {
  const filePaths = detectFileMarkers(content);
  if (filePaths.length === 0) {
    return { content, files: [] };
  }

  const files = [];
  let processedContent = content;

  for (const filePath of filePaths) {
    const uploaded = await uploadFile(filePath, uploadUrl);
    if (uploaded) {
      files.push(uploaded);
      // Replace [FILE:/path] with a clean link
      processedContent = processedContent.replace(
        `[FILE:${filePath}]`,
        `📎 [${uploaded.filename}](${uploaded.url})`
      );
    } else {
      // Remove failed marker
      processedContent = processedContent.replace(
        `[FILE:${filePath}]`,
        `⚠️ Fichier non trouvé: ${path.basename(filePath)}`
      );
    }
  }

  return { content: processedContent, files };
}

module.exports = { detectFileMarkers, uploadFile, processFileAttachments };
