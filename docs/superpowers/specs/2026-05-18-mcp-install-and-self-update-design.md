# Design: MCP Installation & Self-Update Feature

**Date:** 2026-05-18  
**Branch:** future-testing  
**Repo:** https://github.com/Heratiki/locallama-mcp  
**Status:** Approved, pending implementation

---

## Overview

Two goals:

1. Clone and install the `future-testing` branch as a live MCP server that Claude Code (and any MCP-capable agent) can use at `C:\Users\herat\.claude\mcp-servers\locallama-mcp`.
2. Add a self-update capability to the server so it can detect and apply upstream changes from GitHub.

---

## Part 1: Installation

### Clone Location

```
C:\Users\herat\.claude\mcp-servers\locallama-mcp
```

Clone command:

```
git clone --branch future-testing https://github.com/Heratiki/locallama-mcp.git C:\Users\herat\.claude\mcp-servers\locallama-mcp
```

### Windows Build Fix (prerequisite)

`package.json` build script uses Unix `cp`, which fails on native Windows. Must patch before building:

```json
"build": "tsc --project tsconfig.json && node -e \"const fs=require('fs'); fs.mkdirSync('dist/utils',{recursive:true}); fs.copyFileSync('src/utils/lock-file.js','dist/utils/lock-file.js');\""
```

### Build & Install

```
cd C:\Users\herat\.claude\mcp-servers\locallama-mcp
npm install
npm run build
```

### Claude Code MCP Registration

Add to `C:\Users\herat\.claude\settings.json` under `mcpServers`:

```json
"mcpServers": {
  "locallama-mcp": {
    "command": "node",
    "args": ["C:\\Users\\herat\\.claude\\mcp-servers\\locallama-mcp\\dist\\index.js"],
    "env": {}
  }
}
```

For other MCP clients (Cursor, Copilot Agent, Codex, generic), point their MCP config at the same `dist/index.js` path using stdio transport.

---

## Part 2: Self-Update Feature

### Approach: Git SHA Comparison (Option A)

Compare local `git rev-parse HEAD` against the latest commit SHA on `future-testing` via GitHub API. No version parsing required — works naturally for a branch-tracked install.

GitHub API endpoint (unauthenticated, 60 req/hr):

```
GET https://api.github.com/repos/Heratiki/locallama-mcp/commits/future-testing
```

### New Module

**File:** `src/modules/updater/index.ts`

Responsibilities:
- `getLocalSha(): Promise<string | null>` — runs `git rev-parse HEAD` via child process in install dir; returns `null` if git unavailable or not a git repo
- `getRemoteSha(): Promise<string | null>` — calls GitHub API, extracts `data.sha`; returns `null` on network failure
- `checkForUpdates(): Promise<UpdateCheckResult>` — compares SHAs, returns structured result
- `runUpdate(): Promise<UpdateResult>` — runs `git pull`, `npm install`, `npm run build` sequentially in install dir; stops and returns failure info at first failed step

```typescript
interface UpdateCheckResult {
  upToDate: boolean | null;  // null = check failed
  localSha: string | null;
  remoteSha: string | null;
  error?: string;
}

interface UpdateResult {
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
  restartRequired: boolean;
}
```

### Startup Check

In `src/index.ts`, after server initialization, fire-and-forget:

```typescript
checkForUpdates().then(result => {
  if (result.upToDate === false) {
    logger.warn(`locallama-mcp update available. Remote: ${result.remoteSha?.slice(0,7)}. Run check_for_updates tool or call update_server to apply.`);
  }
}).catch(() => { /* never throw on startup */ });
```

- Failures silently swallowed — server always starts normally
- Not a git repo: skip entirely
- `git` not on PATH: log single warning, skip

### New MCP Tools

Two tools registered via existing `toolDefinitionProvider`:

#### `check_for_updates`

- **Description:** Check whether the running locallama-mcp server is up to date with the latest commit on the `future-testing` branch on GitHub.
- **Input:** none
- **Output:** `UpdateCheckResult` as JSON text content
- **Errors:** Returned as structured result, never thrown

#### `update_server`

- **Description:** Pull the latest changes from GitHub and rebuild the server. The server must be restarted after this completes for changes to take effect.
- **Input:** none
- **Output:** `UpdateResult` as JSON text content including a `restartRequired: true` field and restart instructions
- **Steps executed:**
  1. `git pull`
  2. `npm install`
  3. `npm run build`
- **Stops** at first failure, reports which step failed

### Safety Constraints

- GitHub API call is read-only and unauthenticated
- `update_server` runs commands only in the known install directory (`__dirname`-relative path resolved at startup) — no user input is passed to shell
- No auto-update — startup check reads only; `update_server` only runs on explicit tool call
- After update, server must be restarted manually (stdio MCP cannot hot-reload)
- `update_server` tool description must clearly state restart is required

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `src/modules/updater/index.ts` | New — updater module |
| `src/modules/api-integration/tool-definition/index.ts` | Register two new tools |
| `src/index.ts` | Add startup update check |
| `package.json` | Fix Windows build script |

---

## Out of Scope

- Automatic restart after update
- Rollback on failed update
- Authenticated GitHub API calls (not needed at this usage rate)
- Update checking on non-git installs (npm global, etc.)

---

## Notes for Other Agents

- Read `docs/AGENTS.md` and `docs/PROJECT_STATE.md` before touching code
- Known broken: `npm run build` on Windows (fix is in scope above), `npm run lint` (missing `eslint-plugin-import`), benchmark scripts
- Use existing `logger` utility from `src/utils/logger.ts` — do not introduce a new logging dependency
- Keep provider-specific and tool-specific logic in their respective modules; updater is a standalone module
- After implementation, append historical entries to `docs/history/memory-bank/progress.md` and `docs/history/memory-bank/decisionLog.md`
