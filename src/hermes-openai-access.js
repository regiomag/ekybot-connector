const path = require('node:path');
const { readPrivateJson } = require('./hermes-resume-guard');
const { planFreshProfile, assertNoSymlinkChain, assertPrivate } = require('./hermes-fresh-profile');
const { OPENAI_PRIMARY } = require('./hermes-pilot-routing');
const { requestProviderMetadata } = require('./provider-metadata-request');

function checkOpenAICatalog({ options = {}, invoke } = {}) {
  const plan = planFreshProfile(options);
  const file = path.join(plan.home, 'auth.json');
  assertNoSymlinkChain(file);
  assertPrivate(plan.home, true);
  const auth = readPrivateJson(file);
  const provider = auth?.providers?.['openai-codex'];
  const token = provider?.tokens?.access_token;
  if (
    provider?.auth_mode !== 'chatgpt' ||
    typeof token !== 'string' ||
    !/^[A-Za-z0-9_.-]{30,20000}$/.test(token)
  ) {
    throw new Error('Independent OpenAI authentication required');
  }
  // Decode only to supply the backend account header, not to establish trust.
  // Acceptance must come from the authenticated HTTPS response.
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id;
  if (typeof accountId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(accountId)) {
    throw new Error('OpenAI account scope unavailable');
  }
  const { body, httpStatus, networkUnavailable, transportFailure } = requestProviderMetadata({
    url: 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0',
    headers: [`Authorization: Bearer ${token}`, `ChatGPT-Account-Id: ${accountId}`],
    // Codex catalogs include model instruction templates, not only IDs.
    responseLimit: 16 * 1024 * 1024,
    invoke,
  });
  const advertised =
    httpStatus === 200 &&
    Array.isArray(body?.models) &&
    body.models.some(
      (model) =>
        model.slug === OPENAI_PRIMARY.model && !['hide', 'hidden'].includes(model.visibility)
    );
  return {
    ...OPENAI_PRIMARY,
    status: networkUnavailable
      ? 'network-unavailable'
      : advertised
        ? 'model-advertised'
        : httpStatus === 401
          ? 'authentication-rejected'
          : 'catalog-unverified',
    httpStatus,
    modelInvoked: false,
    inferenceAccessVerified: false,
    ...(transportFailure ? { transportFailure } : {}),
  };
}

module.exports = { checkOpenAICatalog };
