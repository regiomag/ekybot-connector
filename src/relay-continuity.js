const RELAY_FAILED_AFTER_MS = 900_000;
const RELAY_PUBLISH_GRACE_MS = 5_000;
const MIN_RELAY_HARD_TIMEOUT_MS = RELAY_FAILED_AFTER_MS + RELAY_PUBLISH_GRACE_MS;

function enforceRelayTimeoutFloor(timeoutMs) {
  const parsed = Number.parseInt(timeoutMs, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MIN_RELAY_HARD_TIMEOUT_MS;
  }

  return Math.max(parsed, MIN_RELAY_HARD_TIMEOUT_MS);
}

module.exports = {
  RELAY_FAILED_AFTER_MS,
  RELAY_PUBLISH_GRACE_MS,
  MIN_RELAY_HARD_TIMEOUT_MS,
  enforceRelayTimeoutFloor,
};
