#!/usr/bin/env node
// Part A: live mode targets PRD 01 §5.1; only --dry-run is verified before #147.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const seed = join(project, 'test/fixtures/patch-seed');
const abort = new AbortController();
const children = new Set();
let transport;
let serverPid;

function requireThat(ok, message) {
  if (!ok) throw new Error(message);
}
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function positive(value, name) {
  requireThat(/^[1-9]\d*$/.test(value ?? '') && Number.isSafeInteger(Number(value)), `${name} needs a positive integer`);
  return Number(value);
}
function options(args) {
  const opts = { reps: 3, conditions: [1, 12], dryRun: false, only: null, config: null,
    output: join(project, 'scripts/patch-seed/results', new Date().toISOString().replaceAll(':', '-')) };
  for (let n = 0; n < args.length; n++) {
    switch (args[n]) {
      case '--dry-run': opts.dryRun = true; break;
      case '--reps': opts.reps = positive(args[++n], '--reps'); break;
      case '--max-attempts': opts.conditions = [positive(args[++n], '--max-attempts')]; break;
      case '--only': opts.only = args[++n]; requireThat(!!opts.only, '--only needs an id'); break;
      case '--run-config': opts.config = args[++n]; requireThat(!!opts.config, '--run-config needs a path'); break;
      case '--output': requireThat(!!args[n + 1], '--output needs a path prefix'); opts.output = resolve(args[++n]); break;
      default: throw new Error(`Unknown option: ${args[n]}`);
    }
  }
  return opts;
}
function safePath(base, path) {
  requireThat(typeof path === 'string' && path.length > 0 && !isAbsolute(path), `Invalid relative path: ${path}`);
  const full = resolve(base, path);
  const rel = relative(base, full);
  requireThat(rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`), `Path escapes fixture: ${path}`);
  requireThat(existsSync(full) && lstatSync(full).isFile(), `Missing file: ${full}`);
  return full;
}
function plainTree(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    requireThat(entry.name !== '.git' && !entry.isSymbolicLink(), `Fixture must be a plain directory: ${join(path, entry.name)}`);
    if (entry.isDirectory()) plainTree(join(path, entry.name));
  }
}
function validateChecks(checks) {
  requireThat(Array.isArray(checks) && checks.length > 0, 'Checks must be non-empty');
  for (const check of checks) {
    requireThat(typeof check.name === 'string' && check.name.length > 0, 'Check needs a name');
    requireThat(Array.isArray(check.argv) && check.argv.length > 0 && check.argv.every(a => typeof a === 'string') && check.argv[0], 'Check needs an argv array');
    if (check.timeout_ms !== undefined) positive(String(check.timeout_ms), 'timeout_ms');
    requireThat(!check.append_changed_files, 'Seed checks must run the full fixture suite');
  }
}
function loadRequests() {
  const requests = json(join(seed, 'requests.json'));
  requireThat(Array.isArray(requests) && requests.length === 10, 'Seed must have exactly 10 requests');
  const ids = new Set();
  for (const repo of ['ts', 'py']) {
    plainTree(join(seed, `${repo}-repo`));
    validateChecks(json(join(seed, `${repo}-repo/.locallama/checks.json`)).checks);
  }
  for (const request of requests) {
    requireThat(/^[a-z0-9-]+$/.test(request.id) && !ids.has(request.id), `Invalid or duplicate id: ${request.id}`);
    ids.add(request.id);
    requireThat(['ts', 'py'].includes(request.repo), `Invalid repo: ${request.repo}`);
    requireThat(typeof request.goal === 'string' && request.goal.trim().length > 20, `${request.id}: missing goal`);
    requireThat(Array.isArray(request.file_hints) && request.file_hints.length > 0, `${request.id}: missing hints`);
    for (const hint of request.file_hints) safePath(join(seed, `${request.repo}-repo`), hint);
    requireThat(new RegExp(`^hidden/[a-z0-9-]+\\.${request.repo === 'ts' ? 'mjs' : 'py'}$`).test(request.hidden_test), `${request.id}: hidden test must be outside the fixture`);
    safePath(seed, request.hidden_test);
    validateChecks(request.checks);
    requireThat(JSON.stringify(request.checks) === JSON.stringify(json(join(seed, `${request.repo}-repo/.locallama/checks.json`)).checks), `${request.id}: checks differ from fixture checks`);
  }
  return requests;
}

const checkEnv = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
  value !== undefined && /^(HOME|USERPROFILE|SYSTEMROOT|WINDIR|LANG|LANGUAGE|LC_.*)$/.test(key)));
const commandEnv = { ...checkEnv, PATH: `${join(project, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`, PYTHONDONTWRITEBYTECODE: '1' };
function killChild(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function command(argv, cwd, timeout = 30_000, input) {
  abort.signal.throwIfAborted();
  return new Promise((done, reject) => {
    const started = Date.now();
    const child = spawn(argv[0], argv.slice(1), { cwd, env: commandEnv, shell: false,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    child.on('spawn', () => console.error(`Started ${argv[0]} PID ${child.pid}`));
    let tail = '';
    let timedOut = false;
    let killTimer;
    const collect = data => { tail = (tail + data.toString()).slice(-16_384); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const stop = () => {
      killChild(child);
      killTimer ??= setTimeout(() => killChild(child, 'SIGKILL'), 1000);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    abort.signal.addEventListener('abort', stop, { once: true });
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(killTimer);
      abort.signal.removeEventListener('abort', stop); children.delete(child);
    };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', (exitCode, signal) => {
      cleanup();
      if (abort.signal.aborted) return reject(abort.signal.reason);
      done({ argv, exit_code: exitCode, signal, timed_out: timedOut, duration_ms: Date.now() - started, tail });
    });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') collect(String(error)); });
    child.stdin.end(input);
  });
}
async function mustRun(argv, cwd, timeout, input) {
  const result = await command(argv, cwd, timeout, input);
  requireThat(result.exit_code === 0 && !result.timed_out, `${argv.join(' ')} failed: ${result.tail}`);
  return result;
}
async function copyRepo(repo, destination) {
  cpSync(join(seed, `${repo}-repo`), destination, { recursive: true });
  await mustRun(['git', 'init', '--quiet'], destination);
  await mustRun(['git', 'add', '--', '.locallama', '.gitignore', ...(repo === 'ts' ? ['package.json', 'tsconfig.json', 'src', 'test'] : ['text.py', 'sequences.py', 'price.py', 'receipt.py', 'tests'])], destination);
  await mustRun(['git', '-c', 'user.name=Patch Seed', '-c', 'user.email=patch-seed@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Seed baseline'], destination);
}
async function checksFor(request, repo) {
  const results = [];
  for (const check of request.checks) {
    const result = await command(check.argv, repo, check.timeout_ms);
    results.push({ name: check.name, ...result });
    if (result.exit_code !== 0 || result.timed_out) break;
  }
  return results;
}
function passed(checks) { return checks.length > 0 && checks.every(c => c.exit_code === 0 && !c.timed_out); }
async function hiddenTest(request, repo) {
  // Called only after task completion/checks. Never copy this into the submitted repo.
  const name = request.repo === 'ts' ? 'acceptance.test.mjs' : 'acceptance_test.py';
  cpSync(safePath(seed, request.hidden_test), join(repo, name));
  return command(request.repo === 'ts' ? ['node', '--test', name] : ['python3', '-m', 'unittest', 'acceptance_test'], repo, 10_000);
}
async function dryRun(requests, temp) {
  const baselines = new Set();
  let failures = 0;
  for (const request of requests) {
    const repo = join(temp, request.id);
    await copyRepo(request.repo, repo);
    const checks = await checksFor(request, repo);
    requireThat(passed(checks), `${request.id}: baseline checks failed: ${JSON.stringify(checks)}`);
    baselines.add(request.repo);
    const hidden = await hiddenTest(request, repo);
    requireThat(hidden.exit_code !== 0 && hidden.exit_code !== null && !hidden.timed_out && /AssertionError|ERR_ASSERTION/.test(hidden.tail), `${request.id}: hidden test must fail an assertion on baseline: ${hidden.tail}`);
    failures++;
  }
  console.log(JSON.stringify({ mode: 'dry-run', requests: requests.length, baseline_repos_passed: baselines.size,
    hidden_tests_failed: failures, server_started: false }));
}

function payload(response) {
  requireThat(!response.isError, `MCP tool error: ${JSON.stringify(response.content)}`);
  return response.structuredContent ?? JSON.parse(response.content.find(c => c.type === 'text').text);
}
async function poll(client, taskId, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const status = payload(await client.callTool({ name: 'get_task_status', arguments: { task_id: taskId } }, undefined,
      { timeout: Math.min(30_000, Math.max(1, deadline - Date.now())), signal: abort.signal }));
    if (['completed', 'failed', 'cancelled', 'partially_failed', 'permanently_failed'].includes(status.status)) {
      const result = status.jobs?.map(j => j.result).find(r => r?.schema === 'patch_result_v1');
      requireThat(result, `Terminal task ${taskId} has no parsed patch_result_v1`);
      return result;
    }
    await delay(Math.min(5000, Math.max(100, status.poll_again_after_ms ?? 1000)), undefined, { signal: abort.signal });
  }
  throw new Error(`Task ${taskId} exceeded polling deadline`);
}
function conditionsSummary(rows, conditions) {
  return conditions.map(maxAttempts => {
    const runs = rows.filter(r => r.max_attempts === maxAttempts);
    const passes = runs.filter(r => r.pass).length;
    const time = runs.reduce((sum, r) => sum + r.elapsed_ms, 0);
    const tokens = runs.reduce((sum, r) => sum + Object.values(r.patch.tokens).reduce((a, b) => a + b, 0), 0);
    return { max_attempts: maxAttempts, runs: runs.length, passes, pass_rate: runs.length ? passes / runs.length : null,
      elapsed_ms: time, tokens, time_ms_per_pass: passes ? time / passes : null, tokens_per_pass: passes ? tokens / passes : null,
      cost_usd: runs.reduce((sum, r) => sum + r.patch.cost_usd, 0) };
  });
}
function saveReport(prefix, report, conditions) {
  report.conditions = conditionsSummary(report.runs, conditions);
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2) + '\n');
  const table = report.conditions.map(c => `| ${c.max_attempts} | ${c.runs} | ${c.passes} | ${c.pass_rate ?? 'n/a'} | ${c.time_ms_per_pass ?? 'n/a'} | ${c.tokens_per_pass ?? 'n/a'} | ${c.cost_usd} |`).join('\n');
  writeFileSync(`${prefix}.md`, `# Patch seed results\n\nStatus: ${report.status}. Live run; no floor simulation claimed.\n\nSettings fixed before submission:\n\n\x60\x60\x60json\n${JSON.stringify(report.protocol, null, 2)}\n\x60\x60\x60\n\n| Max attempts | Runs | Passes | Pass rate | ms/pass | tokens/pass | USD |\n|---|---|---|---|---|---|---|\n${table}\n\nTime and tokens per pass include failed runs in the numerator. Null/n/a means no passes. A pass needs the returned patch, re-run checks, and the hidden test.\n\n${report.error ?? ''}\n\nPer-request results are in the adjacent JSON file.\n`);
}
function liveConfig(path) {
  requireThat(path, 'Live mode requires --run-config: record models, runtime and settings before running (see README.md)');
  const config = json(resolve(path));
  requireThat(typeof config.runtime === 'string' && config.runtime.trim(), 'run-config needs a runtime description');
  requireThat(Array.isArray(config.models) && config.models.length > 0, 'run-config needs a fixed model list');
  for (const model of config.models) requireThat(model.model_id && model.provider_id && ['local', 'free'].includes(model.cost_class), 'Only named local/free models are allowed');
  requireThat(config.settings && typeof config.settings === 'object' && !Array.isArray(config.settings), 'run-config needs settings');
  const allowed = /^(PATCH_(LOCAL_MODELS|FREE_MODELS|ATTEMPTS_PER_MODEL|TASK_TIMEOUT_MS|MAX_OUTPUT_TOKENS|CONTEXT_TOKENS|INFERENCE_TIMEOUT_MS|CHECK_TIMEOUT_MS|ERROR_TAIL_TOKENS|WHOLE_FILE_MAX_LINES)|MODEL_(TEMPERATURE|MAX_TOKENS|TOP_P|FREQUENCY_PENALTY|PRESENCE_PENALTY)|OLLAMA_ENDPOINT|LM_STUDIO_ENDPOINT|LLAMA_CPP_ENDPOINT)$/;
  for (const [key, value] of Object.entries(config.settings)) requireThat(allowed.test(key) && typeof value === 'string', `Unsupported setting: ${key} (values must be strings)`);
  return config;
}
async function stopServer() {
  if (!transport) return;
  // PID-specific only; never signal any pre-existing LocalLama server.
  if (serverPid && transport.pid === serverPid) {
    try { process.kill(serverPid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await transport.close(); // SDK waits, then escalates to SIGKILL on its own child.
  transport = undefined;
  serverPid = undefined;
}
async function liveRun(opts, requests, temp) {
  const config = liveConfig(opts.config);
  requireThat(existsSync(join(project, 'dist/index.js')), 'Build dist/index.js before a live run');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const defaults = { PATCH_LOCAL_MODELS: '2', PATCH_FREE_MODELS: '2', PATCH_ATTEMPTS_PER_MODEL: '3',
    PATCH_TASK_TIMEOUT_MS: '7200000', PATCH_MAX_OUTPUT_TOKENS: '2000', PATCH_CONTEXT_TOKENS: '6000',
    PATCH_INFERENCE_TIMEOUT_MS: '900000', PATCH_CHECK_TIMEOUT_MS: '600000', PATCH_ERROR_TAIL_TOKENS: '800',
    PATCH_WHOLE_FILE_MAX_LINES: '150', MODEL_TEMPERATURE: '0.7', MODEL_MAX_TOKENS: '2048', MODEL_TOP_P: '0.95',
    MODEL_FREQUENCY_PENALTY: '0', MODEL_PRESENCE_PENALTY: '0', OLLAMA_ENDPOINT: 'http://localhost:11434/api',
    LM_STUDIO_ENDPOINT: 'http://localhost:1234/v1', LLAMA_CPP_ENDPOINT: '' };
  const fixed = { ...defaults, ...config.settings, PATCH_TASKS_ENABLED: 'true', PATCH_PAID_MODELS: '0',
    PATCH_PAID_CAP_USD: '0', OPENROUTER_FREE_ONLY: 'true', PATCH_MAX_CONCURRENT: '1', PATCH_KEEP_WORKSPACE_ON_FAIL: 'false',
    STARTUP_BENCHMARK_TARGETS: 'none', LLAMA_CPP_PORT_SCAN_ENABLED: 'false' };
  const report = { schema: 'patch_seed_v1', status: 'running', protocol: { started_at: new Date().toISOString(),
    models: config.models, runtime: config.runtime, settings: fixed, conditions: opts.conditions, reps: opts.reps,
    request_ids: requests.map(r => r.id), node: process.version,
    manifest_sha256: createHash('sha256').update(readFileSync(join(seed, 'requests.json'))).digest('hex') }, runs: [] };
  // Persist the model/runtime/settings declaration before the first server or task.
  saveReport(opts.output, report, opts.conditions);
  try {
    for (const maxAttempts of opts.conditions) {
      const state = join(temp, `server-${maxAttempts}`);
      mkdirSync(join(state, 'data'), { recursive: true });
      const env = { PATH: commandEnv.PATH, ...fixed, PATCH_MAX_ATTEMPTS: String(maxAttempts),
        LOCALLAMA_ROOT_DIR: state, LOG_FILE: join(state, 'server.log'), SCRATCH_DIR: join(state, 'scratch'),
        JOB_DB_PATH: join(state, 'data/jobs.db'), BENCHMARK_DB_PATH: join(state, 'data/benchmarks.db'),
        PATCH_REPO_ROOTS: temp };
      // The only credential forwarded is for the explicitly free-only OpenRouter path.
      if (process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
      class OwnedTransport extends StdioClientTransport {
        async start() {
          await super.start();
          serverPid = this.pid;
          console.error(`Started LocalLama server PID ${serverPid}`);
        }
      }
      transport = new OwnedTransport({ command: process.execPath, args: [join(project, 'dist/index.js')], cwd: state, env, stderr: 'inherit' });
      const client = new Client({ name: 'patch-seed', version: '1.0.0' }, { capabilities: {} });
      try {
        await client.connect(transport, { timeout: 60_000, signal: abort.signal });
        for (const request of requests) for (let rep = 1; rep <= opts.reps; rep++) {
          const runRoot = join(temp, `${maxAttempts}-${request.id}-${rep}`);
          const submitted = join(runRoot, 'submitted');
          const evaluation = join(runRoot, 'evaluation');
          await copyRepo(request.repo, submitted);
          const started = Date.now();
          const submittedTask = payload(await client.callTool({ name: 'patch_task', arguments: {
            goal: request.goal, repo_path: submitted, file_hints: request.file_hints, checks: request.checks,
            allow_paid: false, paid_cap_usd: 0, validate: false,
          } }, undefined, { timeout: 30_000, signal: abort.signal }));
          requireThat(typeof submittedTask.task_id === 'string', 'patch_task did not return task_id');
          const patch = await poll(client, submittedTask.task_id, Number(fixed.PATCH_TASK_TIMEOUT_MS) + 60_000);
          const row = { id: request.id, rep, max_attempts: maxAttempts, task_id: submittedTask.task_id,
            pass: false, elapsed_ms: Date.now() - started, patch, apply: null, checks: [], hidden: null };
          report.runs.push(row); // Retain usage evidence even if a protocol check rejects it.
          requireThat(patch.cost_usd === 0 && patch.tokens?.paid === 0, 'Non-zero paid usage: stopping run');
          requireThat(patch.models.every(m => config.models.some(expected => expected.model_id === m.model_id && expected.provider_id === m.provider_id && expected.cost_class === m.cost_class)), 'Model outside the declared fixed list: stopping run');
          let checks = [];
          let hidden = null;
          let apply = null;
          if (patch.status === 'passed') {
            await copyRepo(request.repo, evaluation);
            // Apply to a fresh baseline, rather than trusting the server workspace.
            apply = await command(['git', 'apply', '--whitespace=nowarn', '-'], evaluation, 30_000, patch.diff);
            if (apply.exit_code === 0 && !apply.timed_out) {
              checks = await checksFor(request, evaluation);
              if (passed(checks)) hidden = await hiddenTest(request, evaluation);
            }
          }
          Object.assign(row, { pass: patch.status === 'passed' && passed(checks) && hidden?.exit_code === 0 && !hidden.timed_out,
            elapsed_ms: Date.now() - started, apply, checks, hidden });
          saveReport(opts.output, report, opts.conditions);
        }
      } finally {
        await stopServer();
        await client.close();
      }
    }
    report.status = 'completed';
  } catch (error) {
    report.status = 'incomplete';
    report.error = String(error);
    throw error;
  } finally {
    report.ended_at = new Date().toISOString();
    saveReport(opts.output, report, opts.conditions);
    console.error(`Reports: ${opts.output}.json and ${opts.output}.md`);
  }
}

async function main() {
  const opts = options(process.argv.slice(2));
  const all = loadRequests();
  const requests = opts.only ? all.filter(r => r.id === opts.only) : all;
  requireThat(requests.length > 0, `Unknown request id: ${opts.only}`);
  const temp = mkdtempSync(join(tmpdir(), 'locallama-patch-seed-'));
  try {
    if (opts.dryRun) await dryRun(requests, temp);
    else await liveRun(opts, requests, temp);
  } finally {
    try { await stopServer(); }
    finally { rmSync(temp, { recursive: true, force: true }); }
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  abort.abort(new Error(`Received ${signal}`));
});
process.once('exit', () => {
  if (serverPid && transport?.pid === serverPid) {
    try { process.kill(serverPid, 'SIGKILL'); } catch { /* already exited */ }
  }
  for (const child of children) killChild(child, 'SIGKILL');
});
main().catch(error => { console.error(error); process.exitCode ||= 1; });
