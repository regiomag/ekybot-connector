// One isolated native process per admitted job. No CLI discovery or inherited env.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { planFreshProfile, assertNoSymlinkChain, assertPrivate } = require('./hermes-fresh-profile');
const { configurePilotProfile, readAnthropicCredential } = require('./hermes-pilot-profile');
const { buildPilotExecutionConfig } = require('./hermes-pilot-routing');
const { readPrivateJson, writeDurableJson } = require('./hermes-resume-guard');
const { HermesPilotJournal } = require('./hermes-pilot-journal');

const ACTIVE_FILE = '.ekybot-pilot-active.json';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CORE = [
  'run_agent.py',
  'hermes_state.py',
  'hermes_constants.py',
  'agent/agent_init.py',
  'agent/conversation_loop.py',
  'agent/chat_completion_helpers.py',
  'agent/anthropic_adapter.py',
  'agent/anthropic_credentials.py',
  'agent/codex_runtime.py',
  'hermes_cli/auth.py',
];
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = () => new Error('Pilot activation or native execution could not be verified.');

function runtimeFingerprint(runtime) {
  assertNoSymlinkChain(runtime);
  // Never execute the mutable legacy checkout or inherit its dotenv file.
  if (
    !path.isAbsolute(runtime) ||
    fs.existsSync(path.join(runtime, '.env')) ||
    fs.existsSync(path.join(runtime, '.git'))
  ) {
    throw fail();
  }
  return hash(
    CORE.map((name) => {
      const file = path.join(runtime, name);
      assertNoSymlinkChain(file);
      return `${name}:${hash(fs.readFileSync(file))}`;
    }).join('\n')
  );
}

function activatePilot({ channelId, runtime, packages, python, ...options }) {
  if (!UUID.test(channelId || '') || ![runtime, packages, python].every(path.isAbsolute)) {
    throw fail();
  }
  const plan = planFreshProfile(options);
  const destination = path.join(plan.home, ACTIVE_FILE);
  if (fs.existsSync(destination)) {
    throw fail();
  } // Never silently replace an activation.
  const fingerprint = runtimeFingerprint(runtime);
  configurePilotProfile({ ...options, routingMode: 'openai-primary' });
  const config = buildPilotExecutionConfig({ ...options, routingMode: 'openai-primary' });
  writeDurableJson(path.join(plan.home, 'config.yaml'), config);
  writeDurableJson(destination, {
    version: 1,
    executionAllowed: true,
    channelId,
    runtime,
    packages,
    python,
    fingerprint,
    configHash: hash(JSON.stringify(config)),
    activatedAt: new Date().toISOString(),
  });
  return { status: 'activated-chat-only', channelId, modelInvoked: false };
}

function readActivation(options = {}) {
  const plan = planFreshProfile(options);
  assertPrivate(plan.home, true);
  const active = readPrivateJson(path.join(plan.home, ACTIVE_FILE));
  if (
    active.version !== 1 ||
    active.executionAllowed !== true ||
    !UUID.test(active.channelId) ||
    active.fingerprint !== runtimeFingerprint(active.runtime) ||
    active.configHash !== hash(JSON.stringify(readPrivateJson(path.join(plan.home, 'config.yaml'))))
  ) {
    throw fail();
  }
  return { plan, active };
}

function readOpenAICredential(home) {
  const auth = readPrivateJson(path.join(home, 'auth.json'))?.providers?.['openai-codex'];
  const token = auth?.tokens?.access_token;
  if (
    auth?.auth_mode !== 'chatgpt' ||
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_.-]{30,20000}$/.test(token)
  ) {
    throw fail();
  }
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(accountId || '')) {
    throw fail();
  }
  return { apiKey: token, accountId };
}

function invokeNative({ plan, active, job, credential, fallbackCredential }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      active.python,
      ['-I', '-B', '-S', path.resolve(__dirname, '../scripts/hermes-pilot-native-probe.py')],
      {
        cwd: plan.workspace,
        env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    let output = '';
    let failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill('SIGKILL');
    }, 120000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(fail());
    });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 300000) {
        failed = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.resume(); // Native diagnostics can contain requests: never publish them.
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed || code !== 0) {
        return reject(fail());
      }
      try {
        const result = JSON.parse(output);
        if (result.offline !== false || ![1, 2].includes(result.modelRequests)) {
          throw fail();
        }
        resolve(result);
      } catch {
        reject(fail());
      }
    });
    child.stdin.end(
      JSON.stringify({
        home: plan.home,
        runtime: active.runtime,
        packages: active.packages,
        offline: false,
        provider: 'openai-codex',
        allowFallback: true,
        credential,
        fallbackCredential,
        ...job,
      })
    );
  });
}

function createPilotJournal(options = {}) {
  const { plan, active } = readActivation(options);
  return new HermesPilotJournal({
    stateDir: path.join(plan.home, 'pilot-journal'),
    channelId: active.channelId,
    profile: plan.profile,
    homeRoot: plan.root,
    assertFresh: () => {
      if (fs.existsSync(path.join(plan.home, 'state.db'))) {
        throw fail();
      }
      for (const file of ['memories/MEMORY.md', 'memories/USER.md']) {
        if (fs.statSync(path.join(plan.home, file)).size) {
          throw fail();
        }
      }
    },
    execute: (job) => {
      const verified = readActivation(options);
      return invokeNative({
        ...verified,
        job,
        credential: readOpenAICredential(plan.home),
        fallbackCredential: readAnthropicCredential(options),
      });
    },
  });
}

module.exports = { activatePilot, readActivation, createPilotJournal, runtimeFingerprint };
