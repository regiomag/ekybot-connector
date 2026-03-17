# Architecture (v2 relay)

## High-level flow

```text
User (web/mobile)
  -> Ekybot API
  -> Relay worker / queue
  -> OpenClaw Gateway
  -> Target Agent
  -> Gateway response
  -> Ekybot persistence + fanout
  -> Source channel UI
```

## Key properties
- Async-first: request accepted quickly, completion delivered later
- Source-channel return: replies appear where the conversation started
- Inter-agent support: mentions / `targetAgent` routing
- Idempotent delivery: avoid duplicate bubbles after poll/retry

## Reliability goals
- P95 first-ack < 3s (acceptance)
- Eventual reply delivery under transient backend issues
- At-most-once visual reply per message id in UI

## UX goals
- Friendly error text for transient infra issues
- Never expose raw transport codes to end users in normal bubbles
