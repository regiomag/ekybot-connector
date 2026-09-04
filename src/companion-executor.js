const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const chalk = require('chalk');

class EkybotCompanionExecutor {
  constructor(apiClient, configManager, stateStore, options = {}) {
    this.apiClient = apiClient;
    this.configManager = configManager;
    this.stateStore = stateStore;
    this.logger = options.logger || console;
  }

  hashString(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  async applyDesiredState(machineId, options = {}) {
    const applyStartedAt = new Date().toISOString();
    this.stateStore.merge({
      lastApplyStartedAt: applyStartedAt,
    });

    const response = options.prefetchedDesiredState || (await this.apiClient.fetchDesiredState(machineId));
    const desiredState = response?.desiredState;
    const pendingOperations = response?.pendingOperations || [];

    if (!desiredState) {
      throw new Error('Missing desired state payload');
    }

    const persistedState = this.stateStore.load() || {};
    const needsImplicitManagedFragmentSync =
      desiredState.desiredConfigVersion !==
      (persistedState.lastAppliedDesiredConfigVersion ?? null);

    const applied = [];
    let implicitSyncApplied = false;

    if (needsImplicitManagedFragmentSync && pendingOperations.length === 0) {
      const includeInfo = this.configManager.ensureManagedInclude(
        desiredState.managedFragmentPath
      );
      const fragmentInfo = this.configManager.writeManagedFragment(desiredState);

      this.stateStore.merge({
        lastAppliedDesiredConfigVersion: desiredState.desiredConfigVersion,
        lastAppliedManagedFragmentPath: fragmentInfo.fragmentPath,
        lastAppliedManagedFragmentHash: fragmentInfo.fragmentHash,
      });

      this.logger.log(
        chalk.green(
          `✓ desired state synced (${desiredState.agents.length} managed agents written)`
        )
      );

      implicitSyncApplied = true;

      if (includeInfo.updated) {
        this.logger.log(chalk.green('✓ managed include bootstrapped'));
      }
    }

    for (const operation of pendingOperations) {
      try {
        await this.applyOperation(machineId, operation, desiredState);
        applied.push(operation.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown execution error';
        await this.apiClient.updateOperation(machineId, operation.id, {
          status: 'failed',
          error: message,
          result: {
            attemptedAt: new Date().toISOString(),
          },
        });
        this.logger.error(chalk.red(`✗ Operation ${operation.type} failed: ${message}`));
      }
    }

    const applyCompletedAt = new Date().toISOString();
    const failedOperationCount = pendingOperations.length - applied.length;
    const nextDriftDetected =
      failedOperationCount > 0 ||
      pendingOperations.some((operation) => !applied.includes(operation.id));

    this.stateStore.merge({
      lastApplyCompletedAt: applyCompletedAt,
      lastDesiredSyncAt: applyCompletedAt,
      driftDetected: nextDriftDetected,
      driftReason: nextDriftDetected
        ? failedOperationCount > 0
          ? 'Some pending operations failed during local apply'
          : 'Pending operations remain after local apply'
        : null,
    });

    return {
      desiredState,
      pendingOperations,
      appliedOperationIds: applied,
      failedOperationCount,
      applyStartedAt,
      applyCompletedAt,
      implicitSyncApplied,
    };
  }

  async applyOperation(machineId, operation, desiredState) {
    const appliesManagedState = new Set([
      'bootstrap_include',
      'import_agent',
      'create_agent',
      'create_runtime_agent',
      'update_agent_model',
      'update_runtime_agent',
      'update_agent_bindings',
      'update_workspace_templates',
      'archive_agent',
    ]);

    // Runtime-neutral operation types (create_runtime_agent / update_runtime_agent) are
    // emitted by newer web builds; the legacy types stay accepted for compatibility.
    const isCreateAgentOp =
      operation.type === 'create_agent' || operation.type === 'create_runtime_agent';
    const isUpdateModelOp =
      operation.type === 'update_agent_model' || operation.type === 'update_runtime_agent';

    // Handle Hermes profile creation
    if (isCreateAgentOp && operation.payload?.action === 'create_hermes_profile') {
      const profileName = operation.payload.profileName;
      if (!profileName || typeof profileName !== 'string') {
        throw new Error('Missing profileName in create_hermes_profile payload');
      }

      const hermesHome = path.join(os.homedir(), '.hermes', 'profiles', profileName);
      const alreadyExists = fs.existsSync(hermesHome);

      if (alreadyExists) {
        this.logger.log(chalk.yellow(`[hermes-profile] Profile "${profileName}" already exists — skipping creation`));
        await this.apiClient.updateOperation(machineId, operation.id, {
          status: 'applied',
          result: { appliedAt: new Date().toISOString(), profileName, alreadyExists: true },
        });
        return;
      }

      // Create profile via hermes CLI
      const result = await new Promise((resolve, reject) => {
        const hermesBin = path.join(os.homedir(), '.local', 'bin', 'hermes');
        const hermesProject = path.join(os.homedir(), '.openclaw', 'hermes-agent');
        const venvBin = path.join(hermesProject, 'venv', 'bin');

        const env = { ...process.env };
        env.PATH = [venvBin, path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', env.PATH].join(':');
        env.VIRTUAL_ENV = path.join(hermesProject, 'venv');

        const proc = spawn(hermesBin, ['profile', 'create', profileName, '--clone', '--no-alias'], {
          cwd: hermesProject,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30000,
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
          if (code === 0) {
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
          } else {
            reject(new Error(`hermes profile create failed (exit ${code}): ${stderr.trim() || stdout.trim()}`));
          }
        });
        proc.on('error', reject);
      });

      // Create empty memory seed for this project
      const seedsDir = path.join(__dirname, '..', 'memory-seeds');
      const seedPath = path.join(seedsDir, `${profileName}.json`);
      if (!fs.existsSync(seedPath)) {
        const seed = {
          project: {
            name: operation.payload.channelKey || profileName,
            summary: `Projet ${profileName} — créé automatiquement via Ekybot.`,
            phase: 'Initialisation',
          },
          decisions: [],
          safety: {
            rules: ['Respecter la politique de confidentialité du projet'],
          },
        };
        fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2), 'utf-8');
        this.logger.log(chalk.green(`[hermes-profile] Created memory seed: ${seedPath}`));
      }

      await this.apiClient.updateOperation(machineId, operation.id, {
        status: 'applied',
        result: {
          appliedAt: new Date().toISOString(),
          profileName,
          profilePath: hermesHome,
          seedCreated: !fs.existsSync(seedPath),
          output: result.stdout.substring(0, 500),
        },
      });

      this.logger.log(chalk.green(`✓ Hermes profile "${profileName}" created`));
      return;
    }

    // Handle Hermes model update
    if (isUpdateModelOp && operation.payload?.action === 'update_hermes_model') {
      const { profileName: profile, model: newModel } = operation.payload;
      if (!profile || !newModel) {
        throw new Error('Missing profileName or model in update_hermes_model payload');
      }

      const hermesHome = profile === 'default'
        ? path.join(os.homedir(), '.hermes')
        : path.join(os.homedir(), '.hermes', 'profiles', profile);
      const configPath = path.join(hermesHome, 'config.yaml');

      if (!fs.existsSync(configPath)) {
        throw new Error(`Hermes config not found: ${configPath}`);
      }

      // Read, update model.default, write back
      let config = fs.readFileSync(configPath, 'utf-8');
      const modelMatch = config.match(/^(\s*default:\s*).+$/m);
      if (modelMatch) {
        config = config.replace(/^(\s*default:\s*).+$/m, `$1${newModel}`);
      } else {
        // No model.default found — prepend it
        config = `model:\n  default: ${newModel}\n  provider: openrouter\n${config}`;
      }
      fs.writeFileSync(configPath, config, 'utf-8');

      await this.apiClient.updateOperation(machineId, operation.id, {
        status: 'applied',
        result: {
          appliedAt: new Date().toISOString(),
          profileName: profile,
          newModel,
          configPath,
        },
      });

      this.logger.log(chalk.green(`✓ Hermes profile "${profile}" model updated to ${newModel}`));
      return;
    }

    // Handle session reset — invalidate the CLI session for an agent
    if (operation.type === 'reset_session') {
      const payload = operation.payload || {};
      const agentId = payload.openclawAgentId;
      if (!agentId) {
        throw new Error('Missing openclawAgentId in reset_session payload');
      }

      const newGeneration = this.stateStore.incrementSessionResetGeneration(agentId);
      this.logger.log(
        chalk.green(
          `✓ reset_session applied for ${agentId} (generation=${newGeneration}, reason=${payload.reason || 'unknown'})`
        )
      );

      await this.apiClient.updateOperation(machineId, operation.id, {
        status: 'applied',
        result: {
          appliedAt: new Date().toISOString(),
          openclawAgentId: agentId,
          newSessionGeneration: newGeneration,
          reason: payload.reason || 'unknown',
        },
      });
      return;
    }

    if (operation.type === 'scan_inventory') {
      await this.apiClient.updateOperation(machineId, operation.id, {
        status: 'applied',
        result: {
          appliedAt: new Date().toISOString(),
          action: 'inventory_rescan_requested',
        },
      });
      this.logger.log(chalk.green('✓ scan_inventory acknowledged'));
      return;
    }

    if (appliesManagedState.has(operation.type)) {
      const includeInfo = this.configManager.ensureManagedInclude(
        desiredState.managedFragmentPath
      );
      const fragmentInfo = this.configManager.writeManagedFragment(desiredState);

      const persistedState = this.stateStore.load() || {};
      this.stateStore.save({
        ...persistedState,
        lastAppliedDesiredConfigVersion: desiredState.desiredConfigVersion,
        lastAppliedManagedFragmentPath: fragmentInfo.fragmentPath,
        lastAppliedManagedFragmentHash: fragmentInfo.fragmentHash,
      });

      await this.apiClient.updateOperation(machineId, operation.id, {
        status: 'applied',
        result: {
          appliedAt: new Date().toISOString(),
          desiredConfigVersion: desiredState.desiredConfigVersion,
          includeUpdated: includeInfo.updated,
          fragmentPath: fragmentInfo.fragmentPath,
          fragmentHash: fragmentInfo.fragmentHash,
          managedAgentCount: desiredState.agents.length,
        },
      });

      this.logger.log(
        chalk.green(
          `✓ ${operation.type} applied (${desiredState.agents.length} managed agents written)`
        )
      );
      return;
    }

    if (operation.type === 'delete_agent') {
      const payload = operation.payload || {};
      const removeInfo = this.configManager.removeAgentFromConfig({
        openclawAgentId: payload.openclawAgentId,
        workspacePath: payload.workspacePath,
        name: payload.name,
      });
      const preserveWorkspace = payload.preserveWorkspace === true;
      const workspaceInfo = preserveWorkspace
        ? {
            deleted: false,
            preserved: true,
            reason: 'preserve_workspace_requested',
            workspacePath: payload.workspacePath || null,
          }
        : this.configManager.deleteWorkspace(payload.workspacePath);
      const includeInfo = this.configManager.ensureManagedInclude(
        desiredState.managedFragmentPath
      );
      const fragmentInfo = this.configManager.writeManagedFragment(desiredState);
      const managedFragmentRemoveInfo = this.configManager.removeAgentFromManagedFragment({
        openclawAgentId: payload.openclawAgentId,
        workspacePath: payload.workspacePath,
        name: payload.name,
      });

      const persistedState = this.stateStore.load() || {};
      this.stateStore.save({
        ...persistedState,
        lastAppliedDesiredConfigVersion: desiredState.desiredConfigVersion,
        lastAppliedManagedFragmentPath: fragmentInfo.fragmentPath,
        lastAppliedManagedFragmentHash:
          managedFragmentRemoveInfo.fragmentHash || fragmentInfo.fragmentHash,
      });

      await this.apiClient.updateOperation(machineId, operation.id, {
        status: 'applied',
        result: {
          appliedAt: new Date().toISOString(),
          desiredConfigVersion: desiredState.desiredConfigVersion,
          includeUpdated: includeInfo.updated,
          fragmentPath: fragmentInfo.fragmentPath,
          fragmentHash: fragmentInfo.fragmentHash,
          managedAgentCount: desiredState.agents.length,
          removedFromConfig: removeInfo.updated,
          removedFromManagedFragment: managedFragmentRemoveInfo.updated,
          workspaceDeleted: workspaceInfo.deleted,
          workspacePreserved: workspaceInfo.preserved === true,
          workspaceDeleteReason: workspaceInfo.reason || null,
          workspacePath: workspaceInfo.workspacePath || payload.workspacePath || null,
        },
      });

      this.logger.log(
        chalk.green(
          `✓ delete_agent applied (${payload.openclawAgentId || payload.name || 'unknown'} removed${preserveWorkspace ? ', workspace preserved' : ''})`
        )
      );
      return;
    }

    await this.apiClient.updateOperation(machineId, operation.id, {
      status: 'manual_action_required',
      error: `Unsupported local operation type: ${operation.type}`,
    });
    this.logger.log(chalk.yellow(`! Unsupported operation ${operation.type}`));
  }
}

module.exports = EkybotCompanionExecutor;
