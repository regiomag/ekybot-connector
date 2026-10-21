// Explicit personal-pilot routing. No provider discovery, secret or model call.
const { planFreshProfile } = require('./hermes-fresh-profile');
const { safetyError } = require('./hermes-session-safety');

const PRIMARY = Object.freeze({
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  key_env: 'ANTHROPIC_API_KEY',
});

function buildPilotRouting({ root, profile, reasoningEffort = 'medium' } = {}) {
  if (!['medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) {
    throw safetyError('PILOT_REASONING_REQUIRED', 'Choose the reasoning effort explicitly.');
  }
  const plan = planFreshProfile({ root, profile });
  const config = JSON.parse(plan.files['config.yaml']);
  config.model = { provider: PRIMARY.provider, default: PRIMARY.model };
  config.agent = { reasoning_effort: reasoningEffort };
  config.fallback_providers = [];
  return {
    profile: plan.profile,
    home: plan.home,
    workspace: plan.workspace,
    config,
    primary: { ...PRIMARY, authentication: 'api-key', metered: true },
    fallback: null,
    // Configuration is not activation. The dedicated executor must check both
    // credentials and session safety before consuming a queued message.
    activationRequired: true,
  };
}

module.exports = { buildPilotRouting, PRIMARY };

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
