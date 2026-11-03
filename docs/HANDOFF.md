# Handoff

## Last Updated

2026-11-03, session close (Linux host). Landed #159-#170 on local main
`fabd64c`; #159-#167 are on origin, #168-#170 are NOT pushed (main ahead 8).
Full suite green at `fabd64c`: 125/125 suites, 974/974 tests. Open issues:
#167-#170 (merged; close after the push). Deploy: none; `dist/` rebuilt at
HEAD, so reconnect `locallama-dev` with `/mcp` to load #168-#170.

## Session 2026-11-03: what landed

- #159 stacked apply when SEARCH misses the base; #160/#162 lint resume
  shortcut; #161 SearXNG categories (`PATCH_RESEARCH_SEARXNG_CATEGORIES`);
  #163 Stack Exchange API + offline explain sources
  (`PATCH_RESEARCH_ENABLED`, `PATCH_RESEARCH_STACKEXCHANGE`); #164
  `LOCALLAMA_ENV_FILE` (jest runs with `none`); #165 SE id validation; #166
  auto lint runs clang-tidy only with a `.clang-tidy` file (else gcc).
- #167: for local/free entries `max_tokens` = min(model window,
  `PATCH_CONTEXT_TOKENS`) − prompt − margin, floor `PATCH_MAX_OUTPUT_TOKENS`;
  providers report `truncated`; a cut-off answer gets a feedback message.
- #168 LM Studio passes caller `maxTokens`/`systemPrompt`; #169 empty content
  with a length stop is truncation, not a call error; #170 OpenRouter
  `top_provider.max_completion_tokens` bounds the cap.
- Lanes: Sonnet lane-dev for #166, #167 (+1 fix round after an Opus review),
  #170 fix round; opencode for #168 (Z.ai glm-5.3), #169 (OC-Go
  kimi-k2.7-code), #170 (OC-Go deepseek-v4-pro). Details:
  `docs/agents/work-ledger.md` (wave 2026-11-03).

Language tests (sandbox repos `~/Source/locallama-sandbox/*`, on this host
only; gemma-4-12B on llama.cpp, $0, `validate: false`, `"lint": "auto"`):

| Run | ts | py | go | sh | c | rust |
|---|---|---|---|---|---|---|
| 3 (before #167) | pass | pass | pass | pass | pass | fail (cut-off answers) |
| 4 (#167, before #168-#170) | fail | pass | pass | pass | pass | fail (3 cut-off, 3 wrong logic) |

Run 4: gemma fills a ~5000-token cap; 8 attempts were cut off; TS took 674 s
(50 s in run 3). The truncation feedback works (py passed with a 178-token
answer after it). Run 4 did not have #168-#170 loaded.

Not verified: #168-#170 in a live job (no language run since they merged).

## Next session, first three things

1. Ask the maintainer to push main (8 ahead) with the push Button or `/push`,
   then reconnect `locallama-dev`; close #167-#170 after the push.
2. Ask the ruling on the #167 output cap (see the ledger "Open ruling"):
   lower `PATCH_CONTEXT_TOKENS`, or the large cap only on the attempt after a
   truncation. Recommended: the large cap only after a truncation.
3. Run the 6 language tests again (inputs: the `request_json` of the
   `live-*-lint4` jobs in `data/jobs.db`; task types `live-*-lint5`) and
   compare with run 4.

## What Is Currently In-Flight

Nothing. No lane, worktree or background command runs. Old `.unlazy` scopes
with unmet gates (work landed long ago; ask before archive):
`verify-issue-143`, `verify-issue-146`, `verify-issue-153`,
`verify-lane-issue-148`, `verify-lane-issue-152`.

## Earlier entries

2026-11-01, /ship: PRD 01 wave (#137-#154) on origin at `3b6e0e6`. Full
suite green at `3b6e0e6` (99/99 suites, 761/761 tests, `--maxWorkers=2`
because host RAM was low). `dist/` rebuilt at HEAD for `locallama-dev`
(deploy: none). The 18 issues did NOT close on push: the lane commits say
`Refs #N`, not `Closes #N`; close them by hand.

2026-11-01T08:00Z, by the steward (`/steward`, stop condition: everything left
waits for the maintainer or for host memory). Decisions log:
`docs/agents/decisions-2026-11-01.md`.

Main is 81 commits ahead of origin (19 merges), NOT pushed. Full suite green
at `aa69207` (99/99 suites, 761/761 tests). After it, only docs merged
(`7d1ca4c` wiki, `30e46de` test plan); the suite was not re-run there because
the host was low on memory.

## What landed (local main)

- Fixes of live defects: #137, #149 (F1), #150 (F2), #151 (F3), #153 (F8),
  #154 (F9).
- PRD 01 (verified patch + grind loop): #138-#148, all merged. `patch_task`
  works end to end at $0 (off unless `PATCH_TASKS_ENABLED=true` and
  `PATCH_REPO_ROOTS` set).
- G1 read surface: #152 (`get_savings`).
- Docs: goals roadmap `docs/prd/00-goals-roadmap.md`, PRD 01, PRD 02 draft
  rev 1 + review, R1 research, ADR 0004, `wiki/12-patch-tasks.md`, live
  results in `docs/OPERATIONAL_TEST_PLAN.md`.

## Next session, first things

1. Done: pushed at `3b6e0e6`. Close #137-#154 by hand (`Refs`, not `Closes`).
2. Re-run seed run 2 in full when memory allows (Claude Code stopped it at
   44/60 for low memory). Command and config: see the decisions log
   ("Seed run 2"); run config at the session scratch path is temporary —
   rebuild it from `docs/OPERATIONAL_TEST_PLAN.md` (models of llama-router +
   Ollama, `PATCH_FREE_MODELS=0`, endpoints).
3. Floor simulation (PRD 01 criterion 17): one `systemd-run --user --scope -p
   MemoryMax=8G` with llama-server `-ngl 0 -t 4 -c 8192` (Qwen3-4B-Instruct
   Q4_K_M, port 8191) and the runner. Needs free host memory.
4. Rule on PRD 02 §12 (10 rulings), then issues for G7/G8.

## What Is Currently In-Flight

Nothing. No lanes, no lane worktrees, no test servers, no `refs/locallama`
refs. `docs/agents/model-register.runs.json` (+ `.lock`) is still untracked.

## Follow-ups noted in the work ledger (not bugs reported by the maintainer)

#142 (snapshot reads the real index once; a git-ignored hint aborts the
snapshot), #147 (cleanup race with a cancelled worker; cancel between claim
and worker start), #151 (subtask failure found by error text).
