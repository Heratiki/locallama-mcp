# Model register

Every model the lanes use (Claude, codex, agy): what it can do here, and how
fast. The orchestrator owns this file and keeps it current from outcomes.
Pool costs come from `~/.claude/lane-usage.sh` readings before and after a
lane, never from token counts.

## When to update

- **After every lane:** one Evidence line under the model: date, task class,
  effort, wall time, pool delta, result (first time / N follow-ups / failed).
- **New model seen** (`codex debug models`, `agy models`, the session's
  Claude models): one web search for its release notes, a row marked `?`
  (UNPROVEN), one low-risk lane before any routing rule uses it.
- **Whose fault:** a model-fault failure (clear brief, working environment)
  re-runs at once on the next better model and moves that class up now. An
  orchestrator-fault failure is fixed in the brief and re-run on the same
  model, with no rating change. Two cheap successes move a class down.
- **Stark contradiction:** one web search for known issues, then change the
  rating and `docs/agents/external-lanes.md`; tell the maintainer in the wave
  report.

Ratings: **A** lands the class first time, **B** lands with follow-ups,
**C** fails, **?** unproven.

## Claude (in-process subagents)

| Model | Good at | Rating by class | Speed | Notes |
|---|---|---|---|---|
| Opus | Design tickets; the orchestrator | ? | | Never the default lane. |
| Sonnet | Bounded tickets, ticket prose, verification | ? | | Default lane model. |
| Haiku | Short read-only checks | ? | | Not for long procedures. |

### Evidence

## codex (lanes runner `codex`)

| Model | Good at | Rating | Speed | Notes |
|---|---|---|---|---|
| | | | | |

### Evidence

## agy (lanes runner `agy`)

| Model | Good at | Rating | Speed | Notes |
|---|---|---|---|---|
| Gemini Flash (high) | Research, audits, drafts (Flash first for simple work) | ? | | Ends turns early; expect a nudge. |

### Evidence

| Ended | Lane | Kind | Model | Effort | Task | Pool | Outcome | Wall (min) | 5h (pp) | Week (pp) | Marks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-30T01:08Z | agent-ad327ab5 | claude | claude-sonnet-5-5 | medium | build | claude | completed | 25.3 | 1.7 | 0 | split, lane=orchestration-drift, gates=13 |
| 2026-10-30T01:19Z | agent-a4eca8ca | claude | claude-sonnet-5-5 | low | verify | claude | completed | 9.8 | 0 | 0 | split, lane=orchestration-drift |
| 2026-10-30T03:18Z | agent-a2701bf6 | claude | claude-sonnet-5-5 | medium | build | claude | completed | 144.1 | 3.1 | 0.3 | split, lane=pools-always, gates=28 |
| 2026-10-30T01:32Z | agent-a7cdf575 | claude | claude-sonnet-5-5 | low | verify | claude | completed | 9.2 | 0.3 | 0 | split, lane=pools-always |
| 2026-10-30T03:23Z | agent-af065056 | claude | claude-sonnet-5-5 | medium | build | claude | completed | 123.8 | 3.2 | 0.7 | split, lane=orchestration-drift |
| 2026-10-30T02:12Z | agent-ab80997b | claude | claude-sonnet-5-5 | low | verify | claude | completed | 17.8 | 0 | 0 | split, reset, lane=pools-always |
| 2026-10-30T02:38Z | agent-a01b0fe6 | claude | claude-sonnet-5-5 | low | verify | claude | completed | 39.2 | 1 | 0 | split, reset, lane=orchestration-drift |
| 2026-10-30T02:53Z | agent-a3e19427 | claude | claude-sonnet-5-5 | low | verify | claude | completed | 22.3 | 0.6 | 0.3 | split, lane=pools-always |
| 2026-10-30T03:59Z | agent-a79e1dda | claude | claude-sonnet-5-5 | low | verify | claude | completed | 35.1 | 0 | 0 | split |
| 2026-10-30T04:02Z | agent-a02edfd7 | claude | claude-sonnet-5-5 | low | verify | claude | completed | 41.9 | 0.8 | 0 | split, lane=pools-always, gates=8 |
| 2026-10-30T04:07Z | agent-a4799ed8 | claude | claude-sonnet-5-5 | low | verify | claude | completed | 4.9 | 0 | 0 | split, lane=pools-always |
| 2026-10-30T04:57Z | agent-a27cd1ab | claude | claude-sonnet-5-5 | medium | build | claude | completed | 32.3 | 1 | 0 | split, reset, lane=flaky-tests, gates=11 |
| 2026-10-30T04:52Z | opencode-pid2158538 | opencode | ? | ? | ? | opencode | exited | 0.1 | 0 | 0 | shared |
| 2026-10-30T04:58Z | agent-ab8a5d2b | claude | claude-sonnet-5-5 | low | verify | claude | completed | 0.7 | 0 | 0 | split, lane=flaky-tests |
| 2026-11-01T04:53Z | prd01-review | codex | ? | high | review | codex | done | 2.1 | 3 | 1 | partial |
| 2026-11-01T04:59Z | agent-a52da3f5 | claude | claude-sonnet-5-5 | low | write | claude | completed | 3 | 0.2 | 0 | split |
| 2026-11-01T05:01Z | r1-research | agy | gemini-3.8-flash-high | high | research | agy | done | 9.7 | 4 | 1 |  |
| 2026-11-01T05:02Z | issue-137 | opencode | zai-coding-plan/glm-5.3 | ? | build | opencode | done | 11.5 | 0 | 0 | no-reading, UNPROVEN, gates=8 |
| 2026-11-01T05:04Z | agent-a8e25680 | claude | claude-sonnet-5-5 | low | verify | claude | completed | 0.5 | 0 | 0 | split, lane=issue-137 |
| 2026-11-01T05:06Z | issue-138 | codex | ? | medium | build | codex | done | 2.3 | 3 | 1 | gates=5 |
| 2026-11-01T05:08Z | r1-research-v2 | agy | claude-sonnet-5-5-medium | medium | research | agyClaude | done | 6.2 | 55 | 28 |  |
<!-- generated from model-register.runs.json; edit with register.py, not by hand -->
