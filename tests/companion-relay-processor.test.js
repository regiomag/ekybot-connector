const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'chalk') {
    return {
      gray: (value) => value,
      green: (value) => value,
      yellow: (value) => value,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const EkybotCompanionRelayProcessor = require('../src/companion-relay-processor');

const MIN_RELAY_HARD_TIMEOUT_MS = 905_000;

describe('EkybotCompanionRelayProcessor', () => {
  afterEach(() => {
    delete process.env.EKYBOT_COMPANION_RELAY_HARD_TIMEOUT_MS;
  });

  it('enforces a hard-timeout floor aligned with the 900s continuity contract', () => {
    const processor = new EkybotCompanionRelayProcessor({}, { timeoutMs: 60_000 });

    assert.equal(processor.relayHardTimeoutMs(), MIN_RELAY_HARD_TIMEOUT_MS);
  });

  it('does not allow an explicit env timeout below the continuity floor', () => {
    process.env.EKYBOT_COMPANION_RELAY_HARD_TIMEOUT_MS = '70000';
    const processor = new EkybotCompanionRelayProcessor({}, { timeoutMs: 60_000 });

    assert.equal(processor.relayHardTimeoutMs(), MIN_RELAY_HARD_TIMEOUT_MS);
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
});
