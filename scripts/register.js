#!/usr/bin/env node

require('dotenv').config();
const inquirer = require('inquirer');
const chalk = require('chalk');
const EkybotApiClient = require('../src/api-client');
const OpenClawConfigManager = require('../src/config-manager');

async function registerWorkspace() {
  console.log(chalk.blue.bold('🚀 Ekybot Connector Registration'));
  console.log(chalk.gray('Connecting your OpenClaw workspace to Ekybot...\n'));

  // Validate OpenClaw installation
  const configManager = new OpenClawConfigManager();
  const validation = configManager.validateOpenClawInstallation();

  if (!validation.configExists) {
    console.error(chalk.red('❌ OpenClaw configuration not found'));
    console.error(chalk.red(`Expected at: ${configManager.configPath}`));
    console.error(chalk.yellow('Please install and configure OpenClaw first.'));
    process.exit(1);
  }

  if (!validation.configValid) {
    console.error(chalk.red('❌ OpenClaw configuration is invalid'));
    console.error(chalk.yellow('Please check your OpenClaw installation.'));
    process.exit(1);
  }

  console.log(chalk.green('✓ OpenClaw installation validated\n'));

  // Check if already configured
  if (configManager.isEkybotConfigured()) {
    const existing = configManager.getEkybotConfig();
    console.log(chalk.yellow('⚠️  Ekybot integration already configured'));
    console.log(chalk.gray(`Workspace ID: ${existing.workspace_id}`));
    
    const { reconfigure } = await inquirer.prompt([{
      type: 'confirm',
      name: 'reconfigure',
      message: 'Do you want to reconfigure?',
      default: false
    }]);

    if (!reconfigure) {
      console.log(chalk.blue('Registration cancelled.'));
      process.exit(0);
    }
  }

  // Get API credentials
  let apiKey = process.env.EKYBOT_API_KEY;
  let workspaceName = process.env.WORKSPACE_NAME;

  if (!apiKey) {
    console.log(chalk.yellow('📋 You need an Ekybot API key to continue.'));
    console.log(chalk.gray('Get your API key at: https://ekybot.com/settings/api\n'));

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'apiKey',
        message: 'Enter your Ekybot API key:',
        validate: (input) => {
          if (!input || input.length < 10) {
            return 'Please enter a valid API key';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'workspaceName',
        message: 'Enter a name for this workspace:',
        default: workspaceName || `openclaw-${require('os').hostname()}`,
        validate: (input) => {
          if (!input || input.length < 3) {
            return 'Workspace name must be at least 3 characters';
          }
          return true;
        }
      }
    ]);

    apiKey = answers.apiKey;
    workspaceName = answers.workspaceName;
  }

  try {
    // Validate API key
    console.log(chalk.blue('🔑 Validating API key...'));
    const apiClient = new EkybotApiClient(apiKey);
    await apiClient.validateApiKey();
    console.log(chalk.green('✓ API key validated\n'));

    // Register workspace
    console.log(chalk.blue('📝 Registering workspace...'));
    const workspace = await apiClient.registerWorkspace(workspaceName);
    console.log(chalk.green(`✓ Workspace registered: ${workspace.id}\n`));

    // Update OpenClaw configuration
    console.log(chalk.blue('⚙️  Updating OpenClaw configuration...'));
    const success = configManager.addEkybotIntegration(workspace.id, apiKey);
    
    if (success) {
      console.log(chalk.green('✓ OpenClaw configuration updated\n'));
    } else {
      throw new Error('Failed to update OpenClaw configuration');
    }

    // Test connection
    console.log(chalk.blue('🔍 Testing connection...'));
    await apiClient.updateWorkspaceStatus(workspace.id, 'connected');
    console.log(chalk.green('✓ Connection test successful\n'));

    // Success message
    console.log(chalk.green.bold('🎉 Registration completed successfully!'));
    console.log(chalk.gray('Your OpenClaw workspace is now connected to Ekybot.'));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.gray('• Run "npm run start" to begin telemetry streaming'));
    console.log(chalk.gray('• Visit https://ekybot.com to view your dashboard'));
    console.log(chalk.gray('• Download mobile apps for remote monitoring'));

    // Save .env file for future use
    if (!process.env.EKYBOT_API_KEY) {
      const envContent = `# Ekybot Connector Configuration\nEKYBOT_API_KEY=${apiKey}\nWORKSPACE_NAME=${workspaceName}\nWORKSPACE_ID=${workspace.id}\n`;
      require('fs').writeFileSync('.env', envContent);
      console.log(chalk.blue('\n💾 Configuration saved to .env file'));
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ Registration failed: ${error.message}`));
    console.error(chalk.yellow('\nTroubleshooting:'));
    console.error(chalk.yellow('• Check your API key at https://ekybot.com/settings/api'));
    console.error(chalk.yellow('• Ensure you have an active internet connection'));
    console.error(chalk.yellow('• Verify OpenClaw is properly installed'));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  registerWorkspace().catch(error => {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    process.exit(1);
  });
}

module.exports = registerWorkspace;