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
| #149 F1 llama.cpp not routed | opencode-go/kimi-k2.7-code | merged f88df78 (not pushed) | suite green at 69742dc |
| #150 F2 provider = model id | opencode zai-coding-plan/glm-5.3 (1 fix round) | merged a03c81c (not pushed) | producer fixed in modelsDb.ts; read-time repair kept; suite green |
| #151 F3 false pass | opencode-go/deepseek-v4-pro (after a Z.ai 429) | merged 61010ed (not pushed) | suite green; follow-up: `isSubtaskExecutionFailure` matches error text (fragile; one failed subtask fails the attempt); wants a typed failure flag from codeTaskCoordinator; the task result text does not say "unverified" (only validation.passed: null) |
| R1 research (no issue yet) | agy (Flash failed; Sonnet run 2 accepted) | done 2026-11-01 | Feeds G7/G8 of `docs/prd/00-goals-roadmap.md`; brief = its "R1" section |
| #137 | opencode zai-coding-plan/glm-5.3 | merged f292453 (not pushed) | full suite 67/67, 510/510 at f292453 |
| #138 PRD01-1 | codex (medium; steward committed) | merged 933d517 (not pushed) | full suite at 933d517 green |
| #139 PRD01-2 | ticket-writer (Sonnet) | merged 4d4e45c (not pushed) | wave 1 done; full suite green at 4d4e45c |
| #140 PRD01-3 | lane-dev Sonnet | merged 69742dc (not pushed) | suite green at 69742dc |
| #141 PRD01-4 | codex high | merged 5bf4277 (not pushed) | suite green at a50b675 |
| #142 PRD01-5 | codex high | merged cd4eb7a (not pushed) | suite green; follow-ups: snapshot `git diff --cached --name-only` reads the real index (read-only); a git-ignored hint aborts the snapshot |
| #143 PRD01-6 | lane-dev Sonnet | merged ecacbe7 (not pushed) | suite green at cd4eb7a |
| #144 PRD01-7 | lane-dev Sonnet (1 fix round) | merged a50b675 (not pushed) | suite green at a50b675 |
| #145 PRD01-8 | lane-dev Sonnet (2 fix rounds) | merged edde477 (not pushed) | wave 2 done; suite green at edde477 |
| #146 PRD01-9 | codex high | merged 4f2e54c (not pushed) | wave 3 done; suite green |
| #147 PRD01-10 | lane-dev Opus | building | wave 4 |
| #148 PRD01-11 | codex medium (part A) | part A merged (not pushed); part B after #147 | part B: re-check run.mjs live env names against #147; guard patch.tokens/models |

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

