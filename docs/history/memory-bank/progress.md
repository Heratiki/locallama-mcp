# Project Progress

Last updated: 2026-04-24

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
