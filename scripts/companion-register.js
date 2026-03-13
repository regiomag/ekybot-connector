#!/usr/bin/env node

require('dotenv').config();
const chalk = require('chalk');
const inquirer = require('inquirer');
const os = require('os');
const {
  EkybotCompanionApiClient,
  EkybotCompanionStateStore,
  OpenClawConfigManager,
  OpenClawInventoryCollector,
} = require('../src');

async function registerCompanion() {
  console.log(chalk.blue.bold('🤝 Ekybot Companion Registration'));
  console.log(chalk.gray('Registering this machine for inventory-only sync...\n'));

  const stateStore = new EkybotCompanionStateStore();
  const existingState = stateStore.load();

  if (existingState?.machineId) {
    console.log(chalk.yellow('⚠️  A companion machine is already registered.'));
    console.log(chalk.gray(`Machine ID: ${existingState.machineId}`));
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'baseUrl',
      message: 'Ekybot app URL:',
      default: process.env.EKYBOT_APP_URL || existingState?.baseUrl || 'https://www.ekybot.com',
      validate: (input) => {
        try {
          new URL(input);
          return true;
        } catch (error) {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'password',
      name: 'userBearerToken',
      message: 'Temporary user bearer token for registration:',
      default: process.env.EKYBOT_USER_BEARER_TOKEN || undefined,
      validate: (input) => (input && input.length > 20 ? true : 'A bearer token is required for now'),
    },
    {
      type: 'input',
      name: 'machineName',
      message: 'Machine name:',
      default: process.env.EKYBOT_MACHINE_NAME || os.hostname(),
      validate: (input) => (input && input.trim().length >= 3 ? true : 'Enter a machine name'),
    },
  ]);

  const configManager = new OpenClawConfigManager();
  const inventoryCollector = new OpenClawInventoryCollector(configManager, {
    machineName: answers.machineName,
  });

  const apiClient = new EkybotCompanionApiClient({
    baseUrl: answers.baseUrl,
    userBearerToken: answers.userBearerToken,
  });

  const registration = {
    version: '2026-03-13',
    name: answers.machineName,
    platform: inventoryCollector.platform,
    metadata: {
      hostname: os.hostname(),
      configPath: configManager.configPath,
      managedFragmentPath: configManager.getManagedFragmentPath(),
      mode: 'inventory-only',
    },
  };

  const result = await apiClient.registerMachine(registration);
  const machine = result.machine;

  stateStore.save({
    mode: 'inventory-only',
    baseUrl: answers.baseUrl,
    machineId: machine.id,
    machineApiKey: result.apiKey,
    machineName: machine.name,
  });

  console.log(chalk.green('\n✅ Companion machine registered'));
  console.log(chalk.gray(`Machine ID: ${machine.id}`));
  console.log(chalk.gray(`State file: ${stateStore.filePath}`));
  console.log(chalk.blue('\nNext step: run "npm run companion:sync" to send heartbeat and inventory.'));
}

if (require.main === module) {
  registerCompanion().catch((error) => {
    console.error(chalk.red(`Registration failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = registerCompanion;
