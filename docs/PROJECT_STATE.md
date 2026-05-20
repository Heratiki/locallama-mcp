# Project State

Last updated: 2026-05-19

## Purpose

This file is the living snapshot of the current repository state for the `future-testing` branch.
It is meant to stay tracked in git and to survive across machines and operating systems without
carrying secrets.

## Current source of truth

- `docs/AGENTS.md` - always-on working instructions for coding agents.
- `docs/PLAN.md` - implementation plan for the `future-testing` branch.
- `docs/OPERATIONAL_TEST_PLAN.md` - live test record and verified behavior.
- `docs/PROJECT_STATE.md` - current snapshot of completed work, active concerns, and branch-specific notes.
- `docs/history/memory-bank/` - historical append-only context only; not the primary decision source.

If two files disagree, prefer the most specific current branch document first:
`docs/OPERATIONAL_TEST_PLAN.md` for verified runtime behavior, `docs/PLAN.md` for implementation intent,
and this file for the current snapshot.

## Current snapshot

- Windows build currently works with the Node-based copy step.
- `npm test` is now OS-agnostic: the package script calls Jest through `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` instead of shell-specific `NODE_OPTIONS=...`.
- Latest local verification on Windows: `npm run build` passes; `npm test` passes with 23 suites / 186 tests. The prior Jest forced-worker-exit warning was fixed by adding JobTracker WebSocket teardown and clearing/unref'ing benchmark API timeout handles.
- Benchmark npm scripts now invoke the root `run-benchmarks.js` CLI after build.
- The benchmark runner uses discovered models from the server path, with optional CLI filtering via `benchmark-models.json`.
- The repo still has open work around lint dependency drift, benchmark realism, and remaining routing modernization.
- `benchmark_task` and `benchmark_tasks` dispatcher gaps are fixed as of 2026-05-19. Targeted live MCP checks against Ollama `qwen2.5-coder:3b` passed.
- Task-executing MCP tools now attach live monitoring metadata when the JobTracker WebSocket server is running: `monitoring.websocketUrl`, `monitoring.activeJobsUri`, and `monitoring.jobProgressUriTemplate`.
- OpenRouter credit usage now uses the current `/api/v1/credits` endpoint. Full paid `route_task` routing is fixed and live-verified: with `OPENROUTER_FREE_ONLY=false`, MCP `route_task` returned paid `openai/gpt-4o` via OpenRouter and consumed about `$0.000695`.
- The MCP install/self-update feature is implemented in source (`src/modules/updater/index.ts`, `check_for_updates`, `update_server`, startup check). Older superpowers spec/plan files are historical implementation notes unless their status block says otherwise.
- `docs/PLAN.md` and `docs/OPERATIONAL_TEST_PLAN.md` are the authoritative future-testing docs when they differ from older notes.
- Task 4 in `docs/ROADMAP_ACTIVE.md` is complete as of 2026-05-19: routing now uses `js-tiktoken`-backed prompt token counting and returns structured `context_overflow` errors before dispatch when prompts exceed declared model context windows. Latest verification: `npm run build`, `npm test`, and `node test-operational.mjs --suite routing` pass.
- Issue #30 provider execution queuing is partially implemented as of 2026-05-20: the provider registry path enforces one shared local execution slot by default and one independent slot per remote provider by default. Caps are configurable via `PROVIDER_MAX_CONCURRENT_LOCAL` and `PROVIDER_MAX_CONCURRENT_REMOTE`. Unit coverage exists for local serialization and local+remote parallelism; live MCP concurrency validation is still pending.
- OpenRouter Axios error logging now redacts credential-bearing request details as of 2026-05-20; logs keep response status/body summaries without serializing the original Axios request config.
- Issue #32 was accidentally merged to `main` via PR #35 with no implementation diff. A fresh `future-testing` implementation was completed as of 2026-05-20: `route_task` queues a persistent Task/Job and returns `task_id` immediately; callers poll `get_task_status` or use `cancel_task`.

## What to keep out of docs

- API keys, tokens, passwords, certs, private URLs with embedded credentials, and machine-specific secrets.
- Raw benchmark outputs that contain private prompts or service responses.
- Local-only paths that are not useful to other contributors.

Store secrets in `.env` or another ignored local config file. Document only the variable names,
defaults, and safe examples in tracked docs.

## Multi-machine and multi-branch guidance

- Keep branch-specific decisions in tracked markdown files, not in ignored local notes.
- Use dated append-only entries for changes in behavior or decisions.
- Keep OS-specific setup in scripts and env examples, not in free-form memory notes.
- If a branch needs a temporary local override, use an ignored local file or user-home config, not repo docs.

## Update rules

- Add a short dated note here when the current state changes in a way that matters to future work.
- Do not rewrite history unless the user explicitly asks.
- If a note becomes wrong, add a correction rather than deleting the original entry.
