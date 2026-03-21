const RELAY_PUBLISH_GRACE_MS = 5_000;
const DEFAULT_RELAY_HARD_TIMEOUT_MS = 65_000;

function resolveRelayTimeout(timeoutMs, fallbackMs = DEFAULT_RELAY_HARD_TIMEOUT_MS) {
  const parsed = Number.parseInt(timeoutMs, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallbackMs;
}

module.exports = {
  RELAY_PUBLISH_GRACE_MS,
  DEFAULT_RELAY_HARD_TIMEOUT_MS,
  resolveRelayTimeout,
};
