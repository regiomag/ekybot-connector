# Native V2 chat operations

The first native connection supports Codex conversations only. It does not grant file, shell, browser, BMT or delegation access. Claude Code remains unavailable until its authentication and native continuation have been qualified. Existing Hermes runs in its original dedicated service.

## Qualified deployment

The persistent native release is `3eeab6b`, installed as `~/.local/share/ekybot-v2/native-companion-3eeab6b`. The launchd label is `com.ekybot.native-v2-chat`; its private state root is `~/.local/share/ekybot-v2/native-chat`. The machine configuration is read from the existing V2 Hermes pilot's `machine.json`. Only that scoped transport credential is shared. No provider credential or old conversation is copied.

The worker executes one bounded tick every 15 seconds. Protocol 2 uses the `ekybot_v2_native` queue; the legacy Hermes worker uses protocol 1 and `ekybot_v2_pilot`. Both protocols use one SQL dispatcher with an explicit protocol filter, and one durable journal implementation with runtime-specific persistence checks. The API migration is `20261021000300_ekybot_v2_native_channels.sql` in the Ekybot repository.

## Codex policy

`v2-codex-connection.js` qualifies exactly `codex-cli 0.155.0`. It uses local stdio, never an incoming server port. Its effective configuration must disable inherited MCPs, shell execution, browser/computer access, plugins, hooks, memory, user/project instructions and subagents. Authentication must be a ChatGPT account, not an API key or a custom inference endpoint. A changed CLI version or policy fails closed.

The installed turn schema does not establish restricted readable roots. Do not advertise coding-directory access or enable tools based on the read-only sandbox alone. The current connection is deliberately chat-only. These checks do not create OS isolation between mutually untrusted users sharing a macOS account.

`v2-codex-runtime.js` creates a fresh thread once, then resumes only its exact ID. It verifies the native session tree, working directory, persisted turn, client message ID and final output. The next persisted history must extend, rather than rewrite, the previous history. A failed or interrupted turn, missing final answer, lost acknowledgement or unconfirmed result remains uncertain; there is no automatic replacement turn or provider fallback.

## Qualification

The complete suite passes 207 tests with the native Hermes fixture environment configured; no tests are skipped. The new native tests cover disabled capabilities, exact resume, persistence checks, early completion notifications, no automatic retries, separate worker locking and delivery after provider logout.

`scripts/qualify-v2-codex.js --allow-native-model ABSOLUTE_EMPTY_PRIVATE_DIRECTORY` explicitly consumes two short ChatGPT-account turns. The completed recipe on 21 October preserved the same native thread across process restarts and replayed each durable receipt without generating again. The real cloud recipe subsequently delivered `NATIVE_V2_OK` through launchd. Reusing its request ID left exactly one completed run and one answer, with no queued replay.

## Installation and recovery

Install a committed release into a new persistent directory, then invoke `scripts/install-v2-native-service.js ABSOLUTE_RELEASE PRIVATE_STATE MACHINE_FILE`. The installer refuses to overwrite an existing service. It does not touch `com.ekybot.hermes-v2-pilot` or the legacy Companion.

Keep the Mac awake, online and logged in. A CLI upgrade, logout or failed policy check advertises Codex as unavailable without claiming another model job. Finished responses are delivered from the outbox even when provider authentication is unavailable.

A surviving `worker.lock` or uncertain conversation journal must be inspected before intervention. Do not remove locks merely because they are old, change a binding to another thread, clear a started receipt, or resend the user's text under a new request ID. Confirm the process state and native outcome first; retain the journal for reconciliation. Stop only this native launchd service, after its active work is settled, when rolling back native functionality. Frontend rollback does not cancel accepted jobs or erase conversations.

## Remaining lot 2 gates

Qualify Claude authentication and persistence, then coding-directory confinement, explicit interventions, progress and artifacts. Multi-agent mentions, per-agent BMT access, native mobile distribution and shared BMT packaging remain later delivery gates. The chat-only qualification is not completion of those lots.
