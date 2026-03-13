const crypto = require('crypto');
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

  getManagedFragmentPath() {
    const envPath = process.env.EKYBOT_MANAGED_FRAGMENT_PATH;
    if (envPath) {
      return envPath.replace('~', os.homedir());
    }

    return path.join(os.homedir(), '.openclaw', 'managed', 'ekybot.agents.json5');
  }

  resolveHomePath(filePath) {
    return filePath.replace(/^~(?=$|\/|\\)/, os.homedir());
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

  // Write updated configuration (atomic: write temp file then rename)
  writeConfig(config) {
    try {
      // Create backup before modifying
      this.createBackup();

      const configData = JSON.stringify(config, null, 2);
      const tmpPath = `${this.configPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmpPath, configData, 'utf8');
      fs.renameSync(tmpPath, this.configPath); // Atomic on same filesystem

      console.log(chalk.green(`✓ Updated OpenClaw config at ${this.configPath}`));
    } catch (error) {
      console.error(chalk.red(`Failed to write OpenClaw config: ${error.message}`));
      throw error;
    }
  }

  writeFileAtomic(targetPath, content) {
    const resolvedPath = this.resolveHomePath(targetPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    const tmpPath = `${resolvedPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, resolvedPath);
    return resolvedPath;
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

  getIncludePaths() {
    try {
      const config = this.readConfig();
      const includes = [];

      if (Array.isArray(config.$include)) {
        includes.push(...config.$include);
      }

      if (Array.isArray(config.include)) {
        includes.push(...config.include);
      }

      if (typeof config.$include === 'string') {
        includes.push(config.$include);
      }

      if (typeof config.include === 'string') {
        includes.push(config.include);
      }

      return includes;
    } catch (error) {
      return [];
    }
  }

  ensureManagedInclude(managedFragmentPath = this.getManagedFragmentPath()) {
    const config = this.readConfig();
    const includePath = managedFragmentPath;
    const currentIncludes = this.getIncludePaths();
    const alreadyIncluded = currentIncludes.includes(includePath);

    if (alreadyIncluded) {
      return { updated: false, includePath, configPath: this.configPath };
    }

    const nextIncludes = [...currentIncludes, includePath];
    config.$include = nextIncludes;

    if ('include' in config) {
      delete config.include;
    }

    this.writeConfig(config);
    return { updated: true, includePath, configPath: this.configPath };
  }

  writeManagedFragment(desiredState) {
    const fragmentPath = this.resolveHomePath(
      desiredState.managedFragmentPath || this.getManagedFragmentPath()
    );

    const fragment = {
      generatedBy: 'ekybot-companion',
      generatedAt: new Date().toISOString(),
      desiredConfigVersion: desiredState.desiredConfigVersion || 0,
      agents: {
        list: (desiredState.agents || []).map((agent) => ({
          id: agent.openclawAgentId,
          name: agent.name,
          provider: agent.provider || null,
          model: agent.model,
          workspace: agent.workspacePath || null,
          channelKey: agent.channelKey || null,
          projectId: agent.projectId || null,
          metadata: {
            ekybotManaged: true,
            managedBy: 'ekybot-companion',
            templateVersion: agent.templateVersion || null,
          },
        })),
      },
      bindings: desiredState.bindings || [],
    };

    const content = `${JSON.stringify(fragment, null, 2)}\n`;
    this.writeFileAtomic(fragmentPath, content);

    return {
      fragmentPath,
      fragmentHash: crypto.createHash('sha256').update(content).digest('hex'),
    };
  }

  listAgents() {
    try {
      const config = this.readConfig();
      const sourceAgents = Array.isArray(config?.agents)
        ? config.agents
        : Array.isArray(config?.agents?.list)
          ? config.agents.list
          : [];

      return sourceAgents.map((agent, index) => ({
        externalId: agent.id || agent.key || agent.name || `agent-${index + 1}`,
        name: agent.name || agent.id || agent.key || `Agent ${index + 1}`,
        ownership: this.inferAgentOwnership(agent),
        model: agent.model || agent.engine || agent.provider_model || null,
        workspacePath: agent.workspace || agent.workspacePath || agent.path || null,
        channelKey: agent.channelKey || agent.channel || null,
        projectKey: agent.projectKey || agent.project || null,
        metadata: {
          provider: agent.provider || null,
          tools: Array.isArray(agent.tools) ? agent.tools : [],
          rawId: agent.id || null,
          bindings: Array.isArray(agent.bindings) ? agent.bindings : [],
        },
      }));
    } catch (error) {
      return [];
    }
  }

  inferAgentOwnership(agent) {
    const managedFragmentPath = this.getManagedFragmentPath();
    const includesManagedFragment = this.getIncludePaths().some((includePath) =>
      includePath.includes(path.basename(managedFragmentPath))
    );

    if (agent?.metadata?.ekybotManaged || agent?.ekybotManaged) {
      return 'managed';
    }

    if (includesManagedFragment && agent?.workspace && String(agent.workspace).includes('ekybot')) {
      return 'adoptable';
    }

    return 'external';
  }

  // Add Ekybot integration to OpenClaw config
  addEkybotIntegration(workspaceId) {
    try {
      const config = this.readConfig();

      // Initialize integrations if not exists
      if (!config.integrations) {
        config.integrations = {};
      }

      // Add Ekybot configuration (NO API KEY stored here!)
      config.integrations.ekybot = {
        enabled: true,
        workspace_id: workspaceId,
        telemetry_enabled: false, // Disabled by default - requires opt-in
        telemetry_interval: 60000,
        endpoints: {
          api: process.env.EKYBOT_API_URL || 'https://api.ekybot.com',
          websocket: process.env.EKYBOT_WS_URL || 'wss://api.ekybot.com/ws',
        },
        added_at: new Date().toISOString(),
        version: '1.0.0',
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
      return !!(
        config.integrations &&
        config.integrations.ekybot &&
        config.integrations.ekybot.enabled
      );
    } catch (error) {
      return false;
    }
  }

  // Get current Ekybot configuration (with API key from environment)
  getEkybotConfig() {
    try {
      const config = this.readConfig();
      const ekybotConfig = config.integrations?.ekybot || null;

      if (ekybotConfig) {
        // Add API key from environment (not stored in config)
        ekybotConfig.api_key = process.env.EKYBOT_API_KEY || null;
      }

      return ekybotConfig;
    } catch (error) {
      return null;
    }
  }

  // Validate OpenClaw installation
  validateOpenClawInstallation() {
    const checks = {
      configExists: fs.existsSync(this.configPath),
      configValid: false,
      agentsDir: false,
      managedFragmentExists: fs.existsSync(this.getManagedFragmentPath()),
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
    const agentsPath =
      process.env.OPENCLAW_AGENTS_PATH || path.join(os.homedir(), '.openclaw', 'agents');
    checks.agentsDir = fs.existsSync(agentsPath);

    return checks;
  }
}

module.exports = OpenClawConfigManager;
