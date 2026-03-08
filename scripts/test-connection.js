#!/usr/bin/env node

require('dotenv').config();
const chalk = require('chalk');
const EkybotApiClient = require('../src/api-client');
const OpenClawConfigManager = require('../src/config-manager');

async function testConnection() {
  console.log(chalk.blue.bold('🔍 Testing Ekybot API Connection\n'));

  // Load configuration
  const configManager = new OpenClawConfigManager();

  if (!configManager.isEkybotConfigured()) {
    console.error(chalk.red('❌ Ekybot integration not configured'));
    console.error(chalk.yellow('Run "npm run register" first to set up the connection'));
    process.exit(1);
  }

  const config = configManager.getEkybotConfig();

  if (!config.workspace_id || !config.api_key) {
    console.error(chalk.red('❌ Invalid Ekybot configuration'));
    console.error(chalk.yellow('Run "npm run register" to reconfigure'));
    process.exit(1);
  }

  console.log(chalk.gray(`Workspace ID: ${config.workspace_id}`));
  console.log(chalk.gray(`API Endpoint: ${config.endpoints?.api || 'https://api.ekybot.com'}`));
  console.log('');

  const apiClient = new EkybotApiClient(config.api_key, config.endpoints?.api);

  try {
    // 1. Health check
    console.log(chalk.blue('1. Testing API health...'));
    const startTime = Date.now();
    const healthResponse = await apiClient.healthCheck();
    const responseTime = Date.now() - startTime;

    console.log(chalk.green(`   ✓ API is responding (${responseTime}ms)`));
    console.log(chalk.gray(`   Response: ${JSON.stringify(healthResponse, null, 2)}\n`));

    // 2. API key validation
    console.log(chalk.blue('2. Validating API key...'));
    const authResponse = await apiClient.validateApiKey();
    console.log(chalk.green('   ✓ API key is valid'));
    console.log(chalk.gray(`   User: ${authResponse.user?.email || 'Unknown'}\n`));

    // 3. Workspace info
    console.log(chalk.blue('3. Fetching workspace information...'));
    const workspaceInfo = await apiClient.getWorkspaceInfo(config.workspace_id);
    console.log(chalk.green('   ✓ Workspace accessible'));
    console.log(chalk.gray(`   Name: ${workspaceInfo.name}`));
    console.log(chalk.gray(`   Status: ${workspaceInfo.status}`));
    console.log(chalk.gray(`   Created: ${workspaceInfo.created_at}\n`));

    // 4. Update workspace status
    console.log(chalk.blue('4. Testing workspace update...'));
    await apiClient.updateWorkspaceStatus(config.workspace_id, 'connected');
    console.log(chalk.green('   ✓ Workspace status updated\n'));

    // 5. Test telemetry endpoint
    console.log(chalk.blue('5. Testing telemetry endpoint...'));
    const testTelemetry = {
      test: true,
      timestamp: new Date().toISOString(),
      connector_version: '1.0.0',
    };
    await apiClient.sendTelemetry(config.workspace_id, testTelemetry);
    console.log(chalk.green('   ✓ Telemetry endpoint working\n'));

    // Success summary
    console.log(chalk.green.bold('🎉 Connection test completed successfully!'));
    console.log(chalk.gray('All API endpoints are accessible and working correctly.'));
    console.log(chalk.gray('Your connector is ready to stream telemetry data.'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Connection test failed: ${error.message}`));

    // Provide specific troubleshooting advice
    if (error.message.includes('401') || error.message.includes('unauthorized')) {
      console.error(chalk.yellow('\n🔑 Authentication issue:'));
      console.error(chalk.yellow('• Check your API key at https://ekybot.com/settings/api'));
      console.error(chalk.yellow('• Make sure the API key has the correct permissions'));
      console.error(chalk.yellow('• Try regenerating your API key'));
    } else if (error.message.includes('404')) {
      console.error(chalk.yellow('\n📍 Resource not found:'));
      console.error(chalk.yellow('• Your workspace may have been deleted'));
      console.error(chalk.yellow('• Run "npm run register" to create a new workspace'));
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      console.error(chalk.yellow('\n🌐 Network issue:'));
      console.error(chalk.yellow('• Check your internet connection'));
      console.error(chalk.yellow('• Verify firewall settings'));
      console.error(chalk.yellow("• Check if you're behind a corporate proxy"));
    } else {
      console.error(chalk.yellow('\n🔧 General troubleshooting:'));
      console.error(chalk.yellow('• Run "npm run health" for a comprehensive check'));
      console.error(chalk.yellow('• Check the service logs for more details'));
      console.error(chalk.yellow('• Contact support if the issue persists'));
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  testConnection().catch((error) => {
    console.error(chalk.red(`Fatal error: ${error.message}`));
    process.exit(1);
  });
}

module.exports = testConnection;
