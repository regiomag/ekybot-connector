const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tools, validateTool } = require('./development-tools');
const {
  readFile,
  listDirectory,
  editFile,
  digest,
  redact,
  permittedPath,
} = require('./development-files');
const { runSandboxed } = require('./development-command');
const { git } = require('./development-projects');
const { readPrivateJson, writeDurableJson, HermesResumeGuard } = require('./hermes-resume-guard');

class DevelopmentBroker {
  constructor({
    root,
    stateDir,
    runId,
    role,
    projects,
    approve,
    event = async () => {},
    delegate,
    cancelled = async () => false,
    runCommand = runSandboxed,
  }) {
    if (
      !path.isAbsolute(root) ||
      !/^[a-f0-9-]{36}$/.test(runId) ||
      !['developer', 'orchestrator'].includes(role) ||
      typeof approve !== 'function'
    ) {
      throw new Error('Invalid broker binding');
    }
    Object.assign(this, {
      root,
      stateDir,
      runId,
      role,
      projects,
      approve,
      event,
      delegate,
      cancelled,
      runCommand,
    });
    new HermesResumeGuard({ stateDir }).ensureDirectory();
    this.policy = { root, orchestrator: role === 'orchestrator', deniedRoots: [stateDir] };
    this.queue = Promise.resolve();
    this.calls = 0;
    this.uncertain = fs
      .readdirSync(stateDir)
      .filter((file) => /^[a-f0-9-]{36}\.json$/.test(file))
      .some((file) => {
        const record = readPrivateJson(path.join(stateDir, file));
        return record.runId === runId && ['started', 'uncertain'].includes(record.status);
      });
  }
  definitions() {
    return tools.filter((t) => {
      if (t.name === 'ekybot_delegate') {
        return this.role === 'orchestrator' && typeof this.delegate === 'function';
      }
      if (t.name === 'ekybot_exec') {
        return this.runCommand !== runSandboxed;
      }
      return true;
    });
  }
  call(name, input, callId = crypto.randomUUID()) {
    // Serialize effects in a working copy even if a native engine calls tools
    // concurrently. A denied/cancelled action does not stall unrelated reads.
    const result = this.queue.then(() => this.perform(name, input, callId));
    this.queue = result.catch(() => {});
    return result;
  }
  async perform(name, input, callId) {
    validateTool(name, input);
    if (typeof callId !== 'string' || !callId || callId.length > 200 || ++this.calls > 80) {
      throw new Error('Development tool budget reached');
    }
    if (redact(JSON.stringify(input)) !== JSON.stringify(input)) {
      throw new Error('Do not send credentials through development tools');
    }
    const fingerprint = digest(JSON.stringify([this.runId, name, input, callId]));
    const id =
      fingerprint.slice(0, 8) +
      '-' +
      fingerprint.slice(8, 12) +
      '-4' +
      fingerprint.slice(13, 16) +
      '-a' +
      fingerprint.slice(17, 20) +
      '-' +
      fingerprint.slice(20, 32);
    const receiptFile = path.join(this.stateDir, `${id}.json`);
    if (fs.existsSync(receiptFile)) {
      const previous = readPrivateJson(receiptFile);
      if (previous.fingerprint !== fingerprint || previous.status !== 'completed') {
        throw new Error('Tool outcome uncertain; do not repeat the action');
      }
      return previous.result;
    }
    if (await this.cancelled()) {
      throw new Error('Run cancelled by owner');
    }
    const mutation =
      ['ekybot_edit', 'ekybot_exec', 'ekybot_delegate'].includes(name) ||
      (name === 'ekybot_git' && ['commit', 'push'].includes(input.operation));
    if (mutation && this.uncertain) {
      throw new Error('Previous tool outcome uncertain; only inspection is allowed for this run');
    }
    await this.event({
      id,
      tool: name,
      status: 'started',
      detail:
        name === 'ekybot_delegate'
          ? `${input.engine} · ${input.projectId}`
          : input.path || input.operation || '',
    });
    const record = { version: 1, fingerprint, runId: this.runId, tool: name, status: 'started' };
    writeDurableJson(receiptFile, record);
    try {
      let result;
      if (name === 'ekybot_projects') {
        result = { projects: this.projects, workingDirectory: this.root, role: this.role };
      } else if (name === 'ekybot_list') {
        result = listDirectory(this.policy, input);
      } else if (name === 'ekybot_read') {
        result = readFile(this.policy, input);
      } else if (name === 'ekybot_edit') {
        result = editFile(this.policy, input, this.stateDir, id);
      } else if (name === 'ekybot_exec') {
        if ((await this.approve({ id, tool: name, input, root: this.root })) !== true) {
          result = { denied: true, message: 'Owner did not approve this command. Do not bypass.' };
        } else {
          if (await this.cancelled()) {
            throw new Error('Run cancelled during approval');
          }
          result = await this.runCommand({
            root: this.root,
            stateDir: this.stateDir,
            id,
            ...input,
          });
          if (result.interrupted) {
            throw new Error('Command interrupted; inspect the working copy');
          }
        }
      } else if (name === 'ekybot_git') {
        const head = git(this.root, ['rev-parse', 'HEAD']).trim();
        const branch = git(this.root, ['branch', '--show-current']).trim();
        if (!branch.startsWith('Mini/ekybot-')) {
          throw new Error('Only the bound Ekybot branch can be changed');
        }
        if (
          ['commit', 'push'].includes(input.operation) &&
          (await this.approve({
            id,
            tool: name,
            input: { ...input, branch, head },
            root: this.root,
          })) !== true
        ) {
          result = { denied: true };
        } else if (input.operation === 'status') {
          result = { branch, head, output: redact(git(this.root, ['status', '--short'])) };
        } else if (input.operation === 'diff') {
          result = {
            branch,
            head,
            output: redact(
              git(this.root, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD'])
            ).slice(0, 24000),
          };
        } else if (input.operation === 'commit') {
          if (await this.cancelled()) {
            throw new Error('Run cancelled during approval');
          }
          if (!input.message?.trim() || input.message.length > 200) {
            throw new Error('A short commit message is required');
          }
          const changed = git(this.root, [
            'ls-files',
            '--modified',
            '--others',
            '--exclude-standard',
            '-z',
          ])
            .split('\0')
            .filter(Boolean);
          if (!changed.length) {
            result = { unchanged: true, head };
          } else {
            for (const file of changed) {
              permittedPath(this.policy, file, { write: true });
            }
            git(this.root, ['add', '--', ...changed]);
            git(this.root, ['commit', '-m', input.message]);
            result = { branch, commit: git(this.root, ['rev-parse', 'HEAD']).trim() };
          }
        } else {
          if (await this.cancelled()) {
            throw new Error('Run cancelled during approval');
          }
          if (git(this.root, ['rev-parse', 'HEAD']).trim() !== head) {
            throw new Error('Commit changed during approval');
          }
          git(this.root, ['push', 'origin', `HEAD:refs/heads/${branch}`], { timeout: 60000 });
          result = { branch, commit: head, pushed: true };
        }
      } else if (name === 'ekybot_delegate') {
        if (
          this.role !== 'orchestrator' ||
          !this.delegate ||
          !this.projects.some((p) => p.id === input.projectId)
        ) {
          throw new Error('Delegation outside granted projects');
        }
        result = await this.delegate({ ...input, id });
      } else {
        throw new Error('Unsupported development operation');
      }
      writeDurableJson(receiptFile, { ...record, status: 'completed', result });
      await this.event({
        id,
        tool: name,
        status: result.denied ? 'denied' : 'completed',
        detail: result.commit || result.sha256 || '',
      });
      return result;
    } catch (error) {
      // Effects may already have occurred. Persist the uncertainty and refuse
      // replays. Errors never expose a provider response or a child environment.
      if (mutation) {
        this.uncertain = true;
      }
      // execFile errors embed stdout/stderr in message. Never return them to a
      // model, activity feed or receipt, even if no known secret pattern matches.
      const reason =
        error.code !== undefined || error.stdout !== undefined || error.stderr !== undefined
          ? 'Local operation failed; inspect its state.'
          : redact(error.message).slice(0, 300);
      const result = {
        error: mutation
          ? 'Operation uncertain. Inspect the working copy; do not retry blindly.'
          : 'Operation refused or unavailable.',
        reason,
      };
      writeDurableJson(receiptFile, {
        ...record,
        status: mutation ? 'uncertain' : 'completed',
        result,
      });
      await this.event({
        id,
        tool: name,
        status: mutation ? 'uncertain' : 'failed',
        detail: result.reason,
      });
      return result;
    }
  }
}
module.exports = { DevelopmentBroker };
