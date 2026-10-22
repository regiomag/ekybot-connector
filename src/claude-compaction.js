// Qualified Claude Code 2.1.285 wire/persistence metadata. A summary is not a
// second user request. Never accept one without a matching native boundary.
const { validSessionId } = require('./v2-codex-runtime');
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
function compactionBoundary(event, persisted = false) {
  const m = persisted ? event.compactMetadata : event.compact_metadata;
  const anchor = persisted ? m?.preservedMessages?.anchorUuid : m?.preserved_messages?.anchor_uuid;
  const logicalParent = persisted ? event.logicalParentUuid : event.logical_parent_uuid;
  const preTokens = persisted ? m?.preTokens : m?.pre_tokens;
  const postTokens = persisted ? m?.postTokens : m?.post_tokens;
  if (
    event.type !== 'system' ||
    event.subtype !== 'compact_boundary' ||
    !validSessionId(event.uuid) ||
    !validSessionId(anchor) ||
    !validSessionId(logicalParent) ||
    m?.trigger !== 'auto' ||
    !count(preTokens) ||
    !count(postTokens)
  ) {
    throw new Error('Unqualified Claude compaction boundary');
  }
  return { id: event.uuid, anchor, logicalParent, preTokens, postTokens };
}
function compactionStatus(event) {
  return (
    event.type === 'system' &&
    event.subtype === 'status' &&
    (event.status === 'compacting' || event.status === null) &&
    (event.compact_result === undefined || ['success', 'failed'].includes(event.compact_result))
  );
}
function retryStatus(event) {
  return (
    event.type === 'system' &&
    event.subtype === 'api_retry' &&
    Number.isInteger(event.attempt) &&
    event.attempt >= 1 &&
    event.attempt <= 10 &&
    Number.isInteger(event.max_retries) &&
    event.max_retries <= 10 &&
    event.attempt <= event.max_retries &&
    count(event.retry_delay_ms)
  );
}
module.exports = { compactionBoundary, compactionStatus, retryStatus };
