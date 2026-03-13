#!/usr/bin/env node

require('dotenv').config();
const chalk = require('chalk');
const {
  EkybotCompanionApiClient,
  EkybotCompanionStateStore,
  OpenClawConfigManager,
  OpenClawInventoryCollector,
} = require('../src');

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
  heartbeat.runtimeState = {
    lastDesiredSyncAt: refreshedState.lastDesiredSyncAt || null,
    lastInventoryUploadedAt: syncStartedAt,
    lastApplyStartedAt: refreshedState.lastApplyStartedAt || null,
    lastApplyCompletedAt: refreshedState.lastApplyCompletedAt || null,
    lastReconciledAt: refreshedState.lastReconciledAt || null,
    lastAppliedDesiredConfigVersion: refreshedState.lastAppliedDesiredConfigVersion ?? null,
    lastAppliedManagedFragmentPath: refreshedState.lastAppliedManagedFragmentPath || null,
    lastAppliedManagedFragmentHash: refreshedState.lastAppliedManagedFragmentHash || null,
    driftDetected: refreshedState.driftDetected ?? false,
    driftReason: refreshedState.driftReason || null,
  };

  const heartbeatResult = await apiClient.sendHeartbeat(state.machineId, heartbeat);
  const inventoryResult = await apiClient.uploadInventory(state.machineId, inventory);
  const desiredState = await apiClient.fetchDesiredState(state.machineId);

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
