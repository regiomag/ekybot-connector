# Ekybot Connector

Bridge your local OpenClaw gateway to Ekybot so users can chat with agents from web/mobile with reliable inter-agent routing.

## What’s new (2026-03)

- Reliable async relay behavior (request accepted quickly, reply arrives when ready)
- Source-channel return path for mentions/CC
- Inter-agent routing stabilized (`targetAgent` + channel mapping)
- Better UX around transient failures (no raw infra errors expected in UI)

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

From Ekybot UI:
1. Send `@Odin test`
2. Send `@Max test`
3. Verify:
   - single reply in source channel
   - no duplicate after poll
   - reply still visible after reload

If all 3 pass → onboarding complete ✅

---

## Product promise

**OpenClaw = local execution**
**Ekybot = remote command center**
**Connector = reliable bridge**

For users, this should feel like: **“Connect once, then chat with my team of agents from anywhere.”**

## Core commands

```bash
npm run companion:connect # enroll a machine from a temporary token
npm run companion:doctor  # verify local state + API access
npm run companion:api-check
npm run companion:memory-check
npm run companion:disconnect
npm run register          # legacy workspace registration
npm run start             # run connector
npm run stop              # stop connector
npm run restart           # restart service
npm run health            # local health checks
npm run test-connection   # API connectivity
npm run logs              # inspect logs
```

## Troubleshooting (fast)

### No reply from agent

1. `npm run health`
2. `npm run test-connection`
3. `npm run logs`
4. confirm gateway reachable and token valid

### Duplicate messages

- confirm poll loop is single-instance
- verify relay idempotency key handling
- retest with one mention at a time

### UI shows technical infra error

- expected UX: one clean error bubble
- not expected: raw `520/524` text in user bubble

---

## Docs

- `docs/onboarding.md`
- `docs/architecture.md`
- `docs/migration-v1-v2.md`

## Links

- Ekybot: https://www.ekybot.com
- ClawHub listing: https://clawhub.ai/regiomag/ekybot-connector
- Source: https://github.com/regiomag/ekybot-connector
