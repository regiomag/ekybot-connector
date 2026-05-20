/**
 * Memory Injector
 *
 * Resolves project context for a relay notification and injects
 * relevant memory blocks into the prompt before dispatching to the runtime.
 *
 * Budget: max ~1500 tokens (~5500 chars) of memory injected.
 * Only loads blocks relevant to the message content and channel.
 */

const { loadSeeds, listProjects } = require('./loader');
const { selectRelevantBlocks, buildMemoryContext } = require('./router');

/**
 * Map channel keys to project IDs.
 * A channel can be associated with a project via naming convention
 * or explicit mapping.
 */
const CHANNEL_PROJECT_MAP = {
  // Dixi Cortex channels
  'claude-code-dixi': 'cortex-dixi',
  'hermes-dixi': 'cortex-dixi',
  // BeMyTalent channels
  'claude-code-bemytalent': 'bemytalent',
  'hermes-bemytalent': 'bemytalent',
  // Ekybot channels
  'claude-code': 'ekybot',
  'hermes': 'ekybot',
  'claude-cowork': 'ekybot',
};

/**
 * Resolve project ID from channel key.
 * Falls back to suffix matching if not in explicit map.
 *
 * @param {string} channelKey
 * @returns {string|null} projectId
 */
function resolveProjectId(channelKey) {
  if (!channelKey) return null;

  // Explicit mapping
  if (CHANNEL_PROJECT_MAP[channelKey]) {
    return CHANNEL_PROJECT_MAP[channelKey];
  }

  // Suffix-based: channel "foo-dixi" → project "cortex-dixi"
  const lower = channelKey.toLowerCase();
  if (lower.includes('dixi') || lower.includes('cortex')) {
    return 'cortex-dixi';
  }

  return null;
}

/**
 * Build enriched prompt with relevant project memory injected.
 *
 * @param {string} originalPrompt - The user's message
 * @param {object} context - Relay context
 * @param {string} context.channelKey - Source channel key
 * @param {string} context.targetAgentId - Target agent openclawAgentId
 * @returns {string} Enriched prompt (original + memory prefix if relevant)
 */
function enrichPromptWithMemory(originalPrompt, context = {}) {
  const { channelKey, targetAgentId } = context;

  const projectId = resolveProjectId(channelKey);
  if (!projectId) return originalPrompt;

  const seeds = loadSeeds(projectId);
  if (!seeds) return originalPrompt;

  const blockKeys = selectRelevantBlocks(originalPrompt, channelKey);
  if (blockKeys.length === 0) return originalPrompt;

  const memoryContext = buildMemoryContext(seeds, blockKeys);
  if (!memoryContext) return originalPrompt;

  // Inject memory as a system-level prefix before the user message
  return `${memoryContext}\n\n---\n\n${originalPrompt}`;
}

module.exports = { enrichPromptWithMemory, resolveProjectId, CHANNEL_PROJECT_MAP };
