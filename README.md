# EkyBot Connector

Bridge your local OpenClaw gateway to EkyBot so users can chat with agents from web/mobile with reliable inter-agent routing.

## Key features

- **@mention inter-agent** — Agents collaborate via `@AgentName` in any channel. The connector routes mentions to the target agent and returns the reply to the source channel.
- **Project memory (KB)** — Shared Knowledge Base per project, synced between OpenClaw workspace and Ekybot cloud.
- **Budget guard** — Per-session cost limit. Configurable via `EKYBOT_COMPANION_MAX_BUDGET_PER_SESSION_USD`.
- **Companion health** — Machine monitoring from Ekybot dashboard.
- **Relay-push wake** — Immediate dispatch on @mention (no 30s polling wait).

## What's new (2026-04)

- Budget guard: block or log when a session exceeds a cost threshold
- @mention return path stabilized: single reply in source channel, no duplicates
- Host summary skipped for single-target mentions (less noise in UI)
- Relay-push wake: instant dispatch instead of waiting for next poll cycle

## 5-minute onboarding

### 1) Install

```bash
git clone https://github.com/regiomag/ekybot-connector.git
cd ekybot-connector
npm install
```

### 2) Generate a Companion enrollment token

From [EkyBot Companion](https://www.ekybot.com/companion), create a temporary enrollment token.

### 3) Connect the machine

```bash
export EKYBOT_APP_URL="https://www.ekybot.com"
export EKYBOT_COMPANION_REGISTRATION_TOKEN="ekrt_..."
npm run companion:connect
```

### 4) Run the doctor

```bash
npm run companion:doctor
```

### 5) Optional local checks

```bash
npm run companion:api-check
npm run companion:memory-check
```

### 6) Start connector

```bash
npm run start
```

### 7) First live validation

From EkyBot UI:
1. Send `@YourAgent test` (replace with your agent name)
2. Verify:
   - single reply in source channel
   - no duplicate after poll
   - reply still visible after reload

If all pass → onboarding complete ✅

---

## Background daemon (recommended)

For production use, install the companion daemon as a system service:

```bash
npm run companion:install-launchd    # macOS (LaunchAgent)
npm run companion:daemon             # run interactively
```

The daemon:
- Polls for relay notifications every 30s
- Wakes immediately on relay-push (no 30s wait for @mentions)
- Reconciles agent configuration with Ekybot cloud
- Dispatches @mention messages to the local OpenClaw gateway
- Enforces budget guard limits per session

---

## Product promise

**OpenClaw = local execution**
**EkyBot = remote command center**
**Connector = reliable bridge**

For users, this should feel like: **"Connect once, then chat with my team of agents from anywhere."**

## Core commands

### Companion / Onboarding

```bash
npm run companion:connect        # enroll a machine from a temporary token
npm run companion:doctor         # verify local state + API access
npm run companion:api-check      # test Ekybot API connectivity
npm run companion:memory-check   # verify project memory sync
npm run companion:disconnect     # unenroll the machine
```

### Daemon / Service

```bash
npm run companion:daemon           # run daemon interactively
npm run companion:install-launchd  # install macOS LaunchAgent
npm run companion:reconcile        # force agent config reconciliation
npm run companion:sync             # sync state with Ekybot cloud
```

### Connector lifecycle

```bash
npm run start             # start connector
npm run stop              # stop connector
npm run restart           # restart service
npm run health            # local health checks
npm run test-connection   # API connectivity
npm run logs              # inspect logs
```

### Legacy

```bash
npm run register   # legacy workspace registration (prefer companion:connect)
```

## Configuration

### Environment variables (`.env.ekybot_companion`)

```bash
EKYBOT_APP_URL="https://www.ekybot.com"
EKYBOT_COMPANION_MACHINE_ID="cmm..."
EKYBOT_COMPANION_TOKEN="..."
EKYBOT_COMPANION_POLL_INTERVAL_MS=30000

# Budget guard (optional)
EKYBOT_COMPANION_MAX_BUDGET_PER_SESSION_USD=5.00
EKYBOT_COMPANION_BUDGET_EXCEEDED_ACTION=log  # or "block"
```

## Troubleshooting (fast)

### No reply from agent

1. `npm run health`
2. `npm run test-connection`
3. `npm run logs`
4. Confirm gateway reachable and token valid

### Duplicate messages

- Confirm poll loop is single-instance (`ps aux | grep companion-daemon`)
- Verify relay idempotency key handling in logs
- Retest with one mention at a time

### UI shows technical infra error

- Expected UX: one clean error bubble
- Not expected: raw `520/524` text in user bubble

### Budget guard not blocking

- Check `EKYBOT_COMPANION_MAX_BUDGET_PER_SESSION_USD` is set
- Check `EKYBOT_COMPANION_BUDGET_EXCEEDED_ACTION=block` (default is `log`)
- Look for `session_budget_checked` in daemon logs

---

## Docs

- `docs/onboarding.md`
- `docs/architecture.md`
- `docs/migration-v1-v2.md`

## Links

- EkyBot: https://www.ekybot.com
- ClawHub listing: https://clawhub.ai/regiomag/ekybot-connector
- Source: https://github.com/regiomag/ekybot-connector
