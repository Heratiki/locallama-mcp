# MCP Install & Self-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Windows build, add a self-update module with two MCP tools (`check_for_updates`, `update_server`), add a startup update check, then clone/build/register the server in Claude Code.

**Architecture:** A standalone `src/modules/updater/index.ts` module compares local git SHA to GitHub API and optionally runs `git pull && npm install && npm run build`. The module is wired into the existing tool dispatch switch in `src/index.ts` and fires a silent startup check after `server.connect()`. Tool definitions are added to the existing `getAvailableTools()` array in `src/modules/api-integration/tool-definition/index.ts`.

**Tech Stack:** TypeScript ESM, Node.js `child_process.execSync`, `https` built-in (no new deps), Jest for tests, `@modelcontextprotocol/sdk`.

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Fix `build` script — replace Unix `cp` with cross-platform Node inline |
| `src/modules/updater/index.ts` | **New** — types + `getLocalSha`, `getRemoteSha`, `checkForUpdates`, `runUpdate` |
| `test/modules/updater/index.test.ts` | **New** — unit tests for updater module |
| `src/modules/api-integration/tool-definition/index.ts` | Add `check_for_updates` and `update_server` to `getAvailableTools()` |
| `src/index.ts` | Add `check_for_updates` and `update_server` cases to switch; add startup check after `server.connect()` |
| `C:\Users\herat\.claude\settings.json` | Add `mcpServers` entry pointing to installed clone |

---

## Task 1: Fix Windows Build Script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Edit build script**

Open `package.json`. Replace the `build` script value:

```json
"build": "tsc --project tsconfig.json && node -e \"const fs=require('fs');fs.mkdirSync('dist/utils',{recursive:true});fs.copyFileSync('src/utils/lock-file.js','dist/utils/lock-file.js');\""
```

- [ ] **Step 2: Verify TypeScript compiles**

Run from the worktree root `C:\Users\herat\source\locallama-mcp\.claude\worktrees\cool-satoshi-e7371b`:

```
npx tsc --project tsconfig.json --noEmit
```

Expected: exits 0, no errors printed.

- [ ] **Step 3: Commit**

```
git add package.json
git commit -m "fix: cross-platform build script for Windows"
```

---

## Task 2: Create Updater Module Types and Helpers

**Files:**
- Create: `src/modules/updater/index.ts`

- [ ] **Step 1: Write failing test first**

Create `test/modules/updater/index.test.ts`:

```typescript
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';

// We test the pure logic; shell/network calls are mocked.
jest.mock('child_process');
jest.mock('https');

import { execSync } from 'child_process';
import * as https from 'https';

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('getLocalSha', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns trimmed SHA string when git succeeds', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    const { getLocalSha } = await import('../../../dist/modules/updater/index.js');
    const sha = await getLocalSha();
    expect(sha).toBe('abc1234');
  });

  it('returns null when git is not available', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('git not found'); });
    const { getLocalSha } = await import('../../../dist/modules/updater/index.js');
    const sha = await getLocalSha();
    expect(sha).toBeNull();
  });
});

describe('checkForUpdates', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns upToDate true when SHAs match', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    // getRemoteSha is tested via integration; mock it at module boundary
    const updater = await import('../../../dist/modules/updater/index.js');
    jest.spyOn(updater, 'getRemoteSha').mockResolvedValue('abc1234');
    const result = await updater.checkForUpdates();
    expect(result.upToDate).toBe(true);
    expect(result.localSha).toBe('abc1234');
    expect(result.remoteSha).toBe('abc1234');
  });

  it('returns upToDate false when SHAs differ', async () => {
    mockExecSync.mockReturnValue(Buffer.from('abc1234\n'));
    const updater = await import('../../../dist/modules/updater/index.js');
    jest.spyOn(updater, 'getRemoteSha').mockResolvedValue('def5678');
    const result = await updater.checkForUpdates();
    expect(result.upToDate).toBe(false);
  });

  it('returns upToDate null on error', async () => {
    mockExecSync.mockImplementation(() => { throw new Error('git not found'); });
    const updater = await import('../../../dist/modules/updater/index.js');
    jest.spyOn(updater, 'getRemoteSha').mockRejectedValue(new Error('network'));
    const result = await updater.checkForUpdates();
    expect(result.upToDate).toBeNull();
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (module not yet created)**

```
npx tsc --project tsconfig.json --noEmit 2>&1 | head -5
```

Expected: TypeScript error about missing `src/modules/updater/index.ts` or test import.

- [ ] **Step 3: Create the updater module**

Create `src/modules/updater/index.ts`:

```typescript
import { execSync } from 'child_process';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Resolve install root: dist/modules/updater -> project root
const INSTALL_ROOT = join(__dirname, '../../..');

const GITHUB_API_URL = 'https://api.github.com/repos/Heratiki/locallama-mcp/commits/future-testing';

export interface UpdateCheckResult {
  upToDate: boolean | null;
  localSha: string | null;
  remoteSha: string | null;
  error?: string;
}

export interface UpdateResult {
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
  restartRequired: boolean;
}

export async function getLocalSha(): Promise<string | null> {
  try {
    const output = execSync('git rev-parse HEAD', {
      cwd: INSTALL_ROOT,
      stdio: 'pipe',
    });
    return output.toString().trim();
  } catch {
    return null;
  }
}

export async function getRemoteSha(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_API_URL,
      { headers: { 'User-Agent': 'locallama-mcp-updater' } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { sha?: string };
            resolve(parsed.sha ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const [localSha, remoteSha] = await Promise.all([getLocalSha(), getRemoteSha()]);
    if (localSha === null || remoteSha === null) {
      return {
        upToDate: null,
        localSha,
        remoteSha,
        error: localSha === null ? 'Could not read local git SHA' : 'Could not reach GitHub API',
      };
    }
    return { upToDate: localSha === remoteSha, localSha, remoteSha };
  } catch (err) {
    return {
      upToDate: null,
      localSha: null,
      remoteSha: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runUpdate(): Promise<UpdateResult> {
  const completedSteps: string[] = [];
  const steps: Array<{ name: string; cmd: string }> = [
    { name: 'git pull', cmd: 'git pull' },
    { name: 'npm install', cmd: 'npm install' },
    { name: 'npm run build', cmd: 'npm run build' },
  ];

  for (const step of steps) {
    try {
      execSync(step.cmd, { cwd: INSTALL_ROOT, stdio: 'pipe' });
      completedSteps.push(step.name);
    } catch (err) {
      return {
        success: false,
        completedSteps,
        failedStep: step.name,
        error: err instanceof Error ? err.message : String(err),
        restartRequired: false,
      };
    }
  }

  return {
    success: true,
    completedSteps,
    restartRequired: true,
  };
}

export async function runStartupCheck(): Promise<void> {
  try {
    const localSha = await getLocalSha();
    if (localSha === null) return; // not a git install, skip silently
    const remoteSha = await getRemoteSha();
    if (remoteSha === null) return; // network unavailable, skip silently
    if (localSha !== remoteSha) {
      logger.warn(
        `locallama-mcp update available. Remote: ${remoteSha.slice(0, 7)}, Local: ${localSha.slice(0, 7)}. ` +
        `Call the check_for_updates or update_server tool to apply.`
      );
    }
  } catch {
    // never throw on startup
  }
}
```

- [ ] **Step 4: Compile and run tests**

```
npx tsc --project tsconfig.json --noEmit
NODE_OPTIONS=--experimental-vm-modules npx jest test/modules/updater/index.test.ts --config=jest.config.mjs -t "getLocalSha"
```

Expected: `getLocalSha` describe block passes.

- [ ] **Step 5: Commit**

```
git add src/modules/updater/index.ts test/modules/updater/index.test.ts
git commit -m "feat: add updater module with check and update functions"
```

---

## Task 3: Register Tools in Tool Definition Provider

**Files:**
- Modify: `src/modules/api-integration/tool-definition/index.ts`

The two new tools are always available (no Python/OpenRouter gate). Add them to the `tools` array in `getAvailableTools()` before the `return tools` line.

- [ ] **Step 1: Add tool definitions**

In `src/modules/api-integration/tool-definition/index.ts`, locate the line:

```typescript
    return tools;
```

Insert immediately before it:

```typescript
      tools.push(
        {
          name: 'check_for_updates',
          description: 'Check whether the running locallama-mcp server is up to date with the latest commit on the future-testing branch on GitHub. Returns upToDate status, local SHA, remote SHA, and any error.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        },
        {
          name: 'update_server',
          description: 'Pull the latest changes from GitHub and rebuild the server. Runs git pull, npm install, and npm run build in sequence. IMPORTANT: The server must be manually restarted after this completes for changes to take effect.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      );
```

- [ ] **Step 2: Verify TypeScript**

```
npx tsc --project tsconfig.json --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```
git add src/modules/api-integration/tool-definition/index.ts
git commit -m "feat: register check_for_updates and update_server MCP tools"
```

---

## Task 4: Wire Tools into Tool Call Handler and Add Startup Check

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add import at top of file**

In `src/index.ts`, after the existing imports (around line 16), add:

```typescript
import { checkForUpdates, runUpdate, runStartupCheck } from './modules/updater/index.js';
```

- [ ] **Step 2: Add switch cases**

In `setupToolCallHandler()`, locate the `default:` case in the switch statement (around line 241):

```typescript
                default:
                  logger.error(`Unknown tool: ${name}`);
                  throw new Error(`Unknown tool: ${name}`);
```

Insert before `default:`:

```typescript
                case 'check_for_updates': {
                  const updateCheck = await checkForUpdates();
                  return JSON.stringify(updateCheck);
                }
                case 'update_server': {
                  const updateResult = await runUpdate();
                  return JSON.stringify(updateResult);
                }
```

- [ ] **Step 3: Add startup check**

In the `run()` method, locate this line (around line 334):

```typescript
      await this.server.connect(transport);
      logger.info(`${connectionInfo} (PID: ${process.pid})`);
```

Add after the `logger.info` line:

```typescript
      // Fire-and-forget startup update check — never blocks startup
      runStartupCheck().catch(() => undefined);
```

- [ ] **Step 4: Verify TypeScript**

```
npx tsc --project tsconfig.json --noEmit
```

Expected: exits 0.

- [ ] **Step 5: Run full build**

```
npm run build
```

Expected: TypeScript compiles, `dist/utils/lock-file.js` copied successfully, exits 0.

- [ ] **Step 6: Commit**

```
git add src/index.ts
git commit -m "feat: wire updater tools into tool handler and add startup check"
```

---

## Task 5: Clone, Build, and Register in Claude Code

This task is performed in a terminal (PowerShell), not in the codebase itself.

- [ ] **Step 1: Create install directory**

```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\herat\.claude\mcp-servers"
```

- [ ] **Step 2: Clone future-testing branch**

```powershell
git clone --branch future-testing https://github.com/Heratiki/locallama-mcp.git "C:\Users\herat\.claude\mcp-servers\locallama-mcp"
```

Expected: clone succeeds, `future-testing` branch checked out.

- [ ] **Step 3: Install dependencies**

```powershell
cd "C:\Users\herat\.claude\mcp-servers\locallama-mcp"
npm install
```

Expected: `node_modules` populated, exits 0.

- [ ] **Step 4: Build**

```powershell
npm run build
```

Expected: `dist/` created, `dist/index.js` and `dist/utils/lock-file.js` present, exits 0.

> Note: The Windows build fix from Task 1 must be on the `future-testing` branch (pushed to GitHub) before this step works. If the clone still has the old Unix `cp` script, apply the same fix manually in the cloned copy before running build.

- [ ] **Step 5: Register MCP in Claude Code settings**

Open `C:\Users\herat\.claude\settings.json`. Add `mcpServers` at the top level (alongside existing `hooks`, `statusLine`, etc.):

```json
"mcpServers": {
  "locallama-mcp": {
    "command": "node",
    "args": ["C:\\Users\\herat\\.claude\\mcp-servers\\locallama-mcp\\dist\\index.js"],
    "env": {}
  }
}
```

Full resulting `settings.json` structure (merge, do not replace other keys):

```json
{
  "mcpServers": {
    "locallama-mcp": {
      "command": "node",
      "args": ["C:\\Users\\herat\\.claude\\mcp-servers\\locallama-mcp\\dist\\index.js"],
      "env": {}
    }
  },
  "hooks": { ... },
  "statusLine": { ... },
  "enabledPlugins": { ... },
  "effortLevel": "medium",
  "model": "sonnet"
}
```

- [ ] **Step 6: Restart Claude Code**

Close and reopen Claude Code (or reload the MCP server). Verify `locallama-mcp` appears in the available MCP tools list.

- [ ] **Step 7: Smoke test**

Ask Claude Code to call `check_for_updates`. Expected response shape:

```json
{
  "upToDate": true,
  "localSha": "<7-char SHA>...",
  "remoteSha": "<same SHA>..."
}
```

If `upToDate` is `false`, the GitHub branch has commits ahead of the clone — call `update_server` and restart.

---

## Task 6: Update Memory Bank

**Files:**
- Modify: `docs/history/memory-bank/progress.md`
- Modify: `docs/history/memory-bank/decisionLog.md`

- [ ] **Step 1: Append to progress.md**

Add dated entry:

```markdown
## 2026-05-18 — MCP Install & Self-Update

- Fixed Windows build script (Unix cp → Node inline copy)
- Added `src/modules/updater/index.ts` with `checkForUpdates`, `runUpdate`, `runStartupCheck`
- Registered `check_for_updates` and `update_server` MCP tools
- Added fire-and-forget startup update check after server.connect()
- Cloned future-testing branch to C:\Users\herat\.claude\mcp-servers\locallama-mcp
- Registered server in Claude Code settings.json
```

- [ ] **Step 2: Append to decisionLog.md**

```markdown
## 2026-05-18 — Self-Update Strategy

Decision: Use git SHA comparison (local `git rev-parse HEAD` vs GitHub API) rather than semver/npm-registry check.

Reason: Project tracks a branch (`future-testing`), not published releases. SHA comparison detects any commit, not just tagged versions.

Trade-off: Requires `git` on PATH in the runtime environment. Silent skip if git unavailable.
```

- [ ] **Step 3: Commit**

```
git add docs/history/memory-bank/progress.md docs/history/memory-bank/decisionLog.md
git commit -m "docs: update memory bank after self-update implementation"
```

---

## Self-Review Notes

- **Spec coverage:** All items covered — Windows fix (Task 1), updater module (Task 2), tool registration (Task 3), wire-up + startup check (Task 4), clone/build/register (Task 5).
- **Type consistency:** `UpdateCheckResult` and `UpdateResult` defined in Task 2 and referenced by name in Tasks 3/4 — matches throughout.
- **`getRemoteSha` export:** Must be exported (not just internal) because tests spy on it. The implementation in Task 2 exports it. ✓
- **`runStartupCheck` import:** Added to the import line in Task 4 Step 1. ✓
- **Windows build fix prerequisite:** Task 5 Step 4 notes the dependency — if `future-testing` branch hasn't had Task 1 pushed, a manual workaround is described.
- **`inputSchema.required: []`** for no-arg tools — valid MCP schema. ✓
