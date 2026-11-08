#!/usr/bin/env node

require('../src/load-env')();
const chalk = require('chalk');
const reconcileCompanionState = require('./companion-reconcile');
const { cycleMachineProtegee } = require('../src/protected-machine-cycle');
const { recupererRuntimeInterrompu } = require('../src/protected-runtime-recovery');
const { cycleCompagnon } = require('../src/protected-daemon-cycle');
const {
  EkybotCompanionApiClient,
  EkybotCompanionStateStore,
  EkybotCompanionRelaySocket,
} = require('../src');

const DEFAULT_INTERVAL_MS = 30_000;
// Aucun runtime n'est encore qualifié : une variable d'environnement ne peut pas ouvrir cette voie.
const PROTECTED_RUNTIME_QUALIFIE = false;

function resolvePollIntervalMs() {
  const raw = process.env.EKYBOT_COMPANION_POLL_INTERVAL_MS;
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runDaemon() {
  const intervalMs = resolvePollIntervalMs();
  const once = process.argv.includes('--once');
  let stopRequested = false;
  let cycle = 0;
  let running = false;
  let pendingReason = null;
  let intervalId = null;
  let cycleEnCours = Promise.resolve();
  const protectedAbort = new AbortController();
  const stateStore = new EkybotCompanionStateStore();
  const state = stateStore.load();
  const relaySocket =
    !once && state?.machineId && state?.machineApiKey
      ? new EkybotCompanionRelaySocket({
          baseUrl: process.env.EKYBOT_RELAY_PUSH_URL || process.env.EKYBOT_APP_URL || state.baseUrl,
          machineId: state.machineId,
          machineApiKey: state.machineApiKey,
          onWake: async (message) => {
            EkybotCompanionApiClient.invalidateDesiredStateCache(
              process.env.EKYBOT_APP_URL || state.baseUrl,
              state.machineId
            );
            requestCycle(`relay-wake:${message.notificationId || 'unknown'}`);
          },
        })
      : null;

  const requestStop = (signal) => {
    stopRequested = true;
    protectedAbort.abort();
    console.log(chalk.yellow(`\nReceived ${signal}, stopping companion daemon...`));
    if (intervalId) {
      clearInterval(intervalId);
    }
    relaySocket?.stop();
  };

  process.on('SIGINT', () => requestStop('SIGINT'));
  process.on('SIGTERM', () => requestStop('SIGTERM'));

  console.log(chalk.blue.bold('🤖 Ekybot Companion Daemon'));
  console.log(
    chalk.gray(
      once
        ? 'Single cycle mode: one reconcile pass, then exit.'
        : `Continuous mode: reconcile every ${Math.round(intervalMs / 1000)}s.`
    )
  );

  const runCycle = async (reason) => {
    if (running || stopRequested) {
      if (!stopRequested) {
        pendingReason = reason;
      }
      return;
    }

    running = true;
    cycle += 1;
    const startedAt = new Date();
    console.log(chalk.blue(`\n[Cycle ${cycle}] ${startedAt.toISOString()} reason=${reason}`));

    try {
      const reglages={fichierConfiguration:process.env.EKYBOT_PROTECTED_CONFIG,
        socket:process.env.EKYBOT_PROTECTED_DOCKER_SOCKET,docker:process.env.EKYBOT_PROTECTED_DOCKER_BINARY,
        repertoire:process.env.EKYBOT_PROTECTED_STATE_DIR,limiteAppels:1,delaiMs:120000};
      await cycleCompagnon({protege:PROTECTED_RUNTIME_QUALIFIE,signal:protectedAbort.signal,
        reprendre:()=>recupererRuntimeInterrompu(reglages),reconcilier:reconcileCompanionState,
        travailler:()=>cycleMachineProtegee({etat:state,signal:protectedAbort.signal,reglages})});
      console.log(chalk.green(`[Cycle ${cycle}] Companion reconcile finished`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`[Cycle ${cycle}] Companion reconcile failed: ${message}`));
    }

    running = false;

    if (pendingReason && !stopRequested) {
      const nextReason = pendingReason;
      pendingReason = null;
      setImmediate(() => {
        requestCycle(nextReason);
      });
    }
  };

  const requestCycle = (reason) => {
    if (running) {pendingReason = reason;return;}
    cycleEnCours = runCycle(reason);
  };

  relaySocket?.connect();

  if (once) {
    await runCycle('once');
  } else {
    requestCycle('startup');
    intervalId = setInterval(() => {
      requestCycle('interval');
    }, intervalMs);

    while (!stopRequested) {
      await sleep(1_000);
    }
    await cycleEnCours;
  }

  console.log(chalk.green('Companion daemon stopped.'));
}

if (require.main === module) {
  runDaemon().catch((error) => {
    console.error(chalk.red(`Companion daemon failed: ${error.message}`));
    process.exit(1);
  });
}

module.exports = runDaemon;
