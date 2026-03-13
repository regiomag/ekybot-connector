# Ekybot Companion Testing Guide

This guide explains how to test the new Companion flow on a real OpenClaw machine without changing the current production behavior for existing users.

## Goal

Test that Ekybot can:

1. register a machine
2. scan the local OpenClaw config
3. import or create managed agents
4. reconcile the desired state into a managed fragment
5. keep OpenClaw changes driven by Ekybot instead of manual config edits

## Important Safety Rule

Do not test this flow against the current production `main` of the Ekybot web app yet.

Use:

- a local dev instance of `ekybot`
- or a preview/staging deployment built from `codex/openclaw-config-audit`
- and a non-production database where the Companion Prisma migrations can be applied safely

Reason:

- the Companion backend adds new Prisma models and routes
- those tables are not meant to be assumed present in current prod yet
- merging the Ekybot branch too early could break existing user flows such as the Agents page

Merging this connector repo is much safer because nothing happens until someone explicitly installs and runs it.

## How the Companion Works

The Companion is a local runtime that lives on the same machine as OpenClaw.

It does not let the cloud overwrite `openclaw.json` directly.

Instead:

1. Ekybot cloud stores the desired state
2. the local Companion pulls that desired state
3. the Companion writes only an Ekybot-managed fragment
4. OpenClaw keeps its main config, plus an `$include` to the managed fragment

This gives:

- safer rollout for existing users
- easier rollback
- less coupling to OpenClaw internals
- a cleaner onboarding path for new users

## Current Flow

### 1. Enrollment

From Ekybot Companion UI:

- open `/companion`
- generate a registration token

The token looks like:

```text
ekrt_...
```

### 2. Local registration

On the OpenClaw machine:

```bash
cd /path/to/ekybot-connector
npm install
```

Create `.env`:

```bash
EKYBOT_APP_URL=https://your-staging-or-dev-ekybot.example.com
EKYBOT_COMPANION_REGISTRATION_TOKEN=ekrt_your_token_here
```

Register the machine:

```bash
npm run companion:register
```

This stores local Companion state, including:

- `machineId`
- `machineApiKey`
- backend URL

### 3. Inventory sync

Push the local OpenClaw inventory to Ekybot:

```bash
npm run companion:sync
```

This sends:

- machine heartbeat
- config hash
- agent inventory
- warnings and metadata

### 4. Import or create agents

In Ekybot:

- open `/companion`
- review import candidates
- adopt existing agents, or create new agents from Ekybot

### 5. Reconcile

Apply pending Companion operations locally:

```bash
npm run companion:reconcile
```

This currently performs:

1. heartbeat
2. inventory upload
3. desired-state fetch
4. local apply
5. final inventory upload
6. final heartbeat

## Files Written Locally

The Companion currently writes only:

- the managed fragment, by default:
  - `~/.openclaw/managed/ekybot.agents.json5`
- and, if needed, adds that fragment to the main config `$include`

It does not rewrite all of OpenClaw config.

## Recommended Test Scenario

Use this exact order.

### Scenario A — Existing OpenClaw setup

1. Start from a machine that already has OpenClaw agents
2. Register the machine
3. Run `npm run companion:sync`
4. Open `/companion`
5. Review candidate classifications:
   - `managed`
   - `external`
   - `adoptable`
   - `conflicted`
6. Adopt one safe candidate
7. Run `npm run companion:reconcile`
8. Confirm:
   - the managed fragment was written
   - the agent appears linked in Ekybot
   - the machine shows `In sync`

### Scenario B — New agent from Ekybot

1. Create a new agent in Ekybot
2. Confirm a Companion `create_agent` operation is queued
3. Run `npm run companion:reconcile`
4. Confirm:
   - the agent appears in the managed fragment
   - the desired state version advances
   - the machine returns to `In sync`

### Scenario C — Model change

1. Edit an agent model in Ekybot
2. Confirm the agent shows Companion linkage
3. Either:
   - click the model sync button in Ekybot
   - or rely on the automatic sync queueing
4. Run `npm run companion:reconcile`
5. Confirm the local fragment now reflects the new model

## What to Watch Carefully

### Existing user configs

For machines that already have manual OpenClaw config:

- do not assume every local agent should be managed by Ekybot
- adopt only the agents the user explicitly wants to hand over
- keep legacy/manual agents visible until explicitly adopted

### Drift

If local OpenClaw config changes after adoption:

- the Companion should surface drift
- Ekybot should not silently overwrite surprising changes

Current UI already surfaces:

- last reconcile
- last apply
- desired config version
- drift detected / drift reason

### Rollback

Before broader rollout, add a rollback story for:

- bad fragment generation
- unexpected include changes
- conflicting local edits

## What Is Already Operational

Today, the Companion branch supports:

- registration token enrollment
- machine registration
- heartbeat
- inventory upload
- import assistant
- cloud adoption
- local `create_agent` and `update_agent_model` style operations
- full `companion:reconcile`

## What Is Not Yet Ready for Production Rollout

- full rollout on current Ekybot production `main`
- broad migration of existing users
- fully productized onboarding UX
- daemon packaging and installer UX
- final rollback/conflict tooling

## Recommended Command Set

For a real test session:

```bash
npm run companion:register
npm run companion:sync
npm run companion:reconcile
```

After any important Ekybot-side change:

```bash
npm run companion:reconcile
```

## Recommendation for the OpenClaw Agent

If you transmit this guide to an OpenClaw-side agent or operator, give these instructions:

1. never edit the Ekybot-managed fragment by hand
2. never let the cloud rewrite the full OpenClaw config
3. keep manual and Ekybot-managed agents clearly separated
4. use reconcile as the normal apply path
5. report drift instead of silently forcing over local surprises

## Merge Recommendation

### `ekybot-connector`

Safe to merge to `main` now.

Reason:

- it does nothing until explicitly installed and run
- it does not affect current Ekybot production users by itself

### `ekybot`

Do not merge to `main` yet for the real test unless you also prepare a staging environment and apply the Companion migrations there.

Reason:

- the branch changes active agent routes
- those routes now read Companion tables
- without the Companion schema in the target database, existing user flows can break

For iOS users on current production, the main risk of merging the Ekybot branch too early would be:

- agent list failures
- agent edit/create flows failing or becoming inconsistent
- indirect regressions in screens that hit `/api/agents`

So for testing on your real OpenClaw instance:

- merge `ekybot-connector` to `main`
- keep `ekybot` on the feature branch
- test against a staging/dev deployment of that branch
