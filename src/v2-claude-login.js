const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const CLAUDE = '/opt/homebrew/bin/claude';
const VERSION = '2.1.285 (Claude Code)';

// This is a browser launcher for the UNMODIFIED official CLI, not an OAuth
// implementation. The CLI owns PKCE, its callback and its credential storage.
function validateAuthorizeUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) {
    throw new Error('Invalid authorize URL');
  }
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !(
      (url.hostname === 'claude.com' && url.pathname === '/cai/oauth/authorize') ||
      (url.hostname === 'claude.ai' && url.pathname === '/oauth/authorize')
    )
  ) {
    throw new Error('Unexpected identity provider');
  }
  for (const key of [
    'client_id',
    'response_type',
    'redirect_uri',
    'state',
    'code_challenge',
    'code_challenge_method',
  ]) {
    if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)) {
      throw new Error('Missing authorization parameter');
    }
  }
  if (
    url.searchParams.get('response_type') !== 'code' ||
    url.searchParams.get('code_challenge_method') !== 'S256' ||
    ['access_token', 'refresh_token', 'token', 'api_key'].some((key) => url.searchParams.has(key))
  ) {
    throw new Error('Invalid authorization flow');
  }
  const callback = new URL(url.searchParams.get('redirect_uri'));
  if (
    callback.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(callback.hostname) ||
    !callback.port ||
    callback.pathname !== '/callback' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  ) {
    throw new Error('Local official callback required');
  }
  return url.href;
}

function loginEnvironment(home) {
  if (!path.isAbsolute(home)) {
    throw new Error('Explicit home required');
  }
  // Never inherit an API key, profile, OAuth token or third-party provider URL.
  return { HOME: home, PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'en_US.UTF-8' };
}

async function readClaudeStatus(home, run = exec) {
  const options = { env: loginEnvironment(home), timeout: 15000, maxBuffer: 65536 };
  const version = await run(CLAUDE, ['--version'], options);
  if (version.stdout.trim() !== VERSION) {
    throw new Error('Claude version requires qualification');
  }
  let result;
  try {
    result = await run(CLAUDE, ['auth', 'status', '--json'], options);
  } catch (error) {
    if (error.code !== 1 || !error.stdout) {
      throw new Error('Claude status unavailable');
    }
    result = error;
  }
  const status = JSON.parse(result.stdout);
  return {
    connected: status.loggedIn === true && status.authMethod === 'claude.ai',
    otherAuth: status.loggedIn === true && status.authMethod !== 'claude.ai',
  };
}

async function loginClaude({
  home,
  directory,
  onAuthorize,
  ttlMs = 8 * 60 * 1000,
  spawnImpl = spawn,
  status = readClaudeStatus,
}) {
  const initial = await status(home);
  if (initial.connected) {
    return { status: 'authenticated', reason: null };
  }
  if (initial.otherAuth) {
    return { status: 'failed', reason: 'different_auth_method' };
  }
  const urlFile = path.join(directory, 'authorize-url');
  if (fs.existsSync(urlFile)) {
    throw new Error('Fresh login directory required');
  }
  return new Promise((resolve) => {
    let child,
      finished = false,
      published = false,
      publishPromise,
      outputBytes = 0;
    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      watcher.close();
      child?.kill('SIGTERM');
      const hardStop = setTimeout(() => {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000);
      hardStop.unref();
      // This file holds only the short-lived authorize URL, never credentials.
      if (fs.existsSync(urlFile)) {
        fs.unlinkSync(urlFile);
      }
      resolve(result);
    };
    const watcher = fs.watch(directory, (_event, filename) => {
      if (finished || published || filename !== 'authorize-url' || !fs.existsSync(urlFile)) {
        return;
      }
      published = true;
      publishPromise = (async () => {
        const info = fs.lstatSync(urlFile);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 8192 || info.mode & 0o077) {
          throw new Error('Unsafe login URL');
        }
        await onAuthorize(validateAuthorizeUrl(fs.readFileSync(urlFile, 'utf8')));
      })();
      publishPromise.catch(() => finish({ status: 'failed', reason: 'authorization_unavailable' }));
    });
    watcher.on('error', () => finish({ status: 'failed', reason: 'authorization_unavailable' }));
    const timer = setTimeout(
      () => finish({ status: 'expired', reason: 'authorization_expired' }),
      ttlMs
    );
    try {
      child = spawnImpl(CLAUDE, ['auth', 'login', '--claudeai'], {
        cwd: directory,
        env: {
          ...loginEnvironment(home),
          BROWSER: path.join(__dirname, '../scripts/v2-claude-browser.js'),
          EKYBOT_AUTH_URL_FILE: urlFile,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Do not forward CLI output: it may contain account details. No prompt,
      // token or paste-code input is accepted by the companion or the cloud.
      const discard = (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > 65536) {
          finish({ status: 'failed', reason: 'authorization_unavailable' });
        }
      };
      child.stdout.on('data', discard);
      child.stderr.on('data', discard);
      child.on('error', () => finish({ status: 'failed', reason: 'authorization_unavailable' }));
      child.on('exit', async () => {
        if (finished) {
          return;
        }
        try {
          await publishPromise;
          const result = await status(home);
          finish(
            result.connected
              ? { status: 'authenticated', reason: null }
              : { status: 'failed', reason: 'authorization_not_confirmed' }
          );
        } catch {
          finish({ status: 'failed', reason: 'authorization_not_confirmed' });
        }
      });
    } catch {
      finish({ status: 'failed', reason: 'authorization_unavailable' });
    }
  });
}
module.exports = { validateAuthorizeUrl, loginEnvironment, readClaudeStatus, loginClaude };
