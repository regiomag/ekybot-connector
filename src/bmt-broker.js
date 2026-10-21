const crypto = require('node:crypto');
const { operations } = require('./bmt-registry');
const ORIGIN = 'https://bibavsaghwzuyvxsrgww.supabase.co';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = () => new Error('BMT request rejected');
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function keys() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  const publicKey = pair.publicKey.export({ format: 'jwk' });
  return {
    version: 1,
    publicKey,
    keyId: hash(publicKey),
    privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}
function decrypt(envelope, identity, pair) {
  if (
    envelope?.version !== 1 ||
    envelope.keyId !== pair.keyId ||
    JSON.stringify(envelope.identity) !== JSON.stringify(identity)
  ) {
    throw fail();
  }
  const unwrap = crypto.privateDecrypt(
    { key: pair.privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(envelope.wrapped, 'base64')
  );
  const sealed = Buffer.from(envelope.ciphertext, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  if (unwrap.length !== 32 || iv.length !== 12 || sealed.length > 4096 || sealed.length < 17) {
    throw fail();
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', unwrap, iv);
  decipher.setAAD(Buffer.from(JSON.stringify(identity)));
  decipher.setAuthTag(sealed.subarray(-16));
  const key = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]).toString(
    'utf8'
  );
  if (!/^bmt_[A-Za-z0-9_-]{16,512}$/.test(key)) {
    throw fail();
  }
  return key;
}
function clean(value, depth = 0) {
  if (depth > 8) {
    throw fail();
  }
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) {
    return;
  }
  if (!value || typeof value !== 'object') {
    throw fail();
  }
  for (const [k, v] of Object.entries(value)) {
    if (
      /^(?:project_?id|authorization|api_?key|token|headers|url|endpoint|__proto__|constructor|prototype)$/i.test(
        k
      )
    ) {
      throw fail();
    }
    clean(v, depth + 1);
  }
}
function requestPlan(command, connection) {
  if (
    !command ||
    Object.keys(command).some(
      (k) => !['connectionId', 'api', 'action', 'method', 'id', 'params', 'body'].includes(k)
    )
  ) {
    throw fail();
  }
  if (command.connectionId !== connection.id || connection.status !== 'ready') {
    throw fail();
  }
  const operation = operations.find(
    (o) =>
      o.api === command.api && o.action === command.action && o.method === (command.method || 'GET')
  );
  if (!operation || (operation.scope && !connection.scopes.includes(operation.scope))) {
    throw fail();
  }
  if (command.id !== undefined && !UUID.test(command.id)) {
    throw fail();
  }
  if (command.action === 'conversations/messages' && !command.id) {
    throw fail();
  }
  const params = command.params || {},
    body = command.body || {};
  if (Array.isArray(params) || Array.isArray(body)) {
    throw fail();
  }
  clean(params);
  clean(body);
  if (JSON.stringify(command).length > 12000) {
    throw fail();
  }
  if (operation.method === 'GET' && Object.keys(body).length) {
    throw fail();
  }
  if (command.api !== 'crm' && command.id) {
    throw fail();
  }
  const resource =
    command.action === 'conversations/messages'
      ? `conversations/${command.id}/messages`
      : `${command.action}${command.id ? `/${command.id}` : ''}`;
  const url = new URL(
    `/functions/v1/${command.api}-api${command.api === 'crm' ? `/${resource}` : ''}`,
    ORIGIN
  );
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw fail();
    }
    if (key === 'action') {
      throw fail();
    }
    url.searchParams.set(key, String(value));
  }
  if (command.api !== 'crm') {
    url.searchParams.set('action', command.action);
  }
  return {
    operation,
    url: url.href,
    method: operation.method,
    body:
      operation.method === 'GET'
        ? undefined
        : JSON.stringify(command.api === 'crm' ? body : { ...body, action: command.action }),
  };
}
async function call(plan, key, fetchImpl = fetch) {
  // Fixed origin, no redirects, cookies, inherited proxy, arbitrary headers or retries.
  if (new URL(plan.url).origin !== ORIGIN) {
    throw fail();
  }
  const response = await fetchImpl(plan.url, {
    method: plan.method,
    body: plan.body,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: 'BMT a refusé la demande. Vérifie les droits et la validité de la clé.',
    };
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > 256000) {
      await reader.cancel();
      throw fail();
    }
    chunks.push(Buffer.from(value));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  // Never publish a credential echoed by an upstream error or compromised record.
  if (text.includes(key) || /bmt_[A-Za-z0-9_-]{16,}/.test(text)) {
    throw fail();
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: true, data };
}
async function verify(key, fetchImpl) {
  const result = await call(
    { url: `${ORIGIN}/functions/v1/crm-api/describe`, method: 'GET' },
    key,
    fetchImpl
  );
  const access = result.data?.your_access;
  if (
    !result.ok ||
    !UUID.test(access?.project_id) ||
    !Array.isArray(access.scopes) ||
    access.scopes.some((x) => typeof x !== 'string')
  ) {
    throw fail();
  }
  return { projectId: access.project_id, scopes: access.scopes };
}
module.exports = { keys, decrypt, requestPlan, call, verify, operations, UUID, hash, ORIGIN };
