# Project Progress

Last updated: 2026-05-19

## 2026-05-19 — Cross-Platform Test Script and Planning Doc Refresh

Summary:
- Replaced Unix-style `NODE_OPTIONS=...` npm test scripts with direct `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` invocations so `npm test` works on native Windows and remains portable to macOS/Linux.
- Rewrote updater tests to use ESM-compatible Jest module mocks for `child_process` and `https`.
- Added current-status notes to `docs/PLAN.md`, `docs/PROJECT_STATE.md`, and the install/self-update superpowers docs so future readers can quickly tell current work from historical implementation records.

Verification:
- `npm test` passes on native Windows: 21 suites / 181 tests.

Follow-ups:
- `npm run lint` still fails because `eslint-plugin-import` is referenced by `eslint.config.js` but not installed.
- `benchmark_task` and `benchmark_tasks` still need MCP dispatcher cases. Addressed later on 2026-05-19; see the next entry.

## 2026-05-19 — Benchmark Tool Dispatcher Fix

Summary:
- Added MCP dispatcher cases for `benchmark_task` and `benchmark_tasks` in `src/index.ts`.
- Added argument normalization from MCP snake_case fields to `BenchmarkTaskParams`, including defaults for optional `expected_output_length` and `complexity`.
- Added dispatcher tests with realistic refactor/debug/security benchmark payloads.

Verification:
- `npm run build` passes.
- Focused dispatcher test passes: 10 tests.
- `npm test` passes: 21 suites / 184 tests.
- Targeted live MCP `benchmark_task` call against Ollama `qwen2.5-coder:3b` completed in ~9.4s.
- Targeted live MCP `benchmark_tasks` call returned a two-task summary.

Notes:
- First live benchmark attempt exposed an environment dependency issue: `node_modules` had invalid `sqlite3@5.1.7` while `package.json` requires `^6.0.1`. Running `npm install` reconciled to `sqlite3@6.0.1`; `require('sqlite3')` then passed.

Follow-ups:
- Run bounded `benchmark_task` coverage across `qwen2.5-coder:3b`, `qwen2.5-coder:7b`, and `qwen3:4b`, then re-test route selection.
- `npm run lint` still fails because `eslint-plugin-import` is referenced by `eslint.config.js` but not installed.

## 2026-05-19 — OpenRouter Paid-Routing Target Check

Summary:
- Verified `OPENROUTER_API_KEY` is present without exposing it.
- Fixed OpenRouter credit usage lookup from stale `/api/v1/auth/credits` to current `/api/v1/credits`.
- Ran target #3 preflight with a small high-complexity prompt: `get_cost_estimate` reported `$0.0084`; `preemptive_route_task` selected paid `gpt-4o`.
- Ran one full `route_task` attempt only. It attempted OpenRouter model `openrouter/pareto-code`, logged an execution error, and returned a local `qwen2.5-coder:7b` final result.

Verification:
- OpenRouter credits before and after the run: `$1.644186` remaining; no credits consumed.
- Focused cost-monitor API test passes.

Follow-ups:
- Investigate why full `route_task` does not preserve the initial paid routing decision and why `openrouter/pareto-code` fails with an opaque `{}` error.
- Avoid repeated paid-route execution attempts until that code path is inspected.

## 2026-05-19 — Jest Open-Handle Cleanup

Summary:
- Added explicit teardown for the decision-engine JobTracker WebSocket singleton so API integration tests do not leave a server/listeners open.
- Unref'ed long-lived decision-engine timers and benchmark API request timeout handles, and made the LM Studio API timeout clear in a `finally` block.
- Mocked the benchmark simulation logger in the expected Generic API failure-path test so the suite no longer prints a warning for intentional fallback coverage.

Verification:
- `npm run build` passes.
- Focused `resources.test.ts` and `lm-studio.test.ts` runs pass with `--runInBand --detectOpenHandles`.
- Full `--runInBand --detectOpenHandles` run passes: 22 suites / 185 tests, no open-handle report.
- Full `npm test` passes: 22 suites / 185 tests, no forced-worker-exit warning and no Generic API simulation warning.

## 2026-04-24 Revival Work

### Completed

- Added `docs/ROADMAP.md` as the modernization and implementation plan.
- Rewrote `AGENTS.md` as the shared agent-neutral operating guide.
- Replaced `CLAUDE.md` with a small Claude Code pointer to shared guidance.
- Added `memory-bank/README.md` with multi-author memory conventions.
- Added `memory-bank/sessionLog.md` and a first dated session entry.
- Updated `memory-bank/activeContext.md` with current direction and known baseline issues.
- Updated `memory-bank/productContext.md` with the revived product framing.
- Updated README opening and MCP client setup sections for modern agent clients.
- Updated `.gitignore` so `memory-bank/` and `CLAUDE.md` can be tracked as shared project docs.
- Verified the Windows build path now succeeds with the Node-based copy step.
- Restored the root benchmark CLI and wired `npm run benchmark` / `npm run benchmark:comprehensive` to it.
- Marked `PLAN.md` and `OPERATIONAL_TEST_PLAN.md` as the current future-testing authority in memory-bank notes.
- Added `docs/PROJECT_STATE.md` as the tracked current snapshot and shifted memory-bank to historical-only status.

### Verified

- `npx tsc --project tsconfig.json --noEmit` succeeds.
- `npm run build` succeeds on native Windows with the Node-based copy step.
- `npm run lint` currently fails because `eslint-plugin-import` is missing.
- `node --check run-benchmarks.js` succeeds.

## Roadmap Status

- Phase 0: Documentation and Shared Memory - in progress
- Phase 1: Restore Developer Workflow - pending
- Phase 2: MCP Surface Modernization - pending
- Phase 3: Provider Abstraction - pending
- Phase 4: Benchmarking Rebuild - pending
- Phase 5: Task Understanding and Routing - pending
- Phase 6: Documentation, Examples, and Release Prep - pending

## Branch State

- `docs/PROJECT_STATE.md` is the active current-state snapshot.
- `PLAN.md` and `OPERATIONAL_TEST_PLAN.md` remain the branch-specific implementation and verification docs.
- `memory-bank/` remains available for historical append-only notes, not authoritative planning.

## Branch-Specific Notes

- `PLAN.md` is the current implementation plan for `future-testing`.
- `OPERATIONAL_TEST_PLAN.md` is the current live-test record and should override older benchmark assumptions when there is a mismatch.

## Next Steps

- Fix the cross-platform build script.
- Fix lint dependency/configuration drift.
- Restore or replace benchmark npm entrypoints.
- Audit MCP tool definitions and result shapes.

## 2026-05-18 — MCP Install & Self-Update

- Fixed Windows build script (Unix cp → Node inline copy) in package.json
- Fixed dev script same way
- Added `src/modules/updater/index.ts` with `getLocalSha`, `getRemoteSha`, `checkForUpdates`, `runUpdate`, `runStartupCheck`
- Registered `check_for_updates` and `update_server` MCP tools in tool-definition/index.ts
- Wired both tools into tool call handler switch in src/index.ts
- Added fire-and-forget startup update check after server.connect()
- Cloned future-testing branch to C:\Users\herat\.claude\mcp-servers\locallama-mcp
- Registered server in Claude Code via `claude mcp add --scope user` (config goes to ~/.claude.json, not settings.json)
- Server confirmed Connected via `claude mcp list`
- Note: self-update code is on worktree branch claude/cool-satoshi-e7371b, not yet merged to future-testing
