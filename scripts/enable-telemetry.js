#!/usr/bin/env node

require('dotenv').config();
const chalk = require('chalk');
const inquirer = require('inquirer');
const OpenClawConfigManager = require('../src/config-manager');

async function enableTelemetry() {
  console.log(chalk.blue.bold('📊 Enable Ekybot Telemetry'));
  console.log(chalk.gray('Configure automatic agent monitoring and data streaming.\n'));

  const configManager = new OpenClawConfigManager();

  // Check if Ekybot is configured
  if (!configManager.isEkybotConfigured()) {
    console.error(chalk.red('❌ Ekybot integration not configured'));
    console.error(chalk.yellow('Run "npm run register" first to connect your workspace'));
    process.exit(1);
  }

  const currentConfig = configManager.getEkybotConfig();

  console.log(chalk.blue('📋 Current telemetry status:'));
  console.log(chalk.gray(`  Workspace: ${currentConfig.workspace_id}`));
  console.log(
    chalk.gray(`  Telemetry: ${currentConfig.telemetry_enabled ? 'Enabled' : 'Disabled'}`)
  );

  if (currentConfig.telemetry_enabled) {
    console.log(chalk.gray(`  Interval: ${currentConfig.telemetry_interval}ms`));
  }
  console.log('');

  // Explain what telemetry does
  console.log(chalk.yellow('🔍 What does telemetry collect?'));
  console.log(chalk.gray('• Agent status (running/stopped/idle)'));
  console.log(chalk.gray('• Performance metrics (response time, memory usage)'));
  console.log(chalk.gray('• Cost tracking (token usage, model costs)'));
  console.log(chalk.gray('• Conversation metadata (timing, model used)'));
  console.log('');
  console.log(chalk.yellow('🛡️  What is never sent:'));
  console.log(chalk.gray('• Actual conversation content or prompts'));
  console.log(chalk.gray('• Local files or documents'));
  console.log(chalk.gray('• Credentials or API keys'));
  console.log(chalk.gray('• Personal or sensitive information'));
  console.log('');

  // Configuration options
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enableTelemetry',
      message: 'Enable automatic telemetry streaming?',
      default: currentConfig.telemetry_enabled || false,
    },
    {
      type: 'number',
      name: 'interval',
      message: 'Telemetry interval (seconds):',
      default: (currentConfig.telemetry_interval || 60000) / 1000,
      when: (answers) => answers.enableTelemetry,
      validate: (input) => {
        if (input < 30) {
          return 'Minimum interval is 30 seconds';
        }
        if (input > 600) {
          return 'Maximum interval is 600 seconds (10 minutes)';
        }
        return true;
      },
    },
    {
      type: 'confirm',
      name: 'enableWebSocket',
      message: 'Enable real-time WebSocket streaming? (for live dashboard updates)',
      default: false,
      when: (answers) => answers.enableTelemetry,
    },
  ]);

  try {
    // Update configuration
    const config = configManager.readConfig();

    config.integrations.ekybot = {
      ...config.integrations.ekybot,
      telemetry_enabled: answers.enableTelemetry,
      telemetry_interval: answers.enableTelemetry ? answers.interval * 1000 : 60000,
      websocket_enabled: answers.enableWebSocket || false,
      updated_at: new Date().toISOString(),
    };

    configManager.writeConfig(config);

    console.log(chalk.green('\n✅ Telemetry configuration updated!'));

    if (answers.enableTelemetry) {
      console.log(chalk.green('📊 Telemetry is now enabled'));
      console.log(chalk.gray(`   Interval: ${answers.interval} seconds`));
      console.log(chalk.gray(`   WebSocket: ${answers.enableWebSocket ? 'Enabled' : 'Disabled'}`));

      console.log(chalk.blue('\n💡 Next steps:'));
      console.log(chalk.blue('• Run "npm run start" to begin streaming'));
      console.log(chalk.blue('• Visit https://ekybot.com to view your dashboard'));
      console.log(chalk.blue('• Use "npm run health" to monitor the connection'));
    } else {
      console.log(chalk.yellow('📊 Telemetry is now disabled'));
      console.log(chalk.gray('Your agents will run normally but no data will be streamed'));

      console.log(chalk.blue('\n💡 You can enable telemetry anytime:'));
      console.log(chalk.blue('• Run this script again: "npm run enable-telemetry"'));
      console.log(chalk.blue('• Or use: "npm run setup" for full configuration'));
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Failed to update configuration: ${error.message}`));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  enableTelemetry().catch((error) => {
    console.error(chalk.red(`Configuration failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = enableTelemetry;
