// Metadata only. This module never invokes Messages or enumerates workspaces.
const { spawnSync } = require('node:child_process');
const { readAnthropicCredential } = require('./hermes-pilot-profile');
const { PRIMARY } = require('./hermes-pilot-routing');

function checkAnthropicAccess({ options = {}, invoke = spawnSync } = {}) {
  const credential = readAnthropicCredential(options);
  const headers = [
    `header = "x-api-key: ${credential.apiKey}"`,
    'header = "anthropic-version: 2023-06-01"',
  ];
  if (credential.workspaceId) {
    headers.push(`header = "anthropic-workspace-id: ${credential.workspaceId}"`);
  }
  // Secrets travel over stdin, not process arguments, temporary files or logs.
  const run = invoke(
    '/usr/bin/curl',
    [
      '-q',
      '--config',
      '-',
      '--proto',
      '=https',
      '--max-time',
      '15',
      '--connect-timeout',
      '5',
      '--silent',
      '--show-error',
      '--write-out',
      '\n%{http_code}',
      `https://api.anthropic.com/v1/models/${PRIMARY.model}`,
    ],
    {
      input: `${headers.join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 18000,
    }
  );
  const report = { provider: PRIMARY.provider, model: PRIMARY.model, modelInvoked: false };
  if (run.status !== 0 || run.error) {
    return { ...report, status: 'network-unavailable', httpStatus: null };
  }
  const text = run.stdout || '';
  const split = text.lastIndexOf('\n');
  const httpStatus = Number(text.slice(split + 1));
  let body;
  try {
    body = JSON.parse(text.slice(0, split));
  } catch {
    body = null;
  }
  if (httpStatus === 200 && body?.type === 'model' && body.id === PRIMARY.model) {
    return { ...report, status: 'model-metadata-verified', httpStatus };
  }
  // Classify known failures; never expose an upstream body, stderr or key.
  let status = 'metadata-unverified';
  if (httpStatus === 400 && /anthropic-workspace-id/.test(body?.error?.message || '')) {
    status = 'workspace-required';
  } else if (httpStatus === 401) {
    status = 'authentication-rejected';
  } else if (httpStatus === 403) {
    status = 'permission-denied';
  } else if (httpStatus === 404) {
    status = 'model-or-workspace-unavailable';
  }
  return { ...report, status, httpStatus: Number.isInteger(httpStatus) ? httpStatus : null };
}

module.exports = { checkAnthropicAccess };
