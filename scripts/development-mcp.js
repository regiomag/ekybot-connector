// Minimal MCP stdio transport for a fixed, application-owned set of tools.
// No provider SDK or credentials and no arbitrary MCP servers are loaded.
const readline = require('node:readline');
const crypto = require('node:crypto');
const { callToolServer } = require('../src/development-ipc');
const connection = {
  socketPath: process.env.EKYBOT_TOOL_SOCKET,
  token: process.env.EKYBOT_TOOL_TOKEN,
};
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const reply = (value) => process.stdout.write(JSON.stringify(value) + '\n');
lines.on('line', (line) => {
  if (line.length > 70000) {
    return process.exit(1);
  }
  void (async () => {
    const message = JSON.parse(line);
    if (message.id === undefined) {
      return;
    }
    let result;
    if (message.method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ekybot-development', version: '1.0.0' },
      };
    } else if (message.method === 'ping') {
      result = {};
    } else if (message.method === 'tools/list') {
      result = { tools: await callToolServer(connection, { list: true }) };
    } else if (message.method === 'tools/call') {
      const data = await callToolServer(connection, {
        name: message.params.name,
        arguments: message.params.arguments,
        callId: crypto.randomUUID(),
      });
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], isError: !!data.error };
    } else {
      return reply({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Unsupported MCP method' },
      });
    }
    reply({ jsonrpc: '2.0', id: message.id, result });
  })().catch(() => {
    try {
      const { id } = JSON.parse(line);
      reply({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Development tool refused' } });
    } catch {
      process.exitCode = 1;
    }
  });
});
