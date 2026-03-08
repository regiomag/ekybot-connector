const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

class OpenClawConfigManager {
  constructor() {
    this.configPath = this.getConfigPath();
    this.backupPath = `${this.configPath}.backup`;
  }

  getConfigPath() {
    const envPath = process.env.OPENCLAW_CONFIG_PATH;
    if (envPath) {
      return envPath.replace('~', os.homedir());
    }
    return path.join(os.homedir(), '.openclaw', 'config.json');
  }

  // Read current OpenClaw configuration
  readConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        throw new Error(`OpenClaw config not found at ${this.configPath}`);
      }
      
      const configData = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error(chalk.red(`Failed to read OpenClaw config: ${error.message}`));
      throw error;
    }
  }

  // Write updated configuration
  writeConfig(config) {
    try {
      // Create backup before modifying
      this.createBackup();
      
      const configData = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.configPath, configData, 'utf8');
      
      console.log(chalk.green(`✓ Updated OpenClaw config at ${this.configPath}`));
    } catch (error) {
      console.error(chalk.red(`Failed to write OpenClaw config: ${error.message}`));
      throw error;
    }
  }

  // Create backup of current configuration
  createBackup() {
    try {
      if (fs.existsSync(this.configPath)) {
        fs.copyFileSync(this.configPath, this.backupPath);
        console.log(chalk.yellow(`Created config backup at ${this.backupPath}`));
      }
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Could not create config backup: ${error.message}`));
    }
  }

  // Restore from backup
  restoreBackup() {
    try {
      if (fs.existsSync(this.backupPath)) {
        fs.copyFileSync(this.backupPath, this.configPath);
        console.log(chalk.green(`✓ Restored config from backup`));
        return true;
      } else {
        console.warn(chalk.yellow('No backup file found to restore'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`Failed to restore backup: ${error.message}`));
      return false;
    }
  }

  // Add Ekybot integration to OpenClaw config
  addEkybotIntegration(workspaceId, apiKey) {
    try {
      const config = this.readConfig();
      
      // Initialize integrations if not exists
      if (!config.integrations) {
        config.integrations = {};
      }

      // Add Ekybot configuration
      config.integrations.ekybot = {
        enabled: true,
        workspace_id: workspaceId,
        api_key: apiKey,
        telemetry_enabled: true,
        telemetry_interval: 60000,
        endpoints: {
          api: process.env.EKYBOT_API_URL || 'https://api.ekybot.com',
          websocket: process.env.EKYBOT_WS_URL || 'wss://api.ekybot.com/ws'
        },
        added_at: new Date().toISOString(),
        version: '1.0.0'
      };

      this.writeConfig(config);
      return true;
    } catch (error) {
      console.error(chalk.red(`Failed to add Ekybot integration: ${error.message}`));
      return false;
    }
  }

  // Remove Ekybot integration from OpenClaw config
  removeEkybotIntegration() {
    try {
      const config = this.readConfig();
      
      if (config.integrations && config.integrations.ekybot) {
        delete config.integrations.ekybot;
        
        // Remove integrations object if empty
        if (Object.keys(config.integrations).length === 0) {
          delete config.integrations;
        }

        this.writeConfig(config);
        console.log(chalk.green('✓ Removed Ekybot integration from OpenClaw config'));
        return true;
      } else {
        console.log(chalk.yellow('No Ekybot integration found in config'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`Failed to remove Ekybot integration: ${error.message}`));
      return false;
    }
  }

  // Check if Ekybot integration is configured
  isEkybotConfigured() {
    try {
      const config = this.readConfig();
      return !!(config.integrations && config.integrations.ekybot && config.integrations.ekybot.enabled);
    } catch (error) {
      return false;
    }
  }

  // Get current Ekybot configuration
  getEkybotConfig() {
    try {
      const config = this.readConfig();
      return config.integrations?.ekybot || null;
    } catch (error) {
      return null;
    }
  }

  // Validate OpenClaw installation
  validateOpenClawInstallation() {
    const checks = {
      configExists: fs.existsSync(this.configPath),
      configValid: false,
      agentsDir: false
    };

    // Check config validity
    if (checks.configExists) {
      try {
        const config = this.readConfig();
        checks.configValid = typeof config === 'object' && config !== null;
      } catch (error) {
        checks.configValid = false;
      }
    }

    // Check agents directory
    const agentsPath = process.env.OPENCLAW_AGENTS_PATH || 
                      path.join(os.homedir(), '.openclaw', 'agents');
    checks.agentsDir = fs.existsSync(agentsPath);

    return checks;
  }
}

module.exports = OpenClawConfigManager;