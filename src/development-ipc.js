const net = require('node:net');
const fs = require('node:fs');
const crypto = require('node:crypto');
// Private Unix socket. No listening TCP port and no machine/provider secret in
// the child MCP process. One random capability belongs to one admitted run.
async function startToolServer({ socketPath, broker }) {
  if (Buffer.byteLength(socketPath) > 100 || fs.existsSync(socketPath)) {
    throw new Error('Fresh short Unix socket required');
  }
  const token = crypto.randomBytes(32).toString('hex');
  const server = net.createServer((socket) => {
    let buffer = '',
      admitted = false;
    socket.setTimeout(15 * 60 * 1000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 70000 || admitted) {
        return socket.destroy();
      }
      if (!buffer.includes('\n')) {
        return;
      }
      admitted = true;
      void (async () => {
        const request = JSON.parse(buffer);
        if (request.token !== token) {
          throw new Error('Unauthorized local tool request');
        }
        const result =
          request.list === true
            ? broker.definitions()
            : await broker.call(request.name, request.arguments, request.callId);
        socket.end(JSON.stringify({ result }) + '\n');
      })().catch(() => socket.end(JSON.stringify({ error: 'Local tool request refused' }) + '\n'));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  fs.chmodSync(socketPath, 0o600);
  return { socketPath, token, close: () => new Promise((resolve) => server.close(resolve)) };
}
function callToolServer(connection, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(connection.socketPath);
    let buffer = '';
    socket.setTimeout(15 * 60 * 1000, () => socket.destroy(new Error('Local tool timeout')));
    socket.on('connect', () =>
      socket.write(JSON.stringify({ ...request, token: connection.token }) + '\n')
    );
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 100000) {
        socket.destroy(new Error('Tool response too large'));
      }
    });
    socket.on('error', () => reject(new Error('Local tool transport failed')));
    socket.on('end', () => {
      try {
        const result = JSON.parse(buffer);
        if (result.error) {
          throw new Error(result.error);
        }
        resolve(result.result);
      } catch {
        reject(new Error('Invalid tool response'));
      }
    });
  });
}
module.exports = { startToolServer, callToolServer };
