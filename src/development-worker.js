const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readPrivateJson, HermesResumeGuard } = require('./hermes-resume-guard');
const { createMachineClient } = require('./v2-machine-client');
const { pilotTick, DurableConversationJournal } = require('./hermes-pilot-journal');
const { validSessionId } = require('./v2-codex-runtime');
const { prepareWorkspace, git } = require('./development-projects');
const { permittedPath, digest } = require('./development-files');
const { DevelopmentBroker } = require('./development-broker');
const { openDevelopmentRuntime } = require('./development-runtime');
const { runSandboxed } = require('./development-command');
const { developmentBmt } = require('./development-bmt');
const { projectNotebook, combineExtensions } = require('./project-notebook');
const { discoverModels } = require('./native-models');

function verifyProject(project, home = os.homedir()) {
  if (
    !validSessionId(project.id) ||
    !path.isAbsolute(project.path) ||
    [home, '/', '/Users', '/private', '/Applications'].includes(project.path)
  ) {
    throw new Error('Explicit project directory required');
  }
  const root = fs.realpathSync(project.path);
  permittedPath({ root }, root);
  if (root !== project.path || git(root, ['rev-parse', '--show-toplevel']).trim() !== root) {
    throw new Error('Select the canonical Git repository root');
  }
  const ref = project.base_ref || 'HEAD';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(ref)) {
    throw new Error('Invalid project reference');
  }
  const commit = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  return {
    id: project.id,
    name: project.name,
    path: root,
    commit,
    ref,
    fingerprint: digest(`${root}\0${ref}`),
  };
}

async function runDevelopmentTick({
  stateDir,
  machineFile,
  home = os.homedir(),
  machine: injected,
  slot,
  openRuntime = openDevelopmentRuntime,
  publish = true,
  modelCatalog = discoverModels,
  bmtKeyFile = path.join(path.dirname(stateDir), 'bmt', 'enrollment-key.json'),
}) {
  if (
    ![stateDir, machineFile].every((value) => typeof value === 'string' && path.isAbsolute(value))
  ) {
    throw new Error('Explicit development configuration required');
  }
  new HermesResumeGuard({ stateDir }).ensureDirectory();
  const machine = injected || createMachineClient(readPrivateJson(machineFile));
  const workerId = randomUUID();
  const work = (op, data = {}) => machine({ action: 'work', op, data: { ...data, workerId } });
  const delivery = ({ action, ...data }) => work(action, data);
  if (slot !== undefined && ![0, 1, 2].includes(slot)) {
    throw new Error('Invalid worker slot');
  }
  const lock = path.join(stateDir, slot === undefined ? 'worker.lock' : `slot-${slot}.lock`);
  let fd;
  try {
    fd = fs.openSync(lock, 'wx', 0o600);
  } catch (e) {
    if (e.code === 'EEXIST') {
      return { status: 'worker-locked' };
    }
    throw e;
  }
  fs.writeFileSync(fd, String(process.pid));
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  let opened, heartbeat, job;
  try {
    const sessions = path.join(stateDir, 'sessions');
    // Deliver stored output before starting any new native process, even when
    // authentication has since expired. Never replay an uncertain model turn.
    if ((slot === undefined || slot === 0) && fs.existsSync(sessions)) {
      for (const id of fs.readdirSync(sessions).filter(validSessionId)) {
        for (const engine of ['codex', 'claude']) {
          const journalDir = path.join(sessions, id, engine, 'journal');
          if (!fs.existsSync(journalDir)) {
            continue;
          }
          try {
            const journal = new DurableConversationJournal({
              stateDir: journalDir,
              channelId: id,
              profile: `development-${engine}-v1`,
              homeRoot: home,
              assertFresh: async () => {},
              validSessionId,
              assertContinuation: () => {
                throw new Error('Delivery only');
              },
              execute: async () => {
                throw new Error('Delivery only');
              },
              inspectSession: async () => {
                throw new Error('Delivery only');
              },
            });
            // Delivery errors quarantine only this outbox. Continue with other
            // conversations; never discard its receipt or invoke its model again.
            if (journal.pendingDelivery().length) {
              await pilotTick({ journal, machine: delivery });
            }
          } catch {
            // Server leases prevent a new run on the quarantined conversation.
          }
        }
      }
    }
    if (publish) {
      if (!injected || modelCatalog !== discoverModels) {
        await work('models', await modelCatalog({ stateDir, home }));
      }
      let xcode = null;
      try {
        xcode = execFileSync('/usr/bin/xcodebuild', ['-version'], {
          encoding: 'utf8',
          timeout: 15000,
        })
          .trim()
          .slice(0, 150);
      } catch {
        /* Xcode is optional; this is only capability discovery. */
      }
      const published = await work('publish', {
        version: 2,
        concurrentSessions: 3,
        liveRevocation: true,
        fileTools: true,
        sandboxCommands: true,
        network: false,
        gui: false,
        xcode,
        context: 'native-session',
        sharedMemory: 'explicit-project-notebook-v1',
      });
      for (const project of published.projects || []) {
        try {
          const checked = verifyProject(project, home);
          await work('verified', {
            id: project.id,
            status: 'ready',
            revision: checked.commit,
            detail: 'Dépôt Git vérifié ; chaque session possède sa copie de travail.',
          });
        } catch {
          await work('verified', {
            id: project.id,
            status: 'invalid',
            detail:
              'Choisir le chemin absolu du dépôt Git, sans lien symbolique ni dossier de secrets.',
          });
        }
      }
    }
    const claim = await work('claim');
    if (claim.blocked) {
      return { status: 'blocked' };
    }
    if (!claim.job) {
      return { status: 'idle' };
    }
    job = claim.job;
    if (
      !validSessionId(job.id) ||
      !validSessionId(job.channelId) ||
      job.mode !== 'development' ||
      !['codex', 'claude'].includes(job.engine)
    ) {
      throw new Error('Invalid job');
    }
    const config = job.config;
    const project = verifyProject(config.project, home);
    // The accepted project revision is frozen at registration. An unrelated
    // checkout update cannot silently change the starting point of a new agent.
    if (!/^[a-f0-9]{40}$/.test(config.project.revision)) {
      throw new Error('Unverified revision');
    }
    project.commit = config.project.revision;
    const binding = prepareWorkspace({
      stateDir,
      channelId: job.channelId,
      project,
      engine: job.engine,
    });
    const allowed = async () => (await work('access', { runId: job.id })).allowed === true;
    if (!(await allowed())) {
      throw new Error('Work access revoked');
    }
    heartbeat = setInterval(() => void work('heartbeat', { runId: job.id }).catch(() => {}), 30000);
    const bmt = config.bmtConnections?.length
      ? developmentBmt({
          connections: config.bmtConnections,
          access: (connectionId) => work('bmt-access', { runId: job.id, connectionId }),
          pair: readPrivateJson(bmtKeyFile),
        })
      : {};
    await bmt.assertAccess?.();
    const notebook = projectNotebook((operation, input) =>
      work('notebook', { runId: job.id, operation, input })
    );
    const broker = new DevelopmentBroker({
      ...combineExtensions(bmt, notebook),
      root: binding.path,
      stateDir: path.join(stateDir, 'tools', job.id),
      runId: job.id,
      role: 'developer',
      projects: [{ id: project.id, name: project.name }],
      grants: config.grants,
      cancelled: async () => !(await allowed()),
      runCommand: (options) => runSandboxed(options),
      event: (event) => work('event', { ...event, runId: job.id }),
      approve: async (request) => {
        const deadline = Date.now() + 10 * 60 * 1000;
        do {
          const result = await work('approval', { id: request.id, runId: job.id, request });
          if (typeof result.decision === 'boolean') {
            return result.decision;
          }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } while (Date.now() < deadline);
        return false;
      },
    });
    opened = await openRuntime({
      stateDir,
      channelId: job.channelId,
      engine: job.engine,
      broker,
      home,
      model: config.model || undefined,
    });
    return await pilotTick({
      journal: opened.journal,
      machine: (body) => (body.action === 'claim' ? Promise.resolve(claim) : delivery(body)),
    });
  } catch (error) {
    // A completed outbox is delivered on the next tick, even after loss of ACK.
    if (job) {
      await work('uncertain', { runId: job.id }).catch(() => {});
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    try {
      await opened?.close();
    } finally {
      fs.unlinkSync(lock);
    }
  }
}
module.exports = { runDevelopmentTick, verifyProject };
