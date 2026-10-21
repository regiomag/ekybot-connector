// Explicit personal-pilot routing. No provider discovery, secret or model call.
const { planFreshProfile } = require('./hermes-fresh-profile');
const { safetyError } = require('./hermes-session-safety');

const PRIMARY = Object.freeze({
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  key_env: 'ANTHROPIC_API_KEY',
});
const OPENAI_PRIMARY = Object.freeze({ provider: 'openai-codex', model: 'gpt-5.6-sol' });

function buildPilotRouting({
  root,
  profile,
  reasoningEffort = 'medium',
  routingMode = 'claude-only',
} = {}) {
  if (!['claude-only', 'openai-primary'].includes(routingMode)) {
    throw safetyError('PILOT_ROUTING_INVALID', 'Choose an explicit supported pilot route.');
  }
  if (!['medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) {
    throw safetyError('PILOT_REASONING_REQUIRED', 'Choose the reasoning effort explicitly.');
  }
  const plan = planFreshProfile({ root, profile });
  const config = JSON.parse(plan.files['config.yaml']);
  const primary = routingMode === 'openai-primary' ? OPENAI_PRIMARY : PRIMARY;
  config.model = { provider: primary.provider, default: primary.model };
  config.agent = { reasoning_effort: reasoningEffort };
  config.fallback_providers = [];
  return {
    profile: plan.profile,
    home: plan.home,
    workspace: plan.workspace,
    config,
    routingMode,
    primary: {
      ...primary,
      authentication: routingMode === 'openai-primary' ? 'chatgpt-subscription' : 'api-key',
      metered: routingMode !== 'openai-primary',
    },
    fallback:
      routingMode === 'openai-primary'
        ? { ...PRIMARY, authentication: 'api-key', metered: true }
        : null,
    // Native broad fallback is deliberately empty. The durable dispatcher must
    // decide from a verified rejection, never a timeout or partial response.
    fallbackPolicy: routingMode === 'openai-primary' ? 'verified-rejection-only' : null,
    // Configuration is not activation. The dedicated executor must check both
    // credentials and session safety before consuming a queued message.
    activationRequired: true,
  };
}

module.exports = { buildPilotRouting, PRIMARY, OPENAI_PRIMARY };

// Explicit execution limits for the initial chat-only qualification. This is
// separate from inactive credential enrollment; neither function activates it.
function buildPilotExecutionConfig(options = {}) {
  const { config } = buildPilotRouting(options);
  config.agent.api_max_retries = 1;
  config.compression = { enabled: false };
  config.auxiliary = { title_generation: { enabled: false } };
  return config;
}
module.exports.buildPilotExecutionConfig = buildPilotExecutionConfig;
