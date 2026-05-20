/**
 * Memory Router
 *
 * Selects which memory blocks are relevant for a given message.
 * Uses keyword matching to avoid loading unnecessary context.
 * Budget: max ~1500 tokens injected (~5500 chars).
 */

const MAX_MEMORY_CHARS = 5500; // ~1500 tokens

/**
 * Routing rules: keyword patterns → memory block keys to load.
 * Order matters: first match wins for priority, but all matches are collected.
 */
const ROUTING_RULES = [
  {
    patterns: ['cortex', 'dixi', 'polytool', 'le locle', 'castella'],
    blocks: ['project', 'decisions', 'safety'],
  },
  {
    patterns: ['text.com', 'livechat', 'chat archive', 'chat client', 'extraction chat'],
    blocks: ['technical.text_com', 'safety'],
  },
  {
    patterns: ['sku', 'référence', 'produit', 'product', 'cédric', 'cedric', 'lookup', 'catalogue'],
    blocks: ['technical.product_lookup', 'glossary'],
  },
  {
    patterns: ['claude code', 'implémenter', 'implement', 'spec', 'développer', 'coder'],
    blocks: ['project', 'decisions', 'technical'],
  },
  {
    patterns: ['anonymi', 'rgpd', 'gdpr', 'confidenti', 'sécurité', 'security', 'sensible'],
    blocks: ['safety'],
  },
  {
    patterns: ['hermes', 'orchestr', 'agent'],
    blocks: ['project'],
  },
  {
    patterns: ['langchain', 'langserve', 'rag', 'pipeline'],
    blocks: ['project', 'decisions'],
  },
];

/**
 * Select relevant memory block keys for a message.
 *
 * @param {string} message - User message content
 * @param {string|null} channelKey - Channel key (for channel-based routing)
 * @returns {string[]} Array of block keys to load (deduplicated)
 */
function selectRelevantBlocks(message, channelKey = null) {
  const lower = (message || '').toLowerCase();
  const blocks = new Set();

  // Channel-based routing (always load project context for dedicated channels)
  if (channelKey) {
    const ch = channelKey.toLowerCase();
    if (ch.includes('dixi') || ch.includes('cortex')) {
      blocks.add('project');
    }
  }

  // Keyword-based routing
  for (const rule of ROUTING_RULES) {
    if (rule.patterns.some(p => lower.includes(p))) {
      for (const block of rule.blocks) {
        blocks.add(block);
      }
    }
  }

  return Array.from(blocks);
}

/**
 * Extract a memory block from seeds by dot-notation key.
 * e.g. 'technical.text_com' → seeds.technical.text_com
 *
 * @param {object} seeds - Full seeds object
 * @param {string} key - Dot-notation key
 * @returns {*} Block value or null
 */
function getBlock(seeds, key) {
  const parts = key.split('.');
  let current = seeds;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return null;
    current = current[part];
  }
  return current ?? null;
}

/**
 * Build a compact text representation of selected memory blocks.
 * Respects the MAX_MEMORY_CHARS budget.
 *
 * @param {object} seeds - Full seeds object
 * @param {string[]} blockKeys - Keys to include
 * @returns {string} Formatted memory context (may be truncated)
 */
function buildMemoryContext(seeds, blockKeys) {
  if (!seeds || blockKeys.length === 0) return '';

  const sections = [];
  let totalChars = 0;

  for (const key of blockKeys) {
    const block = getBlock(seeds, key);
    if (!block) continue;

    const section = formatBlock(key, block);
    if (totalChars + section.length > MAX_MEMORY_CHARS) {
      // Budget exceeded — stop adding
      break;
    }

    sections.push(section);
    totalChars += section.length;
  }

  if (sections.length === 0) return '';

  return `[EKYBOT PROJECT MEMORY — loaded ${sections.length} block(s)]\n${sections.join('\n')}`;
}

/**
 * Format a single memory block as compact text.
 */
function formatBlock(key, block) {
  if (typeof block === 'string') {
    return `[${key}] ${block}`;
  }

  if (Array.isArray(block)) {
    const items = block.map(item => {
      if (typeof item === 'string') return `- ${item}`;
      if (item.decision) return `- ${item.status || '?'}: ${item.decision}`;
      if (item.title) return `- ${item.title} (${item.status || '?'})`;
      return `- ${JSON.stringify(item)}`;
    });
    return `[${key}]\n${items.join('\n')}`;
  }

  if (typeof block === 'object') {
    const lines = [];
    for (const [k, v] of Object.entries(block)) {
      if (typeof v === 'string') {
        lines.push(`  ${k}: ${v}`);
      } else if (Array.isArray(v)) {
        lines.push(`  ${k}: ${v.join(', ')}`);
      } else if (typeof v === 'object' && v !== null) {
        // One level deep only to stay compact
        const sub = Object.entries(v).map(([sk, sv]) =>
          typeof sv === 'string' ? `${sk}=${sv}` : `${sk}=${JSON.stringify(sv)}`
        ).join(', ');
        lines.push(`  ${k}: ${sub}`);
      }
    }
    return `[${key}]\n${lines.join('\n')}`;
  }

  return `[${key}] ${String(block)}`;
}

module.exports = { selectRelevantBlocks, buildMemoryContext, getBlock, MAX_MEMORY_CHARS };
