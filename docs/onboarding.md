# Onboarding (User-first, <10 min)

## Goal
Get a new user from zero to first successful inter-agent conversation with no manual debugging.

## Step 1 — Connect
- Add gateway URL
- Add gateway token
- Click **Test Connection**

Expected result: green status + agent list fetched.

## Step 2 — Auto-map
- Detect available agents
- Propose default channel mapping
- Let user edit only if needed

Expected result: `main` agent + at least one specialist mapped.

## Step 3 — Guided live test
Run this exact sequence:
1. `@Odin test`
2. `@Max test`
3. `@Odin @Max me recevez-vous ?`

Expected result:
- reply arrives in source channel
- no duplicate bubble
- state survives reload

## Step 4 — Failure UX validation
Force a temporary relay failure.

Expected result:
- one user-friendly error bubble
- no raw technical `520/524` shown

## Step 5 — Done screen
Show:
- “Your AI team is ready ✅”
- next actions: invite teammate, create first workflow, enable alerts

## Definition of Done
- [ ] first reply received
- [ ] mention routing works
- [ ] no duplicate after poll
- [ ] reload persistence confirmed
- [ ] clean error UX confirmed
