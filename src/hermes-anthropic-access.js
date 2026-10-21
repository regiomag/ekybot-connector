// Metadata only. This module never invokes Messages or enumerates workspaces.
const { requestProviderMetadata } = require('./provider-metadata-request');
const { readAnthropicCredential } = require('./hermes-pilot-profile');
const { PRIMARY } = require('./hermes-pilot-routing');

function checkAnthropicAccess({ options = {}, invoke } = {}) {
  const credential = readAnthropicCredential(options);
  const headers = [`x-api-key: ${credential.apiKey}`, 'anthropic-version: 2023-06-01'];
  if (credential.workspaceId) {
    headers.push(`anthropic-workspace-id: ${credential.workspaceId}`);
  }
  // Secrets travel over stdin, not process arguments, temporary files or logs.
  const { body, httpStatus, networkUnavailable } = requestProviderMetadata({
    url: `https://api.anthropic.com/v1/models/${PRIMARY.model}`,
    headers,
    invoke,
  });
  const report = { provider: PRIMARY.provider, model: PRIMARY.model, modelInvoked: false };
  if (networkUnavailable) {
    return { ...report, status: 'network-unavailable', httpStatus: null };
  }
  if (httpStatus === 200 && body?.type === 'model' && body.id === PRIMARY.model) {
    return { ...report, status: 'model-metadata-verified', httpStatus };
  }
  // Classify known failures; never expose an upstream body, stderr or key.
  let status = 'metadata-unverified';
  if (httpStatus === 400 && /anthropic-workspace-id/.test(body?.error?.message || '')) {
    status = 'workspace-required';
  } else if (httpStatus === 401) {
    status = 'authentication-rejected';
  } else if (httpStatus === 403) {
    status = 'permission-denied';
  } else if (httpStatus === 404) {
    status = 'model-or-workspace-unavailable';
  }
  return { ...report, status, httpStatus: Number.isInteger(httpStatus) ? httpStatus : null };
}

module.exports = { checkAnthropicAccess };
