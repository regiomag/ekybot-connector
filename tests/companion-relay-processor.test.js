const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'chalk') {
    const identity = (value) => value;
    return new Proxy({}, { get: () => identity });
  }
  return originalLoad.call(this, request, parent, isMain);
};

const EkybotCompanionRelayProcessor = require('../src/companion-relay-processor');
const OpenClawGatewayClient = require('../src/openclaw-gateway-client');
const {
  RELAY_PUBLISH_GRACE_MS,
  DEFAULT_RELAY_HARD_TIMEOUT_MS,
  DEFAULT_DELAYED_MS,
  DEFAULT_STALLED_MS,
  DEFAULT_FAILED_MS_TEST,
  resolveRelayLifecyclePolicy,
} = require('../src/relay-continuity');

describe('EkybotCompanionRelayProcessor', () => {
  afterEach(() => {
    delete process.env.EKYBOT_COMPANION_RELAY_HARD_TIMEOUT_MS;
    delete process.env.EKYBOT_COMPANION_RELAY_TIMEOUT_MS;
    delete process.env.EKYBOT_RELAY_DELAYED_MS;
    delete process.env.EKYBOT_RELAY_STALLED_MS;
    delete process.env.EKYBOT_RELAY_FAILED_MS;
    delete process.env.EKYBOT_RELAY_PROFILE;
  });

  it('uses client timeout + publish grace for relay hard-timeout by default', () => {
    const processor = new EkybotCompanionRelayProcessor({}, { timeoutMs: 60_000 });

    assert.equal(processor.relayHardTimeoutMs(), 65_000);
  });

  it('uses explicit relay hard-timeout env value as-is when provided', () => {
    process.env.EKYBOT_COMPANION_RELAY_HARD_TIMEOUT_MS = '70000';
    const processor = new EkybotCompanionRelayProcessor({}, { timeoutMs: 60_000 });

    assert.equal(processor.relayHardTimeoutMs(), 70_000);
  });

  it('uses explicit gateway timeout env without forcing a 900s floor', () => {
    process.env.EKYBOT_COMPANION_RELAY_TIMEOUT_MS = '60000';
    const client = new OpenClawGatewayClient();

    assert.equal(client.timeoutMs, 60_000);
  });

  it('exposes the continuity thresholds expected by the UI contract', () => {
    assert.equal(DEFAULT_DELAYED_MS, 60_000);
    assert.equal(DEFAULT_STALLED_MS, 180_000);
    assert.equal(RELAY_PUBLISH_GRACE_MS, 5_000);
  });

  it('allows a configurable failed TTL for test or production modes', () => {
    process.env.EKYBOT_RELAY_PROFILE = 'test';
    process.env.EKYBOT_RELAY_FAILED_MS = '900000';

    const lifecycle = resolveRelayLifecyclePolicy();

    assert.equal(DEFAULT_FAILED_MS_TEST, 600_000);
    assert.equal(lifecycle.failedMs, 900_000);
  });

  it('clears the hard-timeout timer after a successful dispatch', async () => {
    // Promise.race does not cancel the loser. When the hard-timeout timer was
    // left pending, every dispatch held a ~10 min timer alive: the daemon
    // accumulated one per relay message, and this suite took ~30 minutes to
    // exit instead of ~40 ms.
    const countTimers = () =>
      process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;

    const processor = new EkybotCompanionRelayProcessor(
      {},
      { sendRelayPrompt: async () => ({ content: 'Réponse finale' }) },
    );

    const before = countTimers();
    await processor.sendRelayPromptWithRetry({
      notificationId: 'notif-timer',
      agentId: 'agent-target',
      sessionKey: 'session-1',
      prompt: 'Peux-tu répondre ?',
    });

    assert.strictEqual(
      countTimers(),
      before,
      'the losing hard-timeout timer must be cleared, not left pending',
    );
  });

  it('routes a Hermes target through the RuntimeAdapter, not the gateway', async () => {
    const adapterCalls = [];
    const published = [];

    const processor = new EkybotCompanionRelayProcessor(
      {
        updateRelayNotifications: async () => {},
        postRelayMessage: async (_machineId, payload) => {
          published.push(payload.content);
        },
      },
      {
        sendRelayPrompt: async () => {
          throw new Error('OpenClaw gateway must not be used for a Hermes target');
        },
      },
      {
        hermesAdapter: {
          async selectTransport() {
            return { name: 'cli' };
          },
          async runToCompletion(params) {
            adapterCalls.push(params);
            return { content: 'Réponse Hermes', runId: 'cli_1', status: 'completed' };
          },
        },
        stateStore: {
          upsertActiveRequest() {},
          clearActiveRequest() {},
          load() {
            return { activeRequests: [] };
          },
        },
      },
    );

    await processor.processNotification('machine-1', {
      id: 'notif-hermes',
      toAgentId: 'agent-hermes',
      threadId: 'support',
      fromAgentName: 'Odin',
      relay: {
        type: 'channel_dispatch',
        runtime: { requestId: 'req-hermes' },
        source: { channelKey: 'support', agentName: 'Odin' },
        target: {
          agentId: 'agent-hermes',
          name: 'Hermes Agent',
          provider: 'hermes',
          metadata: { hermesProfile: 'research' },
        },
        message: { content: 'Peux-tu répondre ?' },
      },
    });

    assert.strictEqual(adapterCalls.length, 1);
    assert.strictEqual(adapterCalls[0].profile, 'research');
    // the adapter receives the built relay prompt, which wraps the message
    assert.ok(
      adapterCalls[0].input.includes('Peux-tu répondre ?'),
      'the relay prompt must carry the message content',
    );
    // the relay request id becomes the idempotency key, so a retry replays
    assert.strictEqual(adapterCalls[0].idempotencyKey, 'req-hermes');
    assert.ok(adapterCalls[0].sessionId, 'session key must be forwarded');
    assert.deepStrictEqual(published, ['Réponse Hermes']);
  });

  it('publishes the relay message before acknowledging delivery', async () => {
    const order = [];
    const stateStages = [];
    const processor = new EkybotCompanionRelayProcessor(
      {
        updateRelayNotifications: async (_machineId, payload) => {
          order.push(`update:${payload.status}`);
        },
        postRelayMessage: async (_machineId, payload) => {
          order.push('postRelayMessage');
          assert.equal(payload.notificationId, 'notif-1');
          assert.equal(payload.channelKey, 'support');
        },
      },
      {
        sendRelayPrompt: async () => ({ content: 'Réponse finale' }),
      },
      {
        stateStore: {
          upsertActiveRequest(request) {
            stateStages.push(request.stage);
            order.push(`stage:${request.stage}`);
          },
          clearActiveRequest(requestId) {
            order.push(`clear:${requestId}`);
          },
          load() {
            return { activeRequests: [] };
          },
        },
      },
    );

    await processor.processNotification('machine-1', {
      id: 'notif-1',
      toAgentId: 'agent-target',
      threadId: 'support',
      fromAgentName: 'Odin',
      relay: {
        type: 'channel_dispatch',
        runtime: {
          requestId: 'req-1',
        },
        source: {
          channelKey: 'support',
          agentName: 'Odin',
        },
        target: {
          agentId: 'agent-target',
          name: 'Eky Support',
        },
        message: {
          content: 'Peux-tu répondre ?',
        },
      },
    });

    assert.deepEqual(stateStages, ['claimed', 'running', 'publishing']);
    assert.deepEqual(order, [
      'stage:claimed',
      'update:in_progress',
      'stage:running',
      'stage:publishing',
      'postRelayMessage',
      'update:delivered',
      'clear:req-1',
    ]);
  });

  it('tracks runtime heartbeats against the correlated requestId instead of notificationId', async () => {
    const requestIds = [];
    const cleared = [];
    const processor = new EkybotCompanionRelayProcessor(
      {
        updateRelayNotifications: async () => {},
        postRelayMessage: async () => {},
      },
      {
        sendRelayPrompt: async () => ({ content: 'Réponse finale' }),
      },
      {
        stateStore: {
          upsertActiveRequest(request) {
            requestIds.push(request.requestId);
          },
          clearActiveRequest(requestId) {
            cleared.push(requestId);
          },
          load() {
            return { activeRequests: [] };
          },
        },
      }
    );

    await processor.processNotification('machine-1', {
      id: 'notif-9',
      toAgentId: 'agent-target',
      threadId: 'support',
      relay: {
        type: 'agent_notification',
        runtime: {
          requestId: 'req-9',
        },
        source: {
          channelKey: 'support',
        },
        target: {
          agentId: 'agent-target',
        },
        message: {
          content: 'Besoin d une reponse',
        },
      },
    });

    assert.deepEqual(requestIds, ['req-9', 'req-9', 'req-9']);
    assert.deepEqual(cleared, ['req-9']);
  });

  it('publishes the first available reply immediately even for the continuity test marker', async () => {
    const posted = [];
    const prompts = [];
    const sessionKeys = [];
    const processor = new EkybotCompanionRelayProcessor(
      {
        updateRelayNotifications: async () => {},
        postRelayMessage: async (_machineId, payload) => {
          posted.push(payload.content);
        },
      },
      {
        sendRelayPrompt: async ({ prompt, sessionKey }) => {
          prompts.push(prompt);
          sessionKeys.push(sessionKey);
          return {
            content: 'Réponse finale immédiate : voici directement la conclusion utile.',
          };
        },
      },
      {
        stateStore: {
          upsertActiveRequest() {},
          clearActiveRequest() {},
          load() {
            return { activeRequests: [] };
          },
        },
      }
    );

    await processor.processNotification('machine-1', {
      id: 'notif-immediate',
      toAgentId: 'agent-target',
      threadId: 'support',
      relay: {
        type: 'channel_dispatch',
        runtime: {
          requestId: 'req-immediate',
        },
        source: {
          channelKey: 'support',
          agentName: 'Odin',
        },
        target: {
          agentId: 'agent-target',
          name: 'Odin',
        },
        message: {
          content: 'TEST_CONTINUITY_DELAY_70 donne la conclusion finale tout de suite si tu l as deja',
        },
      },
    });

    assert.equal(prompts.length, 1);
    assert.deepEqual(sessionKeys, ['agent:agent-target:ekybot-relay-v2:support:continuity-test']);
    assert.deepEqual(posted, ['Réponse finale immédiate : voici directement la conclusion utile.']);
  });
});
