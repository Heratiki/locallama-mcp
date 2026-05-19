# Memory Bank

This directory is append-only historical memory for humans and coding agents. It exists so every contributor can quickly recover past decisions and unfinished work without relying on one chat transcript.

For the current branch snapshot, read `docs/PROJECT_STATE.md`. For implementation intent and live verification, read `docs/PLAN.md` and `docs/OPERATIONAL_TEST_PLAN.md`.

## Files

- `activeContext.md` - current focus, working assumptions, and immediate next work
- `progress.md` - completed work and roadmap progress
- `decisionLog.md` - dated decisions and rationale
- `productContext.md` - durable product direction and goals
- `sessionLog.md` - append-only notes from individual work sessions

## Multi-Author Rules

- Read `docs/AGENTS.md`, `docs/PROJECT_STATE.md`, `docs/PLAN.md`, `docs/OPERATIONAL_TEST_PLAN.md`, and this README before non-trivial work.
- Prefer appending dated entries over rewriting history.
- Keep entries factual: what changed, why, verification, and next steps.
- Use absolute dates such as `2026-04-24`, not "today" or "yesterday".
- Do not store secrets, API keys, private prompts, or sensitive logs here.
- If a prior note is wrong, add a correction with a date and rationale instead of silently deleting it.

## Session Entry Template

```md
## 2026-04-24 - Short Title

Author: name or agent/tool

Summary:
- What changed
- Why it changed

Verification:
- Commands run or checks performed

Follow-ups:
- Remaining work, blockers, or open questions
```
