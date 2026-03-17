const fs = require('fs');
const path = require('path');

const MEMORY_SCHEMA_VERSION = '1.2.1';
const ROOT_MEMORY_FILES = [
  'working-memory.md',
  'facts.md',
  'rules.md',
  'history.md',
  'MEMORY.md',
];

function safeReadText(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function safeReadJson(filePath) {
  const content = safeReadText(filePath);
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function writeFileAtomic(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp.${process.pid}`;
  const fd = fs.openSync(tempPath, 'w');
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, targetPath);
}

class OpenClawMemoryRuntime {
  constructor(configManager, options = {}) {
    this.configManager = configManager;
    this.now = options.now || (() => new Date());
  }

  getMemoryRoot(workspacePath) {
    return path.join(workspacePath, 'memory');
  }

  getContextIndexPath(workspacePath) {
    return path.join(workspacePath, 'context-index.json');
  }

  buildContextIndex({ agent, workspacePath }) {
    const now = this.now();
    const files = [];

    for (const filename of ROOT_MEMORY_FILES) {
      const fullPath = path.join(workspacePath, filename);
      if (!fs.existsSync(fullPath)) {
        continue;
      }
      const stat = fs.statSync(fullPath);
      files.push({
        key: filename,
        path: filename,
        updated_at: stat.mtime.toISOString(),
        freshness: 'fresh',
      });
    }

    const memoryRoot = this.getMemoryRoot(workspacePath);
    const summariesDir = path.join(memoryRoot, 'summaries');
    let lastSummary = null;
    if (fs.existsSync(summariesDir)) {
      const summaryFiles = fs
        .readdirSync(summariesDir)
        .filter((entry) => entry.endsWith('.md'))
        .map((entry) => {
          const fullPath = path.join(summariesDir, entry);
          const stat = fs.statSync(fullPath);
          return {
            path: `memory/summaries/${entry}`,
            created_at: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      lastSummary = summaryFiles[0] || null;
    }

    return {
      schema_version: MEMORY_SCHEMA_VERSION,
      updated_at: now.toISOString(),
      project_id: agent.projectKey || null,
      agent_id: agent.externalId,
      agent_name: agent.name,
      mode: 'project',
      active_sources: {
        working_memory: files.find((file) => file.key === 'working-memory.md') || null,
        facts: files.find((file) => file.key === 'facts.md') || null,
        rules: files.find((file) => file.key === 'rules.md') || null,
        last_summary: lastSummary,
      },
      runtime: {
        session_only: false,
        divergence_detected: false,
      },
      inject: {
        next_actions: [],
        blockers: [],
        critical_rules: [],
      },
    };
  }

  ensureContextIndex({ agent, workspacePath }) {
    const contextIndexPath = this.getContextIndexPath(workspacePath);
    const nextIndex = this.buildContextIndex({ agent, workspacePath });
    const currentIndex = safeReadJson(contextIndexPath);

    if (JSON.stringify(currentIndex) !== JSON.stringify(nextIndex)) {
      writeFileAtomic(contextIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`);
    }

    return contextIndexPath;
  }

  collectFilesForAgent(agent) {
    const workspacePath = agent.workspacePath
      ? this.configManager.resolveHomePath(agent.workspacePath)
      : null;
    if (!workspacePath || !fs.existsSync(workspacePath)) {
      return null;
    }

    this.ensureContextIndex({ agent, workspacePath });

    const files = [];
    for (const filename of ROOT_MEMORY_FILES) {
      const fullPath = path.join(workspacePath, filename);
      const content = safeReadText(fullPath);
      if (content !== null) {
        files.push({ filename, content });
      }
    }

    const contextIndexContent = safeReadText(this.getContextIndexPath(workspacePath));
    if (contextIndexContent !== null) {
      files.push({ filename: 'context-index.json', content: contextIndexContent });
    }

    const summariesDir = path.join(this.getMemoryRoot(workspacePath), 'summaries');
    if (fs.existsSync(summariesDir)) {
      const summaries = fs
        .readdirSync(summariesDir)
        .filter((entry) => entry.endsWith('.md'))
        .sort()
        .slice(-3);

      for (const entry of summaries) {
        const content = safeReadText(path.join(summariesDir, entry));
        if (content !== null) {
          files.push({ filename: `memory/summaries/${entry}`, content });
        }
      }
    }

    return {
      openclawAgentId: agent.externalId,
      files,
    };
  }

  buildMachineMemorySyncPayload() {
    const agents = this.configManager
      .listAgents()
      .map((agent) => this.collectFilesForAgent(agent))
      .filter((entry) => entry && Array.isArray(entry.files) && entry.files.length > 0);

    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      agents,
    };
  }
}

module.exports = OpenClawMemoryRuntime;
