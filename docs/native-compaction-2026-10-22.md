# Native compaction qualification — 22 October 2026

Pinned runtimes: Codex CLI 0.155.0, Claude Code 2.1.285. Native identity,
append-only transcript verification, durable job receipts, and uncertainty
locks remain authoritative. No Ekybot summary replaces the native conversation.

Claude automatic compaction emits a boundary and a synthetic user summary.
The adapter now verifies boundary UUID, logical parent, anchor UUID, session,
directory, CLI version, summary text and persisted evidence. Only text summaries
bound to an observed boundary are accepted; tool calls in summaries, duplicate
or foreign summaries, rewritten history and unknown formats fail closed.
The local transcript safety limit is 32 MiB. Manual Claude compact boundaries
are not qualified. Policy identifiers and existing session bindings are unchanged.

`scripts/qualify-long-native.js` exercises four genuine native turns with a
fresh provider process/connection per turn, a single native session, a synthetic
read-only project, real file and notebook tools, and the production durable
journal. Notebook transport and contents are fixtures, not customer data.
After native automatic compaction, the final turn recalls the anchor/rule and
reads both tools. A completed receipt is then replayed with a runtime factory
that throws if invoked, verifying delivery without a second model generation.

To trigger compaction in bounded tests, child processes alone receive:

- Codex: `model_auto_compact_token_limit=12000`.
- Claude: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=1`,
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW=100000`.

These overrides are absent from production. This qualifies the actual automatic
compaction mechanism, not a million-token load test or perfect semantic recall.
Both engines reported 0, 0, 1, 2 compactions across their four turns and passed
the file, notebook, anchor, rule, session continuity and delivery-replay checks.

- Claude fixture: `/private/tmp/ekybot-long-8uB8Te`, native session
  `da4d6d84-0ddb-48ef-906f-651d2367760d`.
- Codex fixture: `/private/tmp/ekybot-long-udJE9H`, native session
  `01a162a9-7866-7be0-8747-e0459a3b408b`.
- Full connector suite: 289 tests, 281 pass, 8 optional native tests skipped.
  The two live probes above are additional, explicit tests.

Upgrade one service at a time after pausing its claims and draining active jobs.
The release upgrader preserves all state directories, journals, keys and previous
plists. Native/BMT dependencies come only from the same qualified development
release with an identical shrinkwrap; no unpinned installation is performed.
Never remove conversation locks or replay uncertain tasks to complete an upgrade.

References:

- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/agent-sdk/sessions
