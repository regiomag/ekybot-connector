# Migration v1 -> v2

## Why migrate
v2 improves routing reliability and user-facing consistency for inter-agent messaging.

## Main changes
- Async relay is now the default behavior
- Source-channel return path enforced
- Better duplicate prevention strategy
- Cleaner user error UX

## Action checklist
- [ ] update connector package
- [ ] verify gateway token/url
- [ ] run guided mention tests
- [ ] validate no duplicate after poll
- [ ] validate clean failure bubble

## Rollback plan
If critical regression:
1. disable new relay path flag
2. restore previous stable connector version
3. keep persistence layer untouched
4. rerun smoke tests
