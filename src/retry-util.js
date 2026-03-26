/**
 * Retry with exponential backoff for transient failures.
 * Transient = matches: transaction, timeout, 502, 503, 529.
 *
 * @param {() => Promise<any>} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, label?: string }} [opts]
 * @returns {Promise<any>}
 */
async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'operation' } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isTransient = /transaction|timeout|503|502|529/i.test(err.message);
      if (!isTransient || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} failed (transient), retrying in ${delay}ms — ${err.message}`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

module.exports = { withRetry };
