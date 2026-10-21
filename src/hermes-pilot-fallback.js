// Pure routing decision. It never sends a prompt or marks a run completed.
// The transport, not a model response, must provide the rejection evidence.
const { buildPilotRouting } = require('./hermes-pilot-routing');

function choosePilotFallback(evidence, options = {}) {
  const route = buildPilotRouting({ ...options, routingMode: 'openai-primary' });
  const statusByCode = {
    authentication_required: 401,
    permission_denied: 403,
    rate_limited: 429,
    model_unavailable: 404,
  };
  if (
    evidence?.provider !== route.primary.provider ||
    evidence?.disposition !== 'rejected-before-execution' ||
    evidence?.attempt !== 1 ||
    evidence?.outputReceived !== false ||
    evidence?.toolsExecuted !== false ||
    !Object.hasOwn(statusByCode, evidence?.code) ||
    evidence?.httpStatus !== statusByCode[evidence.code]
  ) {
    return { action: 'stop', reason: 'outcome-uncertain-or-not-eligible', retryable: false };
  }
  return { action: 'fallback', target: route.fallback, maxAttempts: 1, preserveSession: true };
}

module.exports = { choosePilotFallback };
