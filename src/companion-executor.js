const crypto = require('crypto');
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

  async applyDesiredState(machineId) {
    const response = await this.apiClient.fetchDesiredState(machineId);
    const desiredState = response?.desiredState;
    const pendingOperations = response?.pendingOperations || [];

    if (!desiredState) {
      throw new Error('Missing desired state payload');
    }

    const applied = [];

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

    return {
      desiredState,
      pendingOperations,
      appliedOperationIds: applied,
    };
  }

  async applyOperation(machineId, operation, desiredState) {
    const appliesManagedState = new Set([
      'bootstrap_include',
      'create_agent',
      'update_agent_model',
      'update_agent_bindings',
      'update_workspace_templates',
      'archive_agent',
      'delete_agent',
    ]);

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

    await this.apiClient.updateOperation(machineId, operation.id, {
      status: 'manual_action_required',
      error: `Unsupported local operation type: ${operation.type}`,
    });
    this.logger.log(chalk.yellow(`! Unsupported operation ${operation.type}`));
  }
}

module.exports = EkybotCompanionExecutor;
