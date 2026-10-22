// Metadata allowlist: never retain text, prompts, thinking, tool payloads or secrets.
const count = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 1e12 ? v : null);
const { validModel } = require('./native-model-id');
const model = (v) => (validModel(v) ? v : null);
function telemetry(value = {}) {
  return {
    version: 1,
    model: model(value.model),
    inputTokens: count(value.inputTokens),
    outputTokens: count(value.outputTokens),
    cachedInputTokens: count(value.cachedInputTokens),
    contextTokens: count(value.contextTokens),
    contextWindow: count(value.contextWindow),
    compactions: count(value.compactions) ?? 0,
  };
}
module.exports = { telemetry, count };
