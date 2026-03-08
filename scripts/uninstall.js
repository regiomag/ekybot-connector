#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const OpenClawConfigManager = require('../src/config-manager');

const PID_FILE = path.join(__dirname, '..', 'service.pid');
const LOG_FILE = path.join(__dirname, '..', 'service.log');

async function uninstallConnector() {
  console.log(chalk.blue.bold('🗑️  Ekybot Connector Uninstallation'));
  console.log(chalk.yellow('This will remove all Ekybot integration from your OpenClaw setup.\n'));

  // Confirmation
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Are you sure you want to uninstall the Ekybot connector?',
      default: false,
    },
  ]);

  if (!confirmed) {
    console.log(chalk.blue('Uninstallation cancelled.'));
    process.exit(0);
  }

  // Advanced options
  const { options } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'options',
      message: 'What should be removed?',
      choices: [
        { name: 'Remove Ekybot configuration from OpenClaw', value: 'config', checked: true },
        { name: 'Stop and remove service files', value: 'service', checked: true },
        { name: 'Remove log files', value: 'logs', checked: true },
        { name: 'Remove .env configuration', value: 'env', checked: false },
      ],
    },
  ]);

  console.log('\n' + chalk.blue('🚀 Starting uninstallation...\n'));

  let success = true;

  try {
    // 1. Stop service if running
    if (options.includes('service')) {
      console.log(chalk.blue('1. Stopping service...'));

      if (fs.existsSync(PID_FILE)) {
        try {
          const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
          process.kill(pid, 'SIGTERM');

          // Wait for graceful shutdown
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            process.kill(pid, 0);
            console.log(chalk.yellow('   ⚠️  Process still running, force killing...'));
            process.kill(pid, 'SIGKILL');
          } catch (error) {
            // Process is gone
          }

          console.log(chalk.green('   ✓ Service stopped'));
        } catch (error) {
          if (error.code === 'ESRCH') {
            console.log(chalk.yellow('   ⚠️  Service was already stopped'));
          } else {
            console.log(chalk.red(`   ❌ Failed to stop service: ${error.message}`));
            success = false;
          }
        }
      } else {
        console.log(chalk.gray('   ℹ  Service was not running'));
      }

      // Remove PID file
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
        console.log(chalk.green('   ✓ Removed PID file'));
      }
    }

    // 2. Remove OpenClaw configuration
    if (options.includes('config')) {
      console.log(chalk.blue('\n2. Removing OpenClaw configuration...'));

      const configManager = new OpenClawConfigManager();

      if (configManager.isEkybotConfigured()) {
        const removed = configManager.removeEkybotIntegration();

        if (removed) {
          console.log(chalk.green('   ✓ Ekybot integration removed from OpenClaw config'));
        } else {
          console.log(chalk.red('   ❌ Failed to remove integration from OpenClaw config'));
          success = false;
        }
      } else {
        console.log(chalk.gray('   ℹ  No Ekybot integration found in OpenClaw config'));
      }
    }

    // 3. Remove log files
    if (options.includes('logs')) {
      console.log(chalk.blue('\n3. Removing log files...'));

      if (fs.existsSync(LOG_FILE)) {
        fs.unlinkSync(LOG_FILE);
        console.log(chalk.green('   ✓ Log file removed'));
      } else {
        console.log(chalk.gray('   ℹ  No log file found'));
      }
    }

    // 4. Remove .env file
    if (options.includes('env')) {
      console.log(chalk.blue('\n4. Removing environment configuration...'));

      const envFile = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envFile)) {
        fs.unlinkSync(envFile);
        console.log(chalk.green('   ✓ .env file removed'));
      } else {
        console.log(chalk.gray('   ℹ  No .env file found'));
      }
    }

    // Summary
    if (success) {
      console.log(chalk.green.bold('\n✅ Uninstallation completed successfully!'));
      console.log(chalk.gray('The Ekybot connector has been removed from your system.'));

      console.log(chalk.blue("\n💡 What's left:"));
      console.log(chalk.gray('• Your OpenClaw installation is unchanged'));
      console.log(chalk.gray('• Your Ekybot account and workspace remain active'));
      console.log(chalk.gray('• You can reinstall the connector anytime'));

      console.log(chalk.blue('\n🔄 To reinstall:'));
      console.log(chalk.gray('• Run "npm install" to restore dependencies'));
      console.log(chalk.gray('• Run "npm run register" to reconnect your workspace'));
      console.log(chalk.gray('• Run "npm run start" to resume telemetry streaming'));
    } else {
      console.log(chalk.red.bold('\n❌ Uninstallation completed with errors'));
      console.log(chalk.yellow('Some components may not have been removed completely.'));
      console.log(chalk.yellow('You may need to manually clean up remaining files.'));
    }
  } catch (error) {
    console.error(chalk.red(`\n❌ Uninstallation failed: ${error.message}`));
    console.error(chalk.yellow('You may need to manually remove configuration files.'));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  uninstallConnector().catch((error) => {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    process.exit(1);
  });
}

module.exports = uninstallConnector;
