const { spawn } = require('node:child_process');

// One local stdio connection. Never exposes raw stderr, environment or errors.
class JsonRpcProcess {
  constructor({
    command,
    args,
    cwd,
    env,
    spawnProcess = spawn,
    requestTimeout = 30000,
    onRequest,
  }) {
    this.pending = new Map();
    this.listeners = new Set();
    this.nextId = 1;
    this.closed = false;
    this.exited = false;
    this.requestTimeout = requestTimeout;
    this.onRequest = onRequest;
    this.child = spawnProcess(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin.on('error', () => this.close());
    this.child.stderr.resume();
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) {
        return this.close();
      }
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) {
          continue;
        }
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.close();
          return;
        }
      }
    });
    this.child.on('error', () => this.close());
    this.child.on('close', () => {
      this.exited = true;
      clearTimeout(this.killTimer);
      this.close();
    });
  }
  receive(message) {
    if (message.method && message.id !== undefined) {
      if (this.onRequest) {
        Promise.resolve()
          .then(() => this.onRequest(message))
          .then(
            (result) => {
              if (!this.closed) {
                this.write({ id: message.id, result });
              }
            },
            () => {
              if (!this.closed) {
                this.write({
                  id: message.id,
                  error: { code: -32603, message: 'Tool request refused.' },
                });
              }
            }
          )
          .catch(() => this.close());
        return;
      }
      // No implicit approval or client-side tool execution. Unknown requests fail
      // closed; adding approvals later must use a durable, user-bound request.
      this.write({
        id: message.id,
        error: {
          code: -32601,
          message: 'Interactive approval is not enabled for this connection.',
        },
      });
      for (const listener of this.listeners) {
        listener({ method: 'ekybot/approvalRequired', params: {} });
      }
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error('Local runtime rejected the request.'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      for (const listener of this.listeners) {
        listener(message);
      }
    }
  }
  write(message) {
    if (this.closed) {
      throw new Error('Local runtime connection closed.');
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  notify(method, params = {}) {
    this.write({ method, params });
  }
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        return reject(new Error('Local runtime connection closed.'));
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Local runtime acknowledgement timed out.'));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Local runtime connection closed.'));
      }
    });
  }
  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Local runtime connection closed.'));
    }
    this.pending.clear();
    for (const listener of this.listeners) {
      listener({ method: 'ekybot/closed', params: {} });
    }
    this.listeners.clear();
    if (!this.exited) {
      this.child.kill('SIGTERM');
      this.killTimer = setTimeout(() => {
        if (!this.exited) {
          this.child.kill('SIGKILL');
        }
      }, 2000);
      this.killTimer.unref();
    }
  }
}
module.exports = { JsonRpcProcess };
