#!/usr/bin/env node

require('../src/load-env')();
const chalk = require('chalk');
const reconcileCompanionState = require('./companion-reconcile');

const DEFAULT_INTERVAL_MS = 30_000;

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

  const requestStop = (signal) => {
    stopRequested = true;
    console.log(chalk.yellow(`\nReceived ${signal}, stopping companion daemon...`));
  };

  process.on('SIGINT', () => requestStop('SIGINT'));
  process.on('SIGTERM', () => requestStop('SIGTERM'));

  const MAX_BACKOFF_MS = 5 * 60_000; // 5 min cap
  let consecutiveFailures = 0;

  console.log(chalk.blue.bold('🤖 Ekybot Companion Daemon'));
  console.log(
    chalk.gray(
      once
        ? 'Single cycle mode: one reconcile pass, then exit.'
        : `Continuous mode: reconcile every ${Math.round(intervalMs / 1000)}s.`
    )
  );

  while (!stopRequested) {
    cycle += 1;
    const startedAt = new Date();
    console.log(chalk.blue(`\n[Cycle ${cycle}] ${startedAt.toISOString()}`));

    try {
      await reconcileCompanionState();
      consecutiveFailures = 0;
      console.log(chalk.green(`[Cycle ${cycle}] Companion reconcile finished`));
    } catch (error) {
      consecutiveFailures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`[Cycle ${cycle}] Companion reconcile failed (${consecutiveFailures} consecutive): ${message}`));
    }

    if (once || stopRequested) {
      break;
    }

    // Adaptive backoff: double the interval after each consecutive failure, capped at MAX_BACKOFF_MS
    const waitMs = consecutiveFailures > 0
      ? Math.min(intervalMs * Math.pow(2, consecutiveFailures - 1), MAX_BACKOFF_MS)
      : intervalMs;

    if (consecutiveFailures > 0) {
      console.log(chalk.yellow(`[Cycle ${cycle}] Backing off ${Math.round(waitMs / 1000)}s before next attempt`));
    }

    await sleep(waitMs);
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
