function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== null && entryValue !== undefined)
  );
}

function buildCompanionRuntimeState(runtimeState = {}) {
  return compactObject({
    lastDesiredSyncAt: runtimeState.lastDesiredSyncAt,
    lastInventoryUploadedAt: runtimeState.lastInventoryUploadedAt,
    lastApplyStartedAt: runtimeState.lastApplyStartedAt,
    lastApplyCompletedAt: runtimeState.lastApplyCompletedAt,
    lastReconciledAt: runtimeState.lastReconciledAt,
    lastAppliedDesiredConfigVersion: runtimeState.lastAppliedDesiredConfigVersion,
    lastAppliedManagedFragmentPath: runtimeState.lastAppliedManagedFragmentPath,
    lastAppliedManagedFragmentHash: runtimeState.lastAppliedManagedFragmentHash,
    driftDetected: runtimeState.driftDetected,
    driftReason: runtimeState.driftReason,
  });
}

module.exports = {
  buildCompanionRuntimeState,
};
