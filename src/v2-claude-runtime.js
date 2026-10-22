const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { loginEnvironment, readClaudeStatus } = require('./v2-claude-login');
const { assertNoSymlinkChain, assertPrivate } = require('./hermes-fresh-profile');
const { validSessionId } = require('./v2-codex-runtime');
const { policy: bmtPolicy } = require('./bmt-policy');

const fail = () => new Error('Claude native conversation could not be verified.');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const POLICY = 'claude-chat-v1';
const SYSTEM =
  'You are Claude Code, connected to Ekybot. This isolated conversation has no tools, file access, browser, BMT connection or delegation. Answer honestly about those limits. Do not claim to have executed actions. No old chat or memory is imported.';

function claudeArguments({ sessionId, resume, bmt = false, development, model }) {
  if (!validSessionId(sessionId)) {
    throw fail();
  }
  return [
    ...(model ? ['--model', model] : []),
    '--print',
    '--verbose',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    // --bare disables subscription/keychain authentication; do not use it.
    '--replay-user-messages',
    ...(development ? [] : ['--safe-mode']),
    '--restricted',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({
      mcpServers: development
        ? {
            ekybot: {
              command: process.execPath,
              args: [path.resolve(__dirname, '../scripts/development-mcp.js')],
              env: {
                EKYBOT_TOOL_SOCKET: development.connection.socketPath,
                EKYBOT_TOOL_TOKEN: development.connection.token,
              },
            },
          }
        : {},
    }),
    ...(development
      ? ['--allowedTools', ...development.tools.map((t) => `mcp__ekybot__${t.name}`)]
      : []),
    '--setting-sources',
    '',
    '--settings',
    '{"disableAllHooks":true,"autoMemoryEnabled":false}',
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--disable-slash-commands',
    '--no-chrome',
    '--max-turns',
    development ? '40' : '1',
    '--effort',
    'low',
    '--system-prompt',
    development ? development.instructions : bmt ? bmtPolicy : SYSTEM,
    resume ? '--resume' : '--session-id',
    sessionId,
  ];
}

function assertInitialization(event, cwd, sessionId, development) {
  const expectedTools = development?.tools.map((t) => `mcp__ekybot__${t.name}`).sort() || [];
  if (
    event.session_id !== sessionId ||
    event.cwd !== cwd ||
    event.claude_code_version !== '2.1.285' ||
    event.permissionMode !== 'dontAsk' ||
    event.apiKeySource !== 'none' ||
    !Array.isArray(event.tools) ||
    JSON.stringify([...event.tools].sort()) !== JSON.stringify(expectedTools) ||
    !Array.isArray(event.mcp_servers) ||
    (development
      ? event.mcp_servers.length !== 1 ||
        event.mcp_servers[0].name !== 'ekybot' ||
        event.mcp_servers[0].status !== 'connected'
      : event.mcp_servers.length !== 0) ||
    !Array.isArray(event.plugins) ||
    event.plugins.some((p) => p.name !== 'cc-plugin-agents-md' || p.path !== 'builtin') ||
    event.skills?.length ||
    event.slash_commands?.length
  ) {
    throw fail();
  }
}

function transcriptPath(home, cwd, sessionId) {
  if (
    ![home, cwd].every((p) => typeof p === 'string' && path.isAbsolute(p)) ||
    !validSessionId(sessionId)
  ) {
    throw fail();
  }
  return path.join(
    home,
    '.claude',
    'projects',
    cwd.replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`
  );
}

function readTranscript(home, cwd, sessionId, development = false) {
  const file = transcriptPath(home, cwd, sessionId);
  assertNoSymlinkChain(file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || stat.uid !== process.getuid()) {
    throw fail();
  }
  const rows = fs
    .readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (rows.some((row) => row.sessionId && row.sessionId !== sessionId)) {
    throw fail();
  }
  const messages = rows.filter((row) => ['user', 'assistant'].includes(row.type));
  if (
    !messages.length ||
    messages.some(
      (row) =>
        row.cwd !== cwd ||
        row.isSidechain !== false ||
        !validSessionId(row.uuid) ||
        row.sessionId !== sessionId ||
        row.version !== '2.1.285' ||
        !row.message ||
        row.message.role !== row.type ||
        (Array.isArray(row.message.content) &&
          row.message.content.some(
            (p) =>
              !(
                development ? ['text', 'thinking', 'tool_use', 'tool_result'] : ['text', 'thinking']
              ).includes(p.type)
          ))
    )
  ) {
    throw fail();
  }
  return { messages, identity: `${stat.dev}:${stat.ino}`, file };
}

function textContent(content) {
  return typeof content === 'string'
    ? content
    : content
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
}

function assertClaudeContinuation(before, after) {
  if (
    before.sessionId !== after.sessionId ||
    before.cwd !== after.cwd ||
    before.identity !== after.identity ||
    after.messages.length <= before.messages.length ||
    after.users !== before.users + 1 ||
    JSON.stringify(before.messages) !==
      JSON.stringify(after.messages.slice(0, before.messages.length))
  ) {
    throw fail();
  }
}

class ClaudeConversationRuntime {
  constructor({
    cwd,
    home,
    status = readClaudeStatus,
    spawnImpl = spawn,
    timeoutMs = 120000,
    bmt = false,
    development,
    model,
  }) {
    if (![cwd, home].every((p) => typeof p === 'string' && path.isAbsolute(p))) {
      throw fail();
    }
    if (model && !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) throw fail();
    Object.assign(this, { cwd, home, status, spawnImpl, timeoutMs, bmt, development, model });
  }

  inspectSession({ sessionId }) {
    const { messages, identity } = readTranscript(
      this.home,
      this.cwd,
      sessionId,
      !!this.development
    );
    if (
      messages.at(-1).type !== 'assistant' ||
      messages.at(-1).message.stop_reason !== 'end_turn'
    ) {
      throw fail();
    }
    return {
      sessionId,
      cwd: this.cwd,
      identity,
      users: messages.filter(
        (m) =>
          m.type === 'user' &&
          !(
            Array.isArray(m.message.content) &&
            m.message.content.some((p) => p.type === 'tool_result')
          )
      ).length,
      messages: messages.map((row) => ({ uuid: row.uuid, hash: hash(JSON.stringify(row)) })),
    };
  }

  async execute({ input, sessionId, jobId }) {
    if (
      !validSessionId(jobId) ||
      typeof input !== 'string' ||
      !input.trim() ||
      input.length > 12000 ||
      (sessionId !== null && !validSessionId(sessionId))
    ) {
      throw fail();
    }
    assertNoSymlinkChain(this.cwd);
    assertPrivate(this.cwd, true);
    if (!(await this.status(this.home)).connected) {
      throw fail();
    }
    const id = sessionId || crypto.randomUUID();
    if (!sessionId && fs.existsSync(transcriptPath(this.home, this.cwd, id))) {
      throw fail();
    }
    const before = sessionId ? this.inspectSession({ sessionId }) : null;
    const result = await this.run({ input, jobId, sessionId: id, resume: !!sessionId });
    const saved = readTranscript(this.home, this.cwd, id, !!this.development);
    const lastUser = saved.messages.findLastIndex(
      (row) =>
        row.type === 'user' &&
        !(
          Array.isArray(row.message.content) &&
          row.message.content.some((p) => p.type === 'tool_result')
        )
    );
    const user = saved.messages[lastUser];
    const answers = saved.messages.slice(lastUser + 1);
    if (
      user?.uuid !== jobId ||
      textContent(user.message.content) !== input ||
      !answers.length ||
      (!this.development && answers.some((row) => row.type !== 'assistant')) ||
      answers.at(-1).message.stop_reason !== 'end_turn' ||
      (this.development
        ? textContent(answers.at(-1).message.content)
        : answers.map((row) => textContent(row.message.content)).join('')) !== result
    ) {
      throw fail();
    }
    const after = this.inspectSession({ sessionId: id });
    if (before) {
      assertClaudeContinuation(before, after);
    } else if (after.users !== 1) {
      throw fail();
    }
    return { sessionId: id, output: result };
  }

  run({ input, jobId, sessionId, resume }) {
    return new Promise((resolve, reject) => {
      let bytes = 0,
        buffer = '',
        initialized = false,
        acknowledged = false,
        final,
        failed = false;
      const child = this.spawnImpl(
        '/opt/homebrew/bin/claude',
        claudeArguments({
          sessionId,
          resume,
          bmt: this.bmt,
          development: this.development,
          model: this.model,
        }),
        {
          cwd: this.cwd,
          env: {
            ...loginEnvironment(this.home),
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            DISABLE_AUTOUPDATER: '1',
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
            ENABLE_TOOL_SEARCH: 'false',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      const stop = () => {
        failed = true;
        child.kill('SIGKILL');
      };
      const timer = setTimeout(stop, this.timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        reject(fail());
      });
      child.stdin.on('error', stop);
      child.stderr.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          stop();
        }
      });
      // Preserve UTF-8 characters when a CLI acknowledgement spans pipe chunks.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        buffer += chunk;
        if (bytes > 1024 * 1024) {
          stop();
          return;
        }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0 && !failed) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) {
            continue;
          }
          try {
            const event = JSON.parse(line);
            if (event.session_id && event.session_id !== sessionId) {
              throw fail();
            }
            if (event.type === 'system' && event.subtype === 'init') {
              if (initialized) {
                throw fail();
              }
              assertInitialization(event, this.cwd, sessionId, this.development);
              initialized = true;
            } else if (event.type === 'user') {
              if (
                this.development &&
                Array.isArray(event.message?.content) &&
                event.message.content.every((p) => p.type === 'tool_result')
              ) {
                continue;
              }
              if (
                !initialized ||
                acknowledged ||
                event.uuid !== jobId ||
                textContent(event.message.content) !== input
              ) {
                throw fail();
              }
              acknowledged = true;
            } else if (event.type === 'result') {
              if (
                !initialized ||
                !acknowledged ||
                final !== undefined ||
                event.subtype !== 'success' ||
                event.is_error ||
                (this.development
                  ? event.num_turns < 1 || event.num_turns > 40
                  : event.num_turns !== 1) ||
                event.permission_denials?.length ||
                event.user_message_uuid !== jobId ||
                typeof event.result !== 'string' ||
                !event.result.trim() ||
                event.result.length > 50000
              ) {
                throw fail();
              }
              final = event.result;
            } else if (event.type === 'assistant') {
              if (
                !initialized ||
                event.parent_tool_use_id ||
                event.message.content.some(
                  (p) =>
                    !(
                      this.development ? ['text', 'thinking', 'tool_use'] : ['text', 'thinking']
                    ).includes(p.type) ||
                    (p.type === 'tool_use' &&
                      !this.development.tools.some((t) => p.name === `mcp__ekybot__${t.name}`))
                )
              ) {
                throw fail();
              }
            } else if (
              !(
                this.development
                  ? ['command_lifecycle', 'rate_limit_event', 'tool_progress', 'tool_use_summary']
                  : ['command_lifecycle', 'rate_limit_event']
              ).includes(event.type)
            ) {
              throw fail();
            }
          } catch {
            stop();
          }
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failed || code !== 0 || buffer.trim() || final === undefined) {
          reject(fail());
        } else {
          resolve(final);
        }
      });
      child.stdin.end(
        JSON.stringify({
          type: 'user',
          uuid: jobId,
          session_id: sessionId,
          parent_tool_use_id: null,
          message: { role: 'user', content: input },
        }) + '\n'
      );
    });
  }
}
module.exports = {
  POLICY,
  ClaudeConversationRuntime,
  claudeArguments,
  assertInitialization,
  transcriptPath,
  readTranscript,
  assertClaudeContinuation,
};
