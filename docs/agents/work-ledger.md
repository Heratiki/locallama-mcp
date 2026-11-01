# Work ledger

The orchestrator's queue of work. Update it when a lane starts, lands or
fails, and when the maintainer rules. Procedure:
`docs/agents/external-lanes.md`. Models: `docs/agents/model-register.md`.

## Before any wave

1. `~/.claude/lane-usage.sh`; log the line (memory `lane-usage-tally`,
   "Pool readings"). Baseline 2026-10-29: `claude5hUsed=2% claudeWkUsed=65% gemini5h=100% geminiWk=86% codex5hUsed=0.0% codexWkUsed=12.0% zaiWkUsed=31.0% go5hUsed=0.0% goWkUsed=11.0% goMoUsed=5.0%`.
   Close 2026-10-30T05:26Z: `claude5hUsed=18% claudeWkUsed=69% gemini5h=99% geminiWk=86% codex5hUsed=16.0% codexWkUsed=16.0% zai5hUsed=42.0% zaiWkUsed=39.0% go5hUsed=0.0% goWkUsed=11.0% goMoUsed=5.0%`.
2. Check the model lists (`codex debug models`, `agy models`, the Claude
   models in the session) against the register.
3. If this repo uses external lanes: the `lanes` tool `list` (and the tmux
   windows `codex`, `agy` where tmux is installed and `tmux_session` is set).

## Next waves

| Issue | Route | State | Next |
|---|---|---|---|
| R1 research (no issue yet) | research lane, `mattpocock-skills:research` | queued | Feeds G7/G8 of `docs/prd/00-goals-roadmap.md`; brief = its "R1" section |
| #137 | lane-dev | open, not started | OpenRouter `draft_model` fix |

Wave order: a file two tickets need is changed by the first ticket's lane,
merged, then the second lane starts.

## Rulings to ask

One line each, with the recommended option. Ask 1-2 per round
(AskUserQuestion).

## Play / manual checks for the maintainer

One line each: what to check, where, and which ticket it closes.

## Done waves

Newest first: `## Wave N — <date>, <pushed at sha | NOT pushed>` and one line
per ticket.

## Wave 0 — 2026-10-29/30, setup only, pushed at 9f2ce2d

- Bootstrap (95e809a), settings.local untracked (d63ef27), GitHub issues
  as work items (d87e099), repo `lane-dev`/`ticket-writer` (9f2ce2d).
- The lanes of this session built lane-panel work (repo `~/Source/lane-panel`,
  all merged and pushed there); their register lines are in
  `model-register.md`. No locallama-mcp code changed.

