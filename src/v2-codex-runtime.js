const crypto = require('node:crypto');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const fail = (code) => Object.assign(new Error('Codex connection stopped safely.'), { code });
const validSessionId = (id) => typeof id === 'string' && UUID.test(id);

// Transport-independent adapter. The launcher must qualify the effective native
// policy before constructing this adapter; this module grants no permissions.
class CodexConversationRuntime {
  constructor({ rpc, cwd, assertPolicy, timeoutMs = 120000, effort, development, instructions }) {
    if (!rpc || typeof assertPolicy !== 'function' || typeof cwd !== 'string') {
      throw fail('CODEX_CONFIG_INVALID');
    }
    Object.assign(this, { rpc, cwd, assertPolicy, timeoutMs, effort, development, instructions });
  }

  checkThread(thread, expectedId) {
    if (
      !thread ||
      !validSessionId(thread.id) ||
      !validSessionId(thread.sessionId) ||
      (expectedId && thread.id !== expectedId) ||
      thread.cwd !== this.cwd ||
      thread.ephemeral !== false ||
      thread.forkedFromId ||
      thread.parentThreadId
    ) {
      throw fail('CODEX_THREAD_UNVERIFIED');
    }
    return thread;
  }

  async read(sessionId) {
    if (!validSessionId(sessionId)) {
      throw fail('CODEX_SESSION_INVALID');
    }
    const { thread } = await this.rpc.request('thread/read', {
      threadId: sessionId,
      includeTurns: false,
    });
    this.checkThread(thread, sessionId);
    const turns = [];
    let cursor = null;
    // Bounded pagination, not a completion polling loop. Never load another chat.
    for (let page = 0; page < 20; page++) {
      const result = await this.rpc.request('thread/turns/list', {
        threadId: sessionId,
        limit: 50,
        cursor,
        sortDirection: 'asc',
        itemsView: 'full',
      });
      if (!Array.isArray(result.data)) {
        throw fail('CODEX_HISTORY_UNVERIFIED');
      }
      turns.push(...result.data);
      if (!result.nextCursor) {
        return { thread, turns };
      }
      if (cursor === result.nextCursor) {
        throw fail('CODEX_HISTORY_UNVERIFIED');
      }
      cursor = result.nextCursor;
    }
    throw fail('CODEX_HISTORY_LIMIT');
  }

  async inspectSession({ sessionId }) {
    const { thread, turns } = await this.read(sessionId);
    if (
      !turns.length ||
      turns.some((turn) => turn.status !== 'completed' || !validSessionId(turn.id))
    ) {
      throw fail('CODEX_HISTORY_UNVERIFIED');
    }
    return {
      sessionId: thread.id,
      treeId: thread.sessionId,
      cwd: thread.cwd,
      turns: turns.map((turn) => ({ id: turn.id, hash: hash(JSON.stringify(turn.items)) })),
    };
  }

  async execute({ input, sessionId, jobId }) {
    if (
      !validSessionId(jobId) ||
      typeof input !== 'string' ||
      !input.trim() ||
      input.length > 12000 ||
      (sessionId !== null && !validSessionId(sessionId))
    ) {
      throw fail('CODEX_INPUT_INVALID');
    }
    await this.assertPolicy();
    const params = { cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only' };
    if (this.instructions) {
      params.developerInstructions = this.instructions;
    }
    if (this.development) {
      params.dynamicTools = this.development.tools.map((t) => ({ ...t, type: 'function' }));
      params.developerInstructions = this.development.instructions;
    }
    const result = sessionId
      ? await this.rpc.request('thread/resume', {
          ...params,
          threadId: sessionId,
          excludeTurns: true,
        })
      : await this.rpc.request('thread/start', {
          ...params,
          ephemeral: false,
          serviceName: 'ekybot-v2',
        });
    const thread = this.checkThread(result.thread, sessionId);
    if (this.development) {
      this.development.bind(thread.id);
    }
    if (!sessionId && thread.turns?.length) {
      throw fail('CODEX_THREAD_NOT_FRESH');
    }
    const turnId = await this.runTurn(thread.id, jobId, input);
    // Completion notification alone is insufficient: verify persisted native
    // input/output in the exact turn before reporting a deliverable result.
    const saved = await this.read(thread.id);
    const turn = saved.turns.at(-1);
    if (!turn || turn.id !== turnId || turn.status !== 'completed' || turn.itemsView !== 'full') {
      throw fail('CODEX_RESULT_UNVERIFIED');
    }
    const users = turn.items.filter((item) => item.type === 'userMessage');
    const finals = turn.items.filter(
      (item) => item.type === 'agentMessage' && item.phase === 'final_answer'
    );
    const userText = users[0]?.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    if (
      users.length !== 1 ||
      users[0].clientId !== jobId ||
      userText !== input ||
      finals.length !== 1 ||
      typeof finals[0].text !== 'string' ||
      !finals[0].text.trim() ||
      finals[0].text.length > 50000
    ) {
      throw fail('CODEX_RESULT_UNVERIFIED');
    }
    return { sessionId: thread.id, output: finals[0].text };
  }

  runTurn(threadId, jobId, input) {
    return new Promise((resolve, reject) => {
      let turnId;
      let completion;
      let finished = false;
      const end = (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) {
          this.rpc.close();
          reject(error);
        } else {
          resolve(turnId);
        }
      };
      const reconcile = () => {
        if (!turnId || !completion) {
          return;
        }
        if (completion.id !== turnId || completion.status !== 'completed' || completion.error) {
          end(fail('CODEX_TURN_UNCERTAIN'));
        } else {
          end();
        }
      };
      const unsubscribe = this.rpc.onEvent(({ method, params }) => {
        if (method === 'ekybot/closed' || method === 'ekybot/approvalRequired') {
          end(fail('CODEX_TURN_UNCERTAIN'));
          return;
        }
        if (method === 'turn/completed' && params?.threadId === threadId) {
          completion = params.turn;
          reconcile();
        }
      });
      const timer = setTimeout(() => {
        // Do not retry, switch providers or publish partial output after timeout.
        end(fail('CODEX_TURN_UNCERTAIN'));
        this.rpc.close();
      }, this.timeoutMs);
      this.rpc
        .request('turn/start', {
          threadId,
          clientUserMessageId: jobId,
          input: [{ type: 'text', text: input }],
          cwd: this.cwd,
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          ...(this.effort ? { effort: this.effort } : {}),
        })
        .then(
          (response) => {
            if (finished) {
              return;
            }
            turnId = response.turn?.id;
            if (!validSessionId(turnId)) {
              end(fail('CODEX_TURN_UNCERTAIN'));
              return;
            }
            reconcile();
          },
          () => end(fail('CODEX_TURN_UNCERTAIN'))
        );
    });
  }
}

function assertCodexContinuation(before, after) {
  if (
    before.sessionId !== after.sessionId ||
    before.treeId !== after.treeId ||
    before.cwd !== after.cwd ||
    after.turns.length !== before.turns.length + 1 ||
    JSON.stringify(before.turns) !== JSON.stringify(after.turns.slice(0, -1))
  ) {
    throw fail('CODEX_CONTINUATION_UNVERIFIED');
  }
}

module.exports = { CodexConversationRuntime, assertCodexContinuation, validSessionId };
