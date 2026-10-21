const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { HermesResumeGuard, writeDurableJson } = require('./hermes-resume-guard');
const { DurableConversationJournal, HermesPilotJournal } = require('./hermes-pilot-journal');
const { createFreshProfile, planFreshProfile } = require('./hermes-fresh-profile');
const { readActivation, invokeNative, readOpenAICredential } = require('./hermes-pilot-executor');
const { readAnthropicCredential } = require('./hermes-pilot-profile');
const { buildPilotExecutionConfig } = require('./hermes-pilot-routing');
const { openCodexChatConnection } = require('./v2-codex-connection');
const {
  CodexConversationRuntime,
  validSessionId,
  assertCodexContinuation,
} = require('./v2-codex-runtime');
const { ClaudeConversationRuntime, assertClaudeContinuation } = require('./v2-claude-runtime');
const { hash } = require('./bmt-broker');

// The native adapters remain tool-free. All business effects belong to the
// application broker; no MCP process, shell, browser or API key is given to a model.
async function openBmtRuntime({ stateDir, chatId, agent, hermesSource = {}, home = os.homedir() }) {
  if (
    !validSessionId(chatId) ||
    !validSessionId(agent.id) ||
    !['hermes', 'codex', 'claude'].includes(agent.engine)
  ) {
    throw new Error('Invalid BMT runtime');
  }
  const root = path.join(stateDir, 'conversations', chatId, agent.id);
  new HermesResumeGuard({ stateDir: root }).ensureDirectory();
  if (agent.engine === 'hermes') {
    const source = readActivation(hermesSource);
    const options = { root: path.join(root, 'hermes'), profile: 'bmt' };
    const plan = planFreshProfile(options);
    if (!fs.existsSync(plan.home)) {
      createFreshProfile(options);
      const config = buildPilotExecutionConfig({ ...options, routingMode: 'openai-primary' });
      writeDurableJson(path.join(plan.home, 'config.yaml'), config);
      const { runtime, packages, python, fingerprint } = source.active;
      writeDurableJson(path.join(plan.home, '.ekybot-pilot-active.json'), {
        version: 1,
        executionAllowed: true,
        mode: 'bmt-protocol-v1',
        channelId: chatId,
        runtime,
        packages,
        python,
        fingerprint,
        configHash: hash(config),
      });
    }
    const journal = new HermesPilotJournal({
      stateDir: path.join(plan.home, 'pilot-journal'),
      channelId: chatId,
      profile: plan.profile,
      homeRoot: plan.root,
      assertFresh: async () => {
        if (fs.existsSync(path.join(plan.home, 'state.db'))) {
          throw new Error('BMT session already exists');
        }
      },
      execute: (job) =>
        invokeNative({
          ...readActivation(options),
          job: { ...job, bmtEnabled: true },
          credential: readOpenAICredential(readActivation(hermesSource).plan.home),
          fallbackCredential: readAnthropicCredential(hermesSource),
        }),
    });
    return { journal, close: () => {} };
  }
  let connection;
  const runtime =
    agent.engine === 'claude'
      ? new ClaudeConversationRuntime({ cwd: root, home, bmt: true })
      : new CodexConversationRuntime({
          ...(connection = await openCodexChatConnection({ cwd: root, home })),
          cwd: root,
          effort: 'low',
        });
  const journal = new DurableConversationJournal({
    stateDir: path.join(root, 'journal'),
    channelId: chatId,
    profile: `bmt-${agent.engine}-v1`,
    homeRoot: home,
    assertFresh: async () => {},
    validSessionId,
    assertContinuation:
      agent.engine === 'claude' ? assertClaudeContinuation : assertCodexContinuation,
    execute: (args) => runtime.execute(args),
    inspectSession: (args) => runtime.inspectSession(args),
  });
  return { journal, close: () => connection?.rpc.close() };
}
module.exports = { openBmtRuntime };
