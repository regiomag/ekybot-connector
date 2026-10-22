// One manager per process: sandbox policies must never leak between agents.
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import { spawn } from 'node:child_process';
import path from 'node:path';
import filePolicy from '../src/development-files.js';

process.once('message', async ({ root, scratch, command, args, timeoutMs }) => {
  let child;
  try {
    const protectedPaths = filePolicy.PROTECTED_NAMES.map((name) => `${root}/**/${name}`);
    const nodeRoot = path.dirname(path.dirname(process.execPath));
    await SandboxManager.initialize(
      {
        network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true },
        filesystem: {
          denyRead: ['/Users', '/private', '/Volumes', ...protectedPaths],
          allowRead: [root, scratch, nodeRoot, '/private/var/select'],
          allowWrite: [root, scratch],
          denyWrite: protectedPaths,
        },
      },
      undefined,
      false
    );
    const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      [command, ...args].map(quote).join(' '),
      '/bin/sh',
      undefined,
      undefined,
      root
    );
    child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd: root,
      detached: true,
      env: {
        ...wrapped.env,
        HOME: scratch,
        TMPDIR: scratch,
        LANG: 'en_US.UTF-8',
        PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = { stdout: '', stderr: '', truncated: false };
    for (const key of ['stdout', 'stderr']) {
      child[key].setEncoding('utf8');
      child[key].on('data', (chunk) => {
        output.truncated ||= output[key].length + chunk.length > 24000;
        output[key] = (output[key] + chunk).slice(0, 24000);
      });
    }
    let interrupted = false;
    const stop = () => {
      interrupted = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(stop, timeoutMs);
    process.once('disconnect', stop);
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    clearTimeout(timer);
    await SandboxManager.reset();
    process.send?.({ ...output, code, interrupted }, () => process.exit(0));
  } catch (error) {
    try {
      if (child?.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {}
    await SandboxManager.reset().catch(() => {});
    process.send?.(
      {
        error: `OS sandbox unavailable: ${String(error.message).slice(0, 500)}. No unsandboxed retry.`,
      },
      () => process.exit(1)
    );
  }
});
