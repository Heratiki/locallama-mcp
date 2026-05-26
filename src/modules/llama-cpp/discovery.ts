import { access } from 'fs/promises';
import { exec } from 'child_process';
import path from 'path';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { LlamaBinarySet } from './types.js';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getVersionInfo(binaryPath: string): Promise<{ version: string | null; supportsReasoningFormat: boolean }> {
  return new Promise((resolve) => {
    // Standardize path for exec (handle spaces)
    const cmd = `"${binaryPath}" --version`;
    exec(cmd, (error, stdout) => {
      if (error) {
        logger.debug(`Failed to get version for ${binaryPath}: ${error.message}`);
        resolve({ version: null, supportsReasoningFormat: false });
        return;
      }
      const version = stdout.split('\n')[0].trim() || null;
      const supportsReasoningFormat = stdout.includes('--reasoning-format');
      resolve({ version, supportsReasoningFormat });
    });
  });
}

/**
 * Well-known install locations per platform.
 */
function getWellKnownPaths(platform: string): string[] {
  const paths: string[] = [];
  if (platform === 'win32') {
    if (process.env.LOCALAPPDATA) {
      paths.push(path.join(process.env.LOCALAPPDATA, 'llama.cpp'));
    }
    paths.push('C:\\llama.cpp');
  } else if (platform === 'darwin') {
    paths.push('/usr/local/bin', '/opt/homebrew/bin');
  } else {
    // Linux/Other
    paths.push('/usr/local/bin');
    if (process.env.HOME) {
      paths.push(path.join(process.env.HOME, '.local', 'bin'));
    }
  }
  return paths;
}

/**
 * Discover llama.cpp binaries (server, cli, run) on the system.
 */
export async function discoverLlamaBinaries(): Promise<LlamaBinarySet> {
  const platform = process.platform;
  const isWindows = platform === 'win32';
  const exeSuffix = isWindows ? '.exe' : '';

  const serverNames = [`llama-server${exeSuffix}`, `server${exeSuffix}`];
  const cliNames = [`llama-cli${exeSuffix}`];
  const runNames = [`llama-run${exeSuffix}`];

  const result: LlamaBinarySet = {
    server: null,
    cli: null,
    run: null,
    version: null,
    supportsReasoningFormat: false,
    searchedPaths: [],
  };

  const searchBinary = async (names: string[], override?: string): Promise<string | null> => {
    // 1. Env var override
    if (override) {
      result.searchedPaths.push(override);
      if (await fileExists(override)) return override;
    }

    // 2. PATH scan
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    for (const dir of pathDirs) {
      if (!dir) continue;
      for (const name of names) {
        const fullPath = path.join(dir, name);
        result.searchedPaths.push(fullPath);
        if (await fileExists(fullPath)) return fullPath;
      }
    }

    // 3. Well-known locations
    const wellKnownDirs = getWellKnownPaths(platform);
    for (const dir of wellKnownDirs) {
      for (const name of names) {
        const fullPath = path.join(dir, name);
        result.searchedPaths.push(fullPath);
        if (await fileExists(fullPath)) return fullPath;
      }
    }

    // 4. Sibling of model path
    if (config.llamaCppModelPath) {
      const modelDir = path.dirname(config.llamaCppModelPath);
      for (const name of names) {
        const fullPath = path.join(modelDir, name);
        result.searchedPaths.push(fullPath);
        if (await fileExists(fullPath)) return fullPath;
      }
    }

    return null;
  };

  result.server = await searchBinary(serverNames, config.llamaCppServerBin);
  result.cli = await searchBinary(cliNames, config.llamaCppCliBin);
  result.run = await searchBinary(runNames);

  if (result.server) {
    const versionInfo = await getVersionInfo(result.server);
    result.version = versionInfo.version;
    result.supportsReasoningFormat = versionInfo.supportsReasoningFormat;
  }

  return result;
}
