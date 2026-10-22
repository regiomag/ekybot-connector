const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { openCodexChatConnection } = require('./v2-codex-connection');
const { claudeArguments } = require('./v2-claude-runtime');
const { loginEnvironment, readClaudeStatus } = require('./v2-claude-login');
const { readPrivateJson, writeDurableJson } = require('./hermes-resume-guard');
const { validModel } = require('./native-model-id');
function normalizeModels(rows, engine) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100)
    throw new Error('Invalid native catalog');
  const models = rows
    .filter((r) => !r.hidden)
    .map((r) => ({
      id: engine === 'codex' ? r.model : r.value,
      label: engine === 'codex' ? r.displayName : r.displayName,
      resolved: engine === 'codex' ? r.model : r.resolvedModel || r.value,
      isDefault: engine === 'codex' ? r.isDefault === true : r.value === 'default',
    }));
  if (
    models.some(
      (m) =>
        !validModel(m.id) ||
        !validModel(m.resolved) ||
        typeof m.label !== 'string' ||
        m.label.length > 120
    ) ||
    new Set(models.map((m) => m.id)).size !== models.length
  )
    throw new Error('Invalid native catalog');
  return models;
}
async function codexModels({ cwd, home }) {
  const c = await openCodexChatConnection({ cwd, home });
  try {
    const rows = [];
    let cursor = null;
    do {
      const r = await c.rpc.request('model/list', { limit: 100, includeHidden: false, cursor });
      rows.push(...r.data);
      if (rows.length > 100) throw new Error('Catalog too large');
      if (r.nextCursor && r.nextCursor === cursor) throw new Error('Catalog cursor repeated');
      cursor = r.nextCursor;
    } while (cursor);
    return normalizeModels(rows, 'codex');
  } finally {
    c.rpc.close();
  }
}
async function claudeModels({ cwd, home }) {
  if (!(await readClaudeStatus(home)).connected) throw new Error('Claude not connected');
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let buffer = '',
      bytes = 0,
      result,
      failed = false;
    const child = spawn(
      '/opt/homebrew/bin/claude',
      [...claudeArguments({ sessionId: randomUUID(), resume: false }), '--no-session-persistence'],
      {
        cwd,
        env: {
          ...loginEnvironment(home),
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          DISABLE_AUTOUPDATER: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const stop = () => {
      failed = true;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(stop, 15000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Catalog unavailable'));
    });
    child.stdin.on('error', stop);
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1000000) stop();
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk);
      buffer += chunk;
      if (bytes > 1000000) return stop();
      for (let i; (i = buffer.indexOf('\n')) >= 0 && !failed;) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (
            e.type !== 'control_response' ||
            e.response?.request_id !== requestId ||
            e.response.subtype !== 'success' ||
            result
          )
            throw new Error();
          result = normalizeModels(e.response.response.models, 'claude');
          child.stdin.end();
        } catch {
          stop();
        }
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0 || !result || buffer.trim())
        reject(new Error('Catalog unavailable'));
      else resolve(result);
    });
    // Control initialization only. No user message, thread turn or model request.
    child.stdin.write(
      JSON.stringify({
        type: 'control_request',
        request_id: requestId,
        request: { subtype: 'initialize' },
      }) + '\n'
    );
  });
}
async function discoverModels({
  stateDir,
  home,
  discover = { codex: codexModels, claude: claudeModels },
}) {
  const file = path.join(stateDir, 'model-catalog.json');
  if (fs.existsSync(file)) {
    const cached = readPrivateJson(file);
    if (cached.version === 1 && Date.now() - Date.parse(cached.at) < 300000) return cached;
  }
  const entries = await Promise.all(
    Object.entries(discover).map(async ([engine, read]) => {
      try {
        return { engine, status: 'available', models: await read({ cwd: stateDir, home }) };
      } catch {
        return { engine, status: 'unavailable', models: [] };
      }
    })
  );
  const result = { version: 1, at: new Date().toISOString(), entries };
  writeDurableJson(file, result);
  return result;
}
module.exports = { validModel, normalizeModels, codexModels, claudeModels, discoverModels };
