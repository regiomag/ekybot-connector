const { createHash } = require('node:crypto');
const { DurableConversationJournal } = require('./hermes-pilot-journal');
const { validSessionId, assertCodexContinuation } = require('./v2-codex-runtime');
const { assertClaudeContinuation } = require('./v2-claude-runtime');

const engines = Object.freeze({
  codex: assertCodexContinuation,
  claude: assertClaudeContinuation,
});

// Local session identity, not an authorization decision. The caller must obtain
// these values from its authenticated server and recheck live grants per tool.
// Changing a principal, project or consent requires a new native conversation.
function scopedConversationProfile({
  engine,
  ownerId,
  projectId,
  agentId,
  channelId,
  connectionId,
  grantRevision,
  policyVersion,
}) {
  if (
    !Object.hasOwn(engines, engine) ||
    ![ownerId, projectId, agentId, channelId, connectionId].every(validSessionId) ||
    ![grantRevision, policyVersion].every(
      (value) => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,100}$/.test(value)
    )
  ) {
    throw new Error('Invalid native conversation scope');
  }
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        1,
        engine,
        ownerId,
        projectId,
        agentId,
        channelId,
        connectionId,
        grantRevision,
        policyVersion,
      ])
    )
    .digest('hex');
  return `scoped-native-v1:${digest}`;
}

// Lazy: delivery of a persisted result never needs provider authentication.
// The promise is retained even on failure: no implicit restart/fallback. This
// helper preserves the existing journal format and continuation proof.
function createNativeConversationJournal({ engine, getRuntime, ...options }) {
  if (!Object.hasOwn(engines, engine) || typeof getRuntime !== 'function') {
    throw new Error('Unsupported native conversation runtime');
  }
  let opening;
  const runtime = () => {
    opening ??= Promise.resolve()
      .then(getRuntime)
      .then((value) => {
        if (typeof value?.execute !== 'function' || typeof value?.inspectSession !== 'function') {
          throw new Error('Incomplete native conversation runtime');
        }
        return value;
      });
    return opening;
  };
  return new DurableConversationJournal({
    ...options,
    assertFresh: options.assertFresh || (async () => {}),
    validSessionId,
    assertContinuation: engines[engine],
    execute: async (args) => (await runtime()).execute(args),
    inspectSession: async (args) => (await runtime()).inspectSession(args),
  });
}

// New multi-user consumers use this entry point instead of constructing a
// profile manually. Existing pilot bindings retain their legacy profile names.
function createScopedNativeConversationJournal({ scope, stateDir, homeRoot, getRuntime }) {
  const profile = scopedConversationProfile(scope);
  return createNativeConversationJournal({
    engine: scope.engine,
    channelId: scope.channelId,
    profile,
    stateDir,
    homeRoot,
    getRuntime,
  });
}

module.exports = {
  createNativeConversationJournal,
  createScopedNativeConversationJournal,
  scopedConversationProfile,
};
