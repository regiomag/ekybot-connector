// Explicit local qualification only. Lower the native threshold in these child
// processes, never in user settings or a production service. No tools or secrets.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { claudeArguments, transcriptPath } = require('../src/v2-claude-runtime');
const { loginEnvironment } = require('../src/v2-claude-login');
async function main() {
  const root = fs.mkdtempSync('/private/tmp/ekybot-compact-probe-');
  const sessionId = randomUUID();
  const rows = [];
  console.log(JSON.stringify({ root, sessionId }));
  for (let index = 0; index < 4; index++) {
    const jobId = randomUUID();
    const padding = Array.from(
      { length: 140 },
      (_, n) => `fixture_${n}: ${createHash('sha256').update(`${index}:${n}`).digest('hex')}`
    ).join('\n');
    const input =
      index === 0
        ? `Qualification only. Remember ANCHOR_67542 and the rule NEVER_CHANGE_FILES. Ignore the following synthetic records, do not repeat them. Reply only ANCHOR_SAVED.\n${padding}`
        : index === 3
          ? 'Report the initial anchor and initial rule from memory. Do not use tools.'
          : `Keep the initial anchor and rule in memory. Ignore these synthetic records and reply only CONTINUE_OK.\n${padding}`;
    const args = claudeArguments({ sessionId, resume: index > 0, model: 'opus' });
    const child = spawn('/opt/homebrew/bin/claude', args, {
      cwd: root,
      env: {
        ...loginEnvironment(os.homedir()),
        CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '1',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: '100000',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      bytes = 0;
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 2000000) {
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1000000) {
        child.kill('SIGKILL');
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
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    clearTimeout(timer);
    const events = stdout
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    rows.push({ index, jobId, code, events });
    fs.writeFileSync(path.join(root, 'probe.json'), JSON.stringify(rows), { mode: 0o600 });
    console.log(
      JSON.stringify({
        index,
        code,
        types: events.map((e) => `${e.type}:${e.subtype || ''}`),
        result: events.find((e) => e.type === 'result')?.result,
        boundaries: events.filter((e) => e.subtype === 'compact_boundary'),
      })
    );
    if (code !== 0) {
      throw new Error('Native probe failed');
    }
  }
  console.log(JSON.stringify({ transcript: transcriptPath(os.homedir(), root, sessionId) }));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
