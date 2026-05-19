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
