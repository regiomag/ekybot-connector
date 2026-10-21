// Explicit personal-pilot routing. No provider discovery, secret or model call.
const { planFreshProfile } = require('./hermes-fresh-profile');
const { safetyError } = require('./hermes-session-safety');

const PRIMARY = Object.freeze({ provider: 'openai-codex', model: 'gpt-5.6-sol' });
const FALLBACK = Object.freeze({
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  key_env: 'ANTHROPIC_API_KEY',
});

function buildPilotRouting({ root, profile, reasoningEffort } = {}) {
  if (!['medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) {
    throw safetyError('PILOT_REASONING_REQUIRED', 'Choose the reasoning effort explicitly.');
  }
  const plan = planFreshProfile({ root, profile });
  const config = JSON.parse(plan.files['config.yaml']);
  config.model = { provider: PRIMARY.provider, default: PRIMARY.model };
  config.agent = { reasoning_effort: reasoningEffort };
  config.fallback_providers = [{ ...FALLBACK }];
  return {
    profile: plan.profile,
    home: plan.home,
    workspace: plan.workspace,
    config,
    primary: { ...PRIMARY, authentication: 'independent-chatgpt-login' },
    fallback: { ...FALLBACK, authentication: 'api-key', metered: true },
    // Configuration is not activation. The dedicated executor must check both
    // credentials and session safety before consuming a queued message.
    activationRequired: true,
  };
}

module.exports = { buildPilotRouting, PRIMARY, FALLBACK };
