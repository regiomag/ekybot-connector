#!/usr/bin/env node

require('dotenv').config();
const chalk = require('chalk');
const OpenClawConfigManager = require('../src/config-manager');

async function previewChanges() {
  console.log(chalk.blue.bold('🔍 Ekybot Connector - Preview Changes'));
  console.log(
    chalk.gray(
      'This shows what would happen without making any actual changes.\n'
    )
  );

  try {
    const configManager = new OpenClawConfigManager();

    // Check OpenClaw installation
    console.log(chalk.blue('📋 OpenClaw Installation Check:'));
    const validation = configManager.validateOpenClawInstallation();

    if (validation.configExists) {
      console.log(
        chalk.green(`  ✓ Config file found: ${configManager.configPath}`)
      );
    } else {
      console.log(
        chalk.red(`  ❌ Config file missing: ${configManager.configPath}`)
      );
    }

    if (validation.configValid) {
      console.log(chalk.green('  ✓ Configuration is valid'));
    } else {
      console.log(chalk.red('  ❌ Configuration is invalid or corrupted'));
    }

    if (validation.agentsDir) {
      console.log(chalk.green('  ✓ Agents directory found'));
    } else {
      console.log(chalk.yellow('  ⚠️  Agents directory not found'));
    }

    // Preview configuration changes
    console.log(chalk.blue('\n⚙️  Configuration Changes Preview:'));

    if (!validation.configExists) {
      console.log(
        chalk.red(
          '  Cannot preview changes - OpenClaw config file not found'
        )
      );
      return;
    }

    const currentConfig = configManager.readConfig();
    const hasEkybotIntegration = configManager.isEkybotConfigured();

    if (hasEkybotIntegration) {
      console.log(chalk.yellow('  ⚠️  Ekybot integration already configured'));
      const ekybotConfig = configManager.getEkybotConfig();
      console.log(
        chalk.gray(`    Workspace ID: ${ekybotConfig.workspace_id}`)
      );
      console.log(
        chalk.gray(
          `    Telemetry: ${
            ekybotConfig.telemetry_enabled ? 'Enabled' : 'Disabled'
          }`
        )
      );
    } else {
      console.log(
        chalk.green('  ✓ Ready for new Ekybot integration setup')
      );
    }

    // Show what would be added to config
    console.log(chalk.blue('\n📝 Configuration Changes That Would Be Made:'));
    console.log(chalk.gray('  File: ~/.openclaw/config.json'));
    console.log(chalk.gray('  Section: integrations.ekybot'));
    console.log(chalk.gray('  Changes:'));
    console.log(
      chalk.gray('    + enabled: true')
    );
    console.log(
      chalk.gray('    + workspace_id: [from registration]')
    );
    console.log(
      chalk.gray('    + telemetry_enabled: false (opt-in required)')
    );
    console.log(
      chalk.gray('    + telemetry_interval: 60000')
    );
    console.log(
      chalk.gray('    + endpoints.api: https://api.ekybot.com')
    );
    console.log(
      chalk.gray('    + endpoints.websocket: wss://api.ekybot.com/ws')
    );

    // Show environment file changes
    console.log(chalk.blue('\n🔐 Environment File Changes:'));
    const envFile = '.env';
    console.log(chalk.gray(`  File: ${envFile}`));
    console.log(chalk.gray('  Changes:'));
    console.log(chalk.gray('    + EKYBOT_API_KEY=[your-api-key]'));
    console.log(chalk.gray('    + WORKSPACE_NAME=[workspace-name]'));
    console.log(chalk.gray('    + WORKSPACE_ID=[generated-id]'));

    // Show data that would be sent
    console.log(chalk.blue('\n📊 Data That Would Be Transmitted:'));
    console.log(chalk.green('  ✅ Agent status (running/stopped/idle)'));
    console.log(chalk.green('  ✅ Performance metrics (response time, memory)'));
    console.log(chalk.green('  ✅ Cost tracking (token usage, model costs)'));
    console.log(chalk.green('  ✅ Conversation metadata (timing, model used)'));
    console.log(chalk.red('  ❌ Never sent: Conversation content'));
    console.log(chalk.red('  ❌ Never sent: Local files or documents'));
    console.log(chalk.red('  ❌ Never sent: Credentials or API keys'));

    // Show network connections
    console.log(chalk.blue('\n🌐 Network Connections That Would Be Made:'));
    console.log(chalk.gray('  HTTPS API calls to: https://api.ekybot.com'));
    console.log(chalk.gray('  Purpose: Registration, telemetry, health checks'));
    console.log(chalk.gray('  Frequency: Every 60 seconds (when enabled)'));
    console.log(
      chalk.gray('  WebSocket: wss://api.ekybot.com/ws (optional)')
    );
    console.log(chalk.gray('  Purpose: Real-time dashboard updates'));

    // Show background processes
    console.log(chalk.blue('\n⚙️  Background Processes:'));
    console.log(chalk.gray('  Service: Telemetry collector'));
    console.log(chalk.gray('  Memory usage: ~10MB'));
    console.log(chalk.gray('  CPU usage: Minimal (periodic data collection)'));
    console.log(chalk.gray('  Auto-start: No (manual start required)'));

    // Summary and next steps
    console.log(chalk.blue.bold('\n📋 Summary:'));
    console.log(chalk.gray('This connector would:'));
    console.log(chalk.gray('  • Add Ekybot integration to OpenClaw config'));
    console.log(chalk.gray('  • Store API credentials in .env file only'));
    console.log(chalk.gray('  • Enable optional telemetry streaming'));
    console.log(chalk.gray('  • Provide remote monitoring capabilities'));

    console.log(chalk.blue.bold('\n🔄 Next Steps (if you proceed):'));
    console.log(chalk.gray('  1. npm run register     # Connect to Ekybot'));
    console.log(
      chalk.gray('  2. npm run enable-telemetry  # Configure data sharing')
    );
    console.log(chalk.gray('  3. npm run start         # Begin monitoring'));

    console.log(chalk.blue.bold('\n🛡️  Security Notes:'));
    console.log(chalk.gray('  • No data sent without explicit opt-in'));
    console.log(chalk.gray('  • Complete uninstall available anytime'));
    console.log(chalk.gray('  • Full source code available for audit'));
    console.log(chalk.gray('  • All changes are reversible'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Preview failed: ${error.message}`));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  previewChanges().catch((error) => {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    process.exit(1);
  });
}

module.exports = previewChanges;