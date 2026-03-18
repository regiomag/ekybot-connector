#!/usr/bin/env node

require('../src/load-env')();
const chalk = require('chalk');
const inquirer = require('inquirer');
const os = require('os');
const {
  EkybotCompanionApiClient,
  OpenClawConfigManager,
  OpenClawInventoryCollector,
  EkybotCompanionStateStore,
} = require('../src');

async function registerCompanion() {
  console.log(chalk.blue.bold('🤝 Ekybot Companion Registration'));
  console.log(chalk.gray('Registering this machine for inventory-only sync...\n'));

  const stateStore = new EkybotCompanionStateStore();
  const existingState = stateStore.load();

  const forceRegister = String(process.env.EKYBOT_COMPANION_FORCE_REGISTER || '').toLowerCase();
  const shouldForceRegister = ['1', 'true', 'yes', 'y'].includes(forceRegister);

  if (existingState?.machineId) {
    console.log(chalk.yellow('⚠️  A companion machine is already registered.'));
    console.log(chalk.gray(`Machine ID: ${existingState.machineId}`));

    if (!shouldForceRegister) {
      console.log(chalk.green('\n✅ Registration already satisfied (idempotent skip)'));
      console.log(chalk.gray('Set EKYBOT_COMPANION_FORCE_REGISTER=1 to force re-registration.'));
      return;
    }

    console.log(chalk.blue('Force mode enabled: re-registering machine...'));
  }

  const defaults = {
    baseUrl: process.env.EKYBOT_APP_URL || existingState?.baseUrl || 'https://www.ekybot.com',
    registrationToken: process.env.EKYBOT_COMPANION_REGISTRATION_TOKEN || '',
    machineName: process.env.EKYBOT_MACHINE_NAME || os.hostname(),
  };

  let answers = defaults;

  const hasNonInteractiveInputs =
    Boolean(defaults.baseUrl) &&
    Boolean(defaults.registrationToken) &&
    defaults.registrationToken.startsWith('ekrt_') &&
    Boolean(defaults.machineName);

  if (!hasNonInteractiveInputs) {
    answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Ekybot app URL:',
        default: defaults.baseUrl,
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
        name: 'registrationToken',
        message: 'Companion registration token:',
        default: defaults.registrationToken || undefined,
        validate: (input) =>
          input && input.startsWith('ekrt_') ? true : 'A registration token is required',
      },
      {
        type: 'input',
        name: 'machineName',
        message: 'Machine name:',
        default: defaults.machineName,
        validate: (input) => (input && input.trim().length >= 3 ? true : 'Enter a machine name'),
      },
    ]);
  } else {
    try {
      new URL(defaults.baseUrl);
    } catch (error) {
      throw new Error('EKYBOT_APP_URL must be a valid URL');
    }
    console.log(chalk.gray('Using non-interactive environment configuration.'));
  }

  const configManager = new OpenClawConfigManager();
  const machineFingerprint = stateStore.computeMachineFingerprint(configManager.configPath);
  process.env.EKYBOT_MACHINE_FINGERPRINT = machineFingerprint;
  const inventoryCollector = new OpenClawInventoryCollector(configManager, {
    machineName: answers.machineName,
  });

  const apiClient = new EkybotCompanionApiClient({
    baseUrl: answers.baseUrl,
    registrationToken: answers.registrationToken,
  });

  const registration = {
    protocolVersion: '2026-03-13',
    machineId: existingState?.machineId || `machine-${os.hostname()}`,
    machineName: answers.machineName,
    machineFingerprint,
    rootConfigPath: configManager.configPath,
    platform: inventoryCollector.platform,
    companionVersion: '0.1.0',
    openclawVersion: 'unknown',
    publicKey: undefined,
  };

  const result = await apiClient.registerMachine(registration);
  const machine = result.machine;

  stateStore.save({
    mode: 'inventory-only',
    baseUrl: answers.baseUrl,
    machineId: machine.id,
    machineApiKey: result.apiKey,
    machineName: machine.machineName,
    machineFingerprint,
    rootConfigPath: configManager.configPath,
  });

  console.log(chalk.green('\n✅ Companion machine registered'));
  console.log(chalk.gray(`Machine ID: ${machine.id}`));
  console.log(chalk.gray(`State file: ${stateStore.filePath}`));
  console.log(chalk.blue('\nNext step: run "npm run companion:sync" to send heartbeat and inventory.'));

  return {
    machineId: machine.id,
    machineName: machine.machineName,
    stateFilePath: stateStore.filePath,
    baseUrl: answers.baseUrl,
  };
}

if (require.main === module) {
  registerCompanion().catch((error) => {
    console.error(chalk.red(`Registration failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = registerCompanion;
