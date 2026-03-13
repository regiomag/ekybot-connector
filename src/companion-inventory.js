const crypto = require('crypto');
const fs = require('fs');
const os = require('os');

class OpenClawInventoryCollector {
  constructor(configManager, options = {}) {
    this.configManager = configManager;
    this.machineName = options.machineName || process.env.EKYBOT_MACHINE_NAME || os.hostname();
    this.platform = options.platform || this.detectPlatform();
  }

  detectPlatform() {
    const platform = os.platform();

    if (platform === 'darwin') {
      return 'macos';
    }

    if (platform === 'win32') {
      return 'windows';
    }

    return 'linux';
  }

  computeConfigHash() {
    if (!fs.existsSync(this.configManager.configPath)) {
      return null;
    }

    const rawConfig = fs.readFileSync(this.configManager.configPath, 'utf8');
    return crypto.createHash('sha256').update(rawConfig).digest('hex');
  }

  collect() {
    const config = this.configManager.readConfig();
    const validation = this.configManager.validateOpenClawInstallation();
    const agents = this.configManager.listAgents();
    const includePaths = this.configManager.getIncludePaths();
    const managedFragmentPath = this.configManager.getManagedFragmentPath();

    return {
      version: '2026-03-13',
      machineName: this.machineName,
      platform: this.platform,
      openClaw: {
        configPath: this.configManager.configPath,
        configHash: this.computeConfigHash(),
        includes: includePaths,
        managedFragmentPath,
        mode: config?.mode || null,
        hasManagedFragment: fs.existsSync(managedFragmentPath),
      },
      system: {
        hostname: os.hostname(),
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        nodeVersion: process.version,
      },
      validation,
      agents,
      collectedAt: new Date().toISOString(),
    };
  }

  toMachineInventoryPayload() {
    const inventory = this.collect();

    return {
      version: inventory.version,
      configHash: inventory.openClaw.configHash,
      openClawVersion: inventory.openClaw.mode || null,
      configPath: inventory.openClaw.configPath,
      managedFragmentPath: inventory.openClaw.managedFragmentPath,
      metadata: {
        includes: inventory.openClaw.includes,
        hasManagedFragment: inventory.openClaw.hasManagedFragment,
        validation: inventory.validation,
        system: inventory.system,
      },
      agents: inventory.agents.map((agent) => ({
        externalId: agent.externalId,
        name: agent.name,
        ownership: agent.ownership,
        model: agent.model,
        workspacePath: agent.workspacePath,
        channelKey: agent.channelKey,
        projectKey: agent.projectKey,
        metadata: agent.metadata,
      })),
    };
  }

  toHeartbeatPayload() {
    const inventory = this.collect();

    return {
      version: inventory.version,
      status: inventory.validation.configExists && inventory.validation.configValid ? 'online' : 'error',
      activeConfigHash: inventory.openClaw.configHash,
      metadata: {
        agentCount: inventory.agents.length,
        configPath: inventory.openClaw.configPath,
        managedFragmentPath: inventory.openClaw.managedFragmentPath,
        validation: inventory.validation,
      },
    };
  }
}

module.exports = OpenClawInventoryCollector;
