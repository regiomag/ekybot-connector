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

  toMachineInventoryPayload(machineId) {
    const inventory = this.collect();

    return {
      protocolVersion: inventory.version,
      machineId,
      configHash: inventory.openClaw.configHash,
      rootConfigPath: inventory.openClaw.configPath,
      managedFragmentPaths: inventory.openClaw.managedFragmentPath
        ? [inventory.openClaw.managedFragmentPath, ...inventory.openClaw.includes]
        : inventory.openClaw.includes,
      warnings: [],
      scannedAt: inventory.collectedAt,
      agents: inventory.agents.map((agent) => ({
        openclawAgentId: agent.externalId,
        name: agent.name,
        ownership: agent.ownership,
        model: agent.model,
        workspacePath: agent.workspacePath,
        channelKey: agent.channelKey,
        projectHint: agent.projectKey,
        bindings: Array.isArray(agent.metadata?.bindings) ? agent.metadata.bindings : [],
        fingerprint: null,
        warnings: [],
      })),
    };
  }

  toHeartbeatPayload(machineId) {
    const inventory = this.collect();

    return {
      protocolVersion: inventory.version,
      machineId,
      status: inventory.validation.configExists && inventory.validation.configValid ? 'online' : 'error',
      lastSeenAt: inventory.collectedAt,
      openclawReachable: inventory.validation.configExists && inventory.validation.configValid,
      plotterHealthy: null,
      pendingOperationCount: 0,
      activeConfigHash: inventory.openClaw.configHash,
    };
  }
}

module.exports = OpenClawInventoryCollector;
