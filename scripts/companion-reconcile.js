#!/usr/bin/env node

require('../src/load-env')();
const chalk = require('chalk');
const {
  EkybotCompanionApiClient,
  EkybotCompanionExecutor,
  EkybotCompanionStateStore,
  OpenClawConfigManager,
  OpenClawGatewayClient,
  OpenClawInventoryCollector,
  EkybotCompanionRelayProcessor,
} = require('../src');
const { buildCompanionRuntimeState } = require('../src/companion-runtime-state');
const { withRetry } = require('../src/retry-util');

async function reconcileCompanionState() {
  console.log(chalk.blue.bold('🔁 Ekybot Companion Reconcile'));

  const stateStore = new EkybotCompanionStateStore();
  const state = stateStore.load();

  if (!state?.machineId || !state?.machineApiKey) {
    console.error(chalk.red('❌ No companion machine registered'));
    console.error(chalk.yellow('Run "npm run companion:register" first.'));
    process.exit(1);
  }

  if (state.machineFingerprint) {
    process.env.EKYBOT_MACHINE_FINGERPRINT = state.machineFingerprint;
  }

  const startedAt = new Date().toISOString();
  stateStore.merge({
    lastReconcileStartedAt: startedAt,
  });

  const apiClient = new EkybotCompanionApiClient({
    baseUrl: state.baseUrl,
    machineApiKey: state.machineApiKey,
  });
  const configManager = new OpenClawConfigManager();
  const inventoryCollector = new OpenClawInventoryCollector(configManager, {
    machineName: state.machineName,
  });
  const executor = new EkybotCompanionExecutor(apiClient, configManager, stateStore);
  const relayProcessor = new EkybotCompanionRelayProcessor(apiClient, new OpenClawGatewayClient(), {
    stateStore,
    inventoryCollector,
    machineId: state.machineId,
  });

  const buildHeartbeat = (runtimeState, pendingOperationCount) => {
    const heartbeat = inventoryCollector.toHeartbeatPayload(state.machineId);
    heartbeat.pendingOperationCount = pendingOperationCount;
    heartbeat.runtimeState = buildCompanionRuntimeState(runtimeState);
    return heartbeat;
  };

  // Degraded mode: inventory upload is best-effort with retry on transient errors
  const sendInventorySnapshot = async ({ required = false } = {}) => {
    const inventory = inventoryCollector.toMachineInventoryPayload(state.machineId);
    try {
      await withRetry(
        () => apiClient.uploadInventory(state.machineId, inventory),
        { maxAttempts: 3, baseDelayMs: 2000, label: 'inventory-upload' }
      );
    } catch (err) {
      if (required) throw err;
      console.warn(chalk.yellow(`⚠️  Inventory upload failed (degraded, continuing): ${err.message}`));
    }
    return inventory;
  };

  const initialDesiredState = await withRetry(
    () => apiClient.fetchDesiredState(state.machineId),
    { maxAttempts: 3, baseDelayMs: 1000, label: 'fetch-desired-state-initial' }
  );
  const runtimeBefore = stateStore.load() || state;
  await withRetry(
    () => apiClient.sendHeartbeat(
      state.machineId,
      buildHeartbeat(
        {
          activeRequests: runtimeBefore.activeRequests,
          lastDesiredSyncAt: runtimeBefore.lastDesiredSyncAt,
          lastInventoryUploadedAt: runtimeBefore.lastInventoryUploadedAt,
          lastApplyStartedAt: runtimeBefore.lastApplyStartedAt,
          lastApplyCompletedAt: runtimeBefore.lastApplyCompletedAt,
          lastReconciledAt: runtimeBefore.lastReconciledAt,
          lastAppliedDesiredConfigVersion: runtimeBefore.lastAppliedDesiredConfigVersion,
          lastAppliedManagedFragmentPath: runtimeBefore.lastAppliedManagedFragmentPath,
          lastAppliedManagedFragmentHash: runtimeBefore.lastAppliedManagedFragmentHash,
          driftDetected: runtimeBefore.driftDetected ?? false,
          driftReason: runtimeBefore.driftReason,
        },
        (initialDesiredState.pendingOperations || []).length
      )
    ),
    { maxAttempts: 3, baseDelayMs: 1000, label: 'heartbeat-initial' }
  );

  const firstInventory = await sendInventorySnapshot();
  stateStore.merge({
    lastDesiredSyncAt: startedAt,
    lastInventoryUploadedAt: startedAt,
    lastInventoryHash: firstInventory.configHash,
  });

  const applyResult = await executor.applyDesiredState(state.machineId);

  const secondInventory = await sendInventorySnapshot();
  const finishedAt = new Date().toISOString();
  const finalDesiredState = await withRetry(
    () => apiClient.fetchDesiredState(state.machineId),
    { maxAttempts: 3, baseDelayMs: 1000, label: 'fetch-desired-state-final' }
  );
  const finalPendingOperationCount = (finalDesiredState.pendingOperations || []).filter(
    (operation) => operation.status === 'pending' || operation.status === 'in_progress'
  ).length;
  const driftDetected =
    finalPendingOperationCount > 0 || applyResult.failedOperationCount > 0;
  const driftReason = driftDetected
    ? applyResult.failedOperationCount > 0
      ? 'Some operations failed during reconcile'
      : 'Pending operations remain after reconcile'
    : null;

  stateStore.merge({
    lastDesiredSyncAt: finishedAt,
    lastInventoryUploadedAt: finishedAt,
    lastInventoryHash: secondInventory.configHash,
    lastReconciledAt: finishedAt,
    driftDetected,
    driftReason,
  });

  const finalState = stateStore.load() || state;
  await withRetry(
    () => apiClient.sendHeartbeat(
      state.machineId,
      buildHeartbeat(
        {
          activeRequests: finalState.activeRequests,
          lastDesiredSyncAt: finalState.lastDesiredSyncAt,
          lastInventoryUploadedAt: finalState.lastInventoryUploadedAt,
          lastApplyStartedAt: finalState.lastApplyStartedAt,
          lastApplyCompletedAt: finalState.lastApplyCompletedAt,
          lastReconciledAt: finalState.lastReconciledAt,
          lastAppliedDesiredConfigVersion: finalState.lastAppliedDesiredConfigVersion,
          lastAppliedManagedFragmentPath: finalState.lastAppliedManagedFragmentPath,
          lastAppliedManagedFragmentHash: finalState.lastAppliedManagedFragmentHash,
          driftDetected: finalState.driftDetected ?? false,
          driftReason: finalState.driftReason,
        },
        finalPendingOperationCount
      )
    ),
    { maxAttempts: 3, baseDelayMs: 1000, label: 'heartbeat-final' }
  );

  const relayResult = await relayProcessor.processPendingRelays(state.machineId);

  console.log(
    chalk.green(
      `✓ Reconcile completed (${applyResult.appliedOperationIds.length}/${applyResult.pendingOperations.length} operations applied)`
    )
  );
  if (applyResult.implicitSyncApplied) {
    console.log(chalk.green('✓ Desired state changes were synced to the managed fragment'));
  }
  console.log(chalk.gray(`Managed agents written: ${(applyResult.desiredState?.agents || []).length}`));
  console.log(chalk.gray(`Pending operations remaining: ${finalPendingOperationCount}`));
  if (relayResult.fetched > 0) {
    console.log(
      chalk.gray(
        `Relay notifications: ${relayResult.delivered}/${relayResult.fetched} delivered, ${relayResult.replied} replies published${relayResult.failed > 0 ? `, ${relayResult.failed} failed` : ''}`
      )
    );
  }
  console.log(
    driftDetected
      ? chalk.yellow(`Drift detected: ${driftReason}`)
      : chalk.green('Machine is in sync with desired state')
  );
}

if (require.main === module) {
  reconcileCompanionState().catch((error) => {
    console.error(chalk.red(`Companion reconcile failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = reconcileCompanionState;
