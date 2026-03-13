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

  const heartbeat = inventoryCollector.toHeartbeatPayload();
  const inventory = inventoryCollector.toMachineInventoryPayload();

  const heartbeatResult = await apiClient.sendHeartbeat(state.machineId, heartbeat);
  const inventoryResult = await apiClient.uploadInventory(state.machineId, inventory);
  const desiredState = await apiClient.fetchDesiredState(state.machineId);

  stateStore.save({
    ...state,
    lastHeartbeatAt: new Date().toISOString(),
    lastInventoryHash: inventory.configHash,
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
