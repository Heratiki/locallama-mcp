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
