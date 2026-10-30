# T-000: Ticket template (copy this file for a new ticket)

Status: closed (a template, not work; copy it to T-NNN-slug.md with the next free number)
Opened: 2026-10-29 by the orchestrator, from /bootstrap-orchestration.
Depends on: none

## What happens today

File and line, the measured behaviour, and why it is wrong.

## Rulings (YYYY-MM-DD)

- The maintainer's decision, the reason, and the alternative rejected.

## Settled design

Files, function names, the shape of the change. Only what the rulings settle.

## Owns

- `path/one`
- `path/two`

## Out of scope

What a reader might wrongly add.

## Acceptance

- [ ] `<TestName>`: what it asserts (pure, or needs the runtime).
- [ ] Existing tests `<...>` stay unchanged.
- [ ] Ticket Status set to `landed (<branch>, YYYY-MM-DD)` in the lane's commit.
- [ ] Gates pass: <the `gates` list from CLAUDE.md "Orchestration settings">.

Do NOT run the test harness. Stage paths explicitly.
