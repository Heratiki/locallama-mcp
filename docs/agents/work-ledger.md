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
| PRD 01 issues (not filed yet) | opencode lane, `zai-coding-plan/` first; `opencode-go/` for some, to sample its models | queued | Steward scope (2026-11-01): all of PRD 01, waves 1-5 (#138-#148); wave 4 floor run is a simulation |
| #149 F1 llama.cpp not routed | opencode, zai-coding-plan/ | filed | maintainer approved fix 2026-11-01; any wave, owns cost-monitor/api.ts |
| #150 F2 provider = model id | opencode, zai-coding-plan/ | filed | before #147; not with #151 |
| #151 F3 false pass | opencode, zai-coding-plan/ | filed | after #150, before #147 |
| R1 research (no issue yet) | research lane, `mattpocock-skills:research` | queued | Feeds G7/G8 of `docs/prd/00-goals-roadmap.md`; brief = its "R1" section |
| #137 | lane-dev | open, not started | OpenRouter `draft_model` fix |
| #138 PRD01-1 | opencode, zai-coding-plan/ (wave 1) | filed | contracts; first, alone |
| #139 PRD01-2 | opencode, zai-coding-plan/ (wave 1) | filed | docs; parallel with #138 |
| #140 PRD01-3 | opencode, zai-coding-plan/ (wave 2) | filed | after #138; wave-2 order 6,3,4,5,7,8 |
| #141 PRD01-4 | opencode, zai-coding-plan/ (wave 2) | filed | after #138 |
| #142 PRD01-5 | opencode, zai-coding-plan/ (wave 2) | filed | after #138 |
| #143 PRD01-6 | opencode, zai-coding-plan/ (wave 2) | filed | after #138; first of wave 2 |
| #144 PRD01-7 | opencode, zai-coding-plan/ (wave 2) | filed | after #138 |
| #145 PRD01-8 | opencode, zai-coding-plan/ (wave 2) | filed | after #138; last of wave 2 |
| #146 PRD01-9 | opencode, zai-coding-plan/ (wave 3) | filed | after #140-#145 |
| #147 PRD01-10 | opencode, zai-coding-plan/ (wave 4) | filed | after #146 |
| #148 PRD01-11 | opencode, zai-coding-plan/ (wave 5) | filed | after #147; floor run is a simulation |

Wave order: a file two tickets need is changed by the first ticket's lane,
merged, then the second lane starts.

## Routing preference (maintainer, 2026-11-01)

Put issue lanes on Z.ai (`zai-coding-plan/`, pool `zaiWkUsed`) first. Use
OpenCode Go (`opencode-go/`) on some lanes to learn what its models can do,
without high use of any pool. Claude and codex lanes only when Z.ai cannot do
the issue, or for review and verification.

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

