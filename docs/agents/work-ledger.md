# Work ledger

The orchestrator's queue of work. Update it when a lane starts, lands or
fails, and when the maintainer rules. Procedure:
`docs/agents/external-lanes.md`. Models: `docs/agents/model-register.md`.

## Before any wave

1. `~/.claude/lane-usage.sh`; log the line (memory `lane-usage-tally`,
   "Pool readings"). Baseline 2026-10-29: `claude5hUsed=2% claudeWkUsed=65% gemini5h=100% geminiWk=86% codex5hUsed=0.0% codexWkUsed=12.0% zaiWkUsed=31.0% go5hUsed=0.0% goWkUsed=11.0% goMoUsed=5.0%`.
2. Check the model lists (`codex debug models`, `agy models`, the Claude
   models in the session) against the register.
3. If this repo uses external lanes: the `lanes` tool `list` (and the tmux
   windows `codex`, `agy` where tmux is installed and `tmux_session` is set).

## Next waves

| Ticket | Route | State | Next |
|---|---|---|---|
| | | | |

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
