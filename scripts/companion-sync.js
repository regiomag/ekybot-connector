#!/usr/bin/env node

require('../src/load-env')();
const chalk = require('chalk');
const {
  EkybotCompanionApiClient,
  EkybotCompanionStateStore,
  OpenClawConfigManager,
  OpenClawInventoryCollector,
  OpenClawMemoryRuntime,
} = require('../src');
const { buildCompanionRuntimeState } = require('../src/companion-runtime-state');
const { withRetry } = require('../src/retry-util');

async function syncCompanionInventory() {
  console.log(chalk.blue.bold('🔄 Ekybot Companion Sync'));

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

  const configManager = new OpenClawConfigManager();
  const inventoryCollector = new OpenClawInventoryCollector(configManager, {
    machineName: state.machineName,
  });
  const memoryRuntime = new OpenClawMemoryRuntime(configManager);

  const apiClient = new EkybotCompanionApiClient({
    baseUrl: state.baseUrl,
    machineApiKey: state.machineApiKey,
  });

  const syncStartedAt = new Date().toISOString();
  const refreshedState = stateStore.load() || state;
  const heartbeat = inventoryCollector.toHeartbeatPayload(state.machineId);
  const inventory = inventoryCollector.toMachineInventoryPayload(state.machineId);
  heartbeat.runtimeState = buildCompanionRuntimeState({
    activeRequests: refreshedState.activeRequests,
    lastDesiredSyncAt: refreshedState.lastDesiredSyncAt,
    lastInventoryUploadedAt: syncStartedAt,
    lastApplyStartedAt: refreshedState.lastApplyStartedAt,
    lastApplyCompletedAt: refreshedState.lastApplyCompletedAt,
    lastReconciledAt: refreshedState.lastReconciledAt,
    lastAppliedDesiredConfigVersion: refreshedState.lastAppliedDesiredConfigVersion,
    lastAppliedManagedFragmentPath: refreshedState.lastAppliedManagedFragmentPath,
    lastAppliedManagedFragmentHash: refreshedState.lastAppliedManagedFragmentHash,
    driftDetected: refreshedState.driftDetected ?? false,
    driftReason: refreshedState.driftReason,
  });

  let heartbeatResult;
  let inventoryResult = null;
  let desiredState = { desiredState: { agents: [] }, pendingOperations: [] };
  let memorySyncResult = null;
  let inventoryFailed = false;
  let memoryFailed = false;
  const memoryPayload = memoryRuntime.buildMachineMemorySyncPayload();

  // Heartbeat is mandatory — fail hard if it doesn't go through
  try {
    heartbeatResult = await withRetry(
      () => apiClient.sendHeartbeat(state.machineId, heartbeat),
      { maxAttempts: 3, baseDelayMs: 1000, label: 'heartbeat' }
    );
  } catch (error) {
    console.error(chalk.red(`❌ Heartbeat failed (fatal): ${error.message}`));
    throw error;
  }

  // Inventory — degraded mode: log warning and continue if transient failure
  try {
    inventoryResult = await withRetry(
      () => apiClient.uploadInventory(state.machineId, inventory),
      { maxAttempts: 3, baseDelayMs: 2000, label: 'inventory' }
    );
  } catch (error) {
    inventoryFailed = true;
    console.warn(chalk.yellow(`⚠️  Inventory upload failed (degraded mode): ${error.message}`));
  }

  // Memory sync — degraded mode: log warning and continue
  if (Array.isArray(memoryPayload.agents) && memoryPayload.agents.length > 0) {
    try {
      memorySyncResult = await withRetry(
        () => apiClient.syncMachineMemory(state.machineId, memoryPayload),
        { maxAttempts: 3, baseDelayMs: 2000, label: 'memory-sync' }
      );
    } catch (error) {
      memoryFailed = true;
      console.warn(chalk.yellow(`⚠️  Memory sync failed (degraded mode): ${error.message}`));
    }
  }

  // Desired state — best effort
  try {
    desiredState = await apiClient.fetchDesiredState(state.machineId);
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Desired state fetch failed: ${error.message}`));
  }

  const syncCompletedAt = new Date().toISOString();
  stateStore.save({
    ...refreshedState,
    lastHeartbeatAt: syncCompletedAt,
    lastDesiredSyncAt: syncCompletedAt,
    lastInventoryUploadedAt: syncCompletedAt,
    lastInventoryHash: inventory.configHash,
    driftDetected:
      Array.isArray(desiredState.pendingOperations) && desiredState.pendingOperations.length > 0,
    driftReason:
      Array.isArray(desiredState.pendingOperations) && desiredState.pendingOperations.length > 0
        ? 'Pending operations waiting for local apply'
        : null,
  });

  console.log(chalk.green('✓ Heartbeat sent'));
  console.log(chalk.gray(`Status: ${heartbeatResult.machine?.status || heartbeat.status}`));

  if (!inventoryFailed) {
    console.log(chalk.green('✓ Inventory uploaded'));
    console.log(
      chalk.gray(
        `Inventory snapshot: ${inventoryResult?.inventory?.id || 'created'} | Agents: ${inventory.agents.length}`
      )
    );
  } else {
    console.log(chalk.yellow('⚠️  Inventory skipped (degraded) — heartbeat still active'));
  }

  if (memorySyncResult) {
    const syncedAgents = Array.isArray(memorySyncResult.results)
      ? memorySyncResult.results.filter((entry) => entry.synced).length
      : 0;
    console.log(
      chalk.green(
        `✓ Memory runtime synced (${syncedAgents}/${memoryPayload.agents.length} agents)`
      )
    );
  } else if (memoryFailed) {
    console.log(chalk.yellow('⚠️  Memory sync skipped (degraded)'));
  } else {
    console.log(chalk.gray('Memory runtime sync skipped (no eligible agent artifacts)'));
  }

  console.log(
    chalk.blue(
      `Desired state received: ${(desiredState.desiredState?.agents || []).length} managed agents, ${(desiredState.pendingOperations || []).length} pending operations`
    )
  );

  const degraded = inventoryFailed || memoryFailed;
  if (degraded) {
    console.log(chalk.yellow('⚠️  Sync completed in degraded mode — some steps were skipped'));
  } else {
    console.log(chalk.green('✅ Sync completed successfully'));
  }

  return {
    success: true,
    degraded,
    machineId: state.machineId,
    syncedAgents: inventory.agents.length,
    memorySyncedAgents: memorySyncResult
      ? Array.isArray(memorySyncResult.results)
        ? memorySyncResult.results.filter((entry) => entry.synced).length
        : 0
      : 0,
    pendingOperationCount: (desiredState.pendingOperations || []).length,
  };
}

if (require.main === module) {
  syncCompanionInventory().catch((error) => {
    console.error(chalk.red(`Companion sync failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = syncCompanionInventory;
