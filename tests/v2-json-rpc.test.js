const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { JsonRpcProcess } = require('../src/v2-json-rpc');
function fixture() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const sent = [];
  child.stdin.on('data', (data) => sent.push(JSON.parse(data)));
  const rpc = new JsonRpcProcess({
    command: 'fixture',
    args: [],
    spawnProcess: () => child,
    requestTimeout: 30,
  });
  return { child, rpc, sent };
}
test('stdio RPC resolves split messages and never forwards raw errors', async () => {
  const { child, rpc, sent } = fixture();
  try {
    const pending = rpc.request('initialize');
    child.stdout.write('{"id":1,"res');
    child.stdout.write('ult":{"ok":true}}\n');
    assert.deepEqual(await pending, { ok: true });
    assert.equal(sent[0].method, 'initialize');
    const rejected = rpc.request('bad');
    child.stdout.write('{"id":2,"error":{"message":"secret upstream"}}\n');
    await assert.rejects(
      rejected,
      (error) => !error.message.includes('secret') && error.message.includes('rejected')
    );
  } finally {
    rpc.close();
  }
});
test('server approval requests cannot silently grant permissions', () => {
  const { child, rpc, sent } = fixture();
  const events = [];
  rpc.onEvent((event) => events.push(event));
  child.stdout.write('{"id":7,"method":"item/commandExecution/requestApproval","params":{}}\n');
  assert.equal(sent[0].error.code, -32601);
  assert.equal(events[0].method, 'ekybot/approvalRequired');
  rpc.close();
});
test('stdio RPC preserves UTF-8 even when every byte arrives separately', async () => {
  const { child, rpc } = fixture();
  try {
    const pending = rpc.request('read');
    const result = { text: 'Société Démo éà漢😀' };
    for (const byte of Buffer.from(JSON.stringify({ id: 1, result }) + '\n')) {
      child.stdout.write(Buffer.from([byte]));
    }
    assert.deepEqual(await pending, result);
  } finally {
    rpc.close();
  }
});
test('broken transport rejects pending calls and closes idempotently', async () => {
  const { child, rpc } = fixture();
  const pending = rpc.request('read');
  child.emit('close');
  await assert.rejects(pending, /closed/);
  rpc.close();
});
test('acknowledgement timeouts do not send a second request', async () => {
  const { rpc, sent } = fixture();
  await assert.rejects(rpc.request('read'), /timed out/);
  assert.equal(sent.length, 1);
  rpc.close();
});
