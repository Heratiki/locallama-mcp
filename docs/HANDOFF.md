# Handoff

## Last Updated

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
