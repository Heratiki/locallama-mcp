import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { config } from '../../../config/index.js';
import type { CheckResult, CheckSpec } from '../types.js';
import { validateChecks, validateStrings, validateTimeout } from './validation.js';
import { OutputTail, truncateTail } from './output.js';

export interface RunChecksOptions {
  worktree: string;
  changedFiles?: string[];
  envAllow?: string[];
  /** Defaults to PATCH_CHECK_TIMEOUT_MS; each CheckSpec can override it. */
  timeoutMs?: number;
  /** Defaults to PATCH_ERROR_TAIL_TOKENS. */
  errorTailTokens?: number;
  /** Cancellation resolves with completed/current results after group shutdown. */
  signal?: AbortSignal;
}

const BASE_ENV = [
  'PATH', 'HOME', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'LC_NUMERIC', 'LC_TIME',
  'LC_COLLATE', 'LC_MONETARY', 'LC_MESSAGES', 'LC_PAPER', 'LC_NAME', 'LC_ADDRESS',
  'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION',
];

function checkEnv(envAllow: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.create(null);
  // Node forwards this variable unless env has its own property for it.
  // An undefined value suppresses forwarding and is omitted from the child.
  env.NODE_V8_COVERAGE = undefined;
  for (const name of [...BASE_ENV, ...envAllow]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}

function groupExists(pid: number): boolean {
  try { process.kill(-pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    // EPERM also proves existence; never mistake it for an exited group.
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

async function runCheck(
  check: CheckSpec, options: RunChecksOptions, env: NodeJS.ProcessEnv,
  timeoutMs: number, tailTokens: number,
): Promise<CheckResult> {
  const started = performance.now();
  const argv = check.argv.slice(1);
  if (check.append_changed_files) argv.push(...(options.changedFiles ?? []));
  const child = spawn(check.argv[0], argv, {
    cwd: options.worktree, shell: false, detached: true,
    stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  const stdout = new OutputTail();
  const stderr = new OutputTail();
  let spawnFailed = false;
  let timedOut = false;
  let stopping = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  child.stdout.on('data', (chunk: Buffer) => stdout.append(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
  child.on('error', error => { spawnFailed = true; stderr.append(Buffer.from(error.message)); });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));

  const signalGroup = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return;
    try { process.kill(-child.pid, signal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
        // A failed signal does not prove exit. Keep waiting for the group.
        stderr.append(Buffer.from(`\n${signal}: ${(error as Error).message}`));
      }
    }
  };
  const stop = (timeout: boolean) => {
    if (stopping) return;
    stopping = true;
    timedOut = timeout;
    clearTimeout(timeoutTimer);
    signalGroup('SIGTERM');
    killTimer = setTimeout(() => signalGroup('SIGKILL'), 5000);
  };
  const timeoutTimer = setTimeout(() => stop(true), check.timeout_ms ?? timeoutMs);
  const onAbort = () => stop(false);
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) onAbort();

  let exitCode: number | null;
  try {
    exitCode = await closed;
    // 'close' covers only the direct child and inherited pipes. Descendants
    // can close their pipes and keep running after the leader exits.
    while (child.pid !== undefined && groupExists(child.pid)) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally {
    clearTimeout(timeoutTimer);
    clearTimeout(killTimer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  const tail = truncateTail([stdout.toString(), stderr.toString()].filter(Boolean).join('\n'), tailTokens);
  return {
    name: check.name, exit_code: spawnFailed ? null : exitCode, timed_out: timedOut,
    duration_ms: Math.round(performance.now() - started), tail,
  };
}

/** Run declared checks one at a time, stopping at the first failure. */
export async function runChecks(
  checks: CheckSpec[],
  options: RunChecksOptions,
): Promise<CheckResult[]> {
  if (process.platform === 'win32') throw new Error('Check runner requires POSIX process groups');
  validateChecks(checks);
  validateStrings(options.changedFiles ?? [], 'changedFiles');
  validateStrings(options.envAllow ?? [], 'envAllow');
  const tailTokens = options.errorTailTokens ?? config.patchErrorTailTokens;
  const timeoutMs = options.timeoutMs ?? config.patchCheckTimeoutMs;
  validateTimeout(timeoutMs);
  if (!Number.isSafeInteger(tailTokens) || tailTokens < 0) {
    throw new Error('errorTailTokens must be a nonnegative integer');
  }
  const env = checkEnv(options.envAllow ?? []);
  const results: CheckResult[] = [];
  for (const check of checks) {
    if (options.signal?.aborted) break;
    const result = await runCheck(check, options, env, timeoutMs, tailTokens);
    results.push(result);
    if (result.exit_code !== 0 || result.timed_out || options.signal?.aborted) break;
  }
  return results;
}
