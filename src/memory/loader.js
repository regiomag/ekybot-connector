/**
 * Memory Loader
 *
 * Loads structured memory seeds from JSON files.
 * Each project has its own seed file in memory-seeds/.
 * Seeds are cached in memory and reloaded on file change.
 */

const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const SEEDS_DIR = path.join(__dirname, '..', '..', 'memory-seeds');
const cache = new Map();
const mtimeCache = new Map();

/**
 * Load memory seeds for a given project.
 * Returns null if no seeds file exists.
 * Caches and only reloads when file mtime changes.
 *
 * @param {string} projectId - e.g. 'cortex-dixi', 'ekybot'
 * @returns {object|null} Parsed memory seeds
 */
function loadSeeds(projectId) {
  const filePath = path.join(SEEDS_DIR, `${projectId}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const stat = fs.statSync(filePath);
    const mtime = stat.mtimeMs;

    if (cache.has(projectId) && mtimeCache.get(projectId) === mtime) {
      return cache.get(projectId);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const seeds = JSON.parse(raw);
    cache.set(projectId, seeds);
    mtimeCache.set(projectId, mtime);

    console.log(chalk.gray(`[memory] loaded seeds for ${projectId} (${Object.keys(seeds).length} blocks)`));
    return seeds;
  } catch (err) {
    console.warn(chalk.yellow(`[memory] failed to load seeds for ${projectId}: ${err.message}`));
    return null;
  }
}

/**
 * List all available project IDs (from seed files).
 * @returns {string[]}
 */
function listProjects() {
  if (!fs.existsSync(SEEDS_DIR)) return [];
  return fs.readdirSync(SEEDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

module.exports = { loadSeeds, listProjects };
