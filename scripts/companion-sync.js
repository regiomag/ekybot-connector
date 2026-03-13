#!/usr/bin/env node

require('../src/load-env')();
const chalk = require('chalk');
const {
  EkybotCompanionApiClient,
  EkybotCompanionStateStore,
  OpenClawConfigManager,
  OpenClawInventoryCollector,
} = require('../src');
const { buildCompanionRuntimeState } = require('../src/companion-runtime-state');

async function syncCompanionInventory() {
  console.log(chalk.blue.bold('🔄 Ekybot Companion Sync'));

  const stateStore = new EkybotCompanionStateStore();
  const state = stateStore.load();

  if (!state?.machineId || !state?.machineApiKey) {
    console.error(chalk.red('❌ No companion machine registered'));
    console.error(chalk.yellow('Run "npm run companion:register" first.'));
    process.exit(1);
  }

  const configManager = new OpenClawConfigManager();
  const inventoryCollector = new OpenClawInventoryCollector(configManager, {
    machineName: state.machineName,
  });

  const apiClient = new EkybotCompanionApiClient({
    baseUrl: state.baseUrl,
    machineApiKey: state.machineApiKey,
  });

  const syncStartedAt = new Date().toISOString();
  const refreshedState = stateStore.load() || state;
  const heartbeat = inventoryCollector.toHeartbeatPayload(state.machineId);
  const inventory = inventoryCollector.toMachineInventoryPayload(state.machineId);
  heartbeat.runtimeState = buildCompanionRuntimeState({
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
  let inventoryResult;
  let desiredState;

  try {
    heartbeatResult = await apiClient.sendHeartbeat(state.machineId, heartbeat);
  } catch (error) {
    console.error(chalk.red(`Heartbeat payload: ${JSON.stringify(heartbeat, null, 2)}`));
    throw error;
  }

  try {
    inventoryResult = await apiClient.uploadInventory(state.machineId, inventory);
  } catch (error) {
    console.error(chalk.red(`Inventory payload: ${JSON.stringify(inventory, null, 2)}`));
    throw error;
  }

  desiredState = await apiClient.fetchDesiredState(state.machineId);

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
  console.log(chalk.green('✓ Inventory uploaded'));
  console.log(chalk.gray(`Status: ${heartbeatResult.machine?.status || heartbeat.status}`));
  console.log(
    chalk.gray(
      `Inventory snapshot: ${inventoryResult.inventory?.id || 'created'} | Agents: ${inventory.agents.length}`
    )
  );
  console.log(
    chalk.blue(
      `Desired state received: ${(desiredState.desiredState?.agents || []).length} managed agents, ${(desiredState.pendingOperations || []).length} pending operations`
    )
  );
}

if (require.main === module) {
  syncCompanionInventory().catch((error) => {
    console.error(chalk.red(`Companion sync failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = syncCompanionInventory;
