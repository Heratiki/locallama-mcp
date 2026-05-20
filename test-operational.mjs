#!/usr/bin/env node
/**
 * Operational test client for LocalLama MCP Server
 *
 * Spawns the MCP server as a subprocess, connects via stdio using the MCP SDK
 * Client, then runs a structured test suite against real tools and resources.
 *
 * Usage:  node test-operational.mjs [--verbose] [--suite <name>]
 *
 * Suites:
 *   all       (default) Run every test
 *   smoke     Startup, tool list, resource reads only (no LLM calls)
 *   routing   preemptive_route_task + get_cost_estimate (no LLM calls)
 *   llm       route_task with Ollama (makes real LLM calls, slower)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative } from 'path';
import { readFileSync, existsSync } from 'fs';
import process from 'process';

// ── Load .env from project root into process.env before spawning server ───────
function loadDotEnv(dir) {
  const envPath = join(dir, '.env');
  if (!existsSync(envPath)) return {};
  const vars = {};
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    vars[key] = val;
  }
  return vars;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const suiteArg = args.indexOf('--suite');
const SUITE = suiteArg !== -1 ? args[suiteArg + 1] : 'all';

// ── Colours (simple ANSI) ────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
};
const ok  = (msg) => console.log(`  ${C.green}✓${C.reset} ${msg}`);
const fail= (msg) => console.log(`  ${C.red}✗${C.reset} ${msg}`);
const info= (msg) => console.log(`  ${C.cyan}ℹ${C.reset} ${msg}`);
const hdr = (msg) => console.log(`\n${C.bold}${C.cyan}── ${msg} ${C.reset}`);
const dim = (msg) => VERBOSE && console.log(`${C.dim}    ${msg}${C.reset}`);

// ── Test result tracking ──────────────────────────────────────────────────────
const results = { passed: 0, failed: 0, skipped: 0, errors: [] };

function assert(condition, label, detail = '') {
  if (condition) {
    ok(label);
    results.passed++;
  } else {
    fail(`${label}${detail ? ': ' + detail : ''}`);
    results.failed++;
    results.errors.push(label);
  }
}

async function runTest(label, fn) {
  try {
    await fn();
  } catch (e) {
    fail(`${label} threw: ${e.message}`);
    results.failed++;
    results.errors.push(`${label}: ${e.message}`);
    if (VERBOSE) console.error(e);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}LocalLama MCP — Operational Test Suite${C.reset}`);
  console.log(`Suite: ${SUITE}   Verbose: ${VERBOSE}`);
  console.log('─'.repeat(50));

  // Resolve server path relative to this script
  const serverPath = join(__dirname, 'dist', 'index.js');

  // ── Connect ───────────────────────────────────────────────────────────────
  hdr('Connecting to MCP server');

  // Load .env and merge into environment for the server subprocess
  const dotEnvVars = loadDotEnv(__dirname);
  const serverEnv = {
    ...process.env,
    ...dotEnvVars,       // .env overrides shell env
    NODE_ENV: 'test',
  };

  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath],
    env: serverEnv,
    cwd: __dirname,
  });

  const client = new Client(
    { name: 'locallama-operational-test', version: '1.0.0' },
    { capabilities: { roots: {}, sampling: {} } }
  );

  let connected = false;
  try {
    await client.connect(transport);
    connected = true;
    ok('Server process started and MCP handshake complete');
  } catch (e) {
    fail(`Failed to connect: ${e.message}`);
    process.exit(1);
  }

  try {
    await runSuite(client, serverEnv);
  } finally {
    await client.close().catch(() => {});
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  hdr('Results');
  console.log(`  ${C.green}Passed:${C.reset}  ${results.passed}`);
  console.log(`  ${C.red}Failed:${C.reset}  ${results.failed}`);
  console.log(`  ${C.yellow}Skipped:${C.reset} ${results.skipped}`);
  if (results.errors.length) {
    console.log(`\n${C.red}Failed tests:${C.reset}`);
    results.errors.forEach(e => console.log(`  • ${e}`));
  }
  console.log('');
  process.exit(results.failed > 0 ? 1 : 0);
}

function isPathUnderRoot(targetPath, rootPath) {
  const rel = relative(rootPath, targetPath);
  return rel !== '' && !rel.startsWith('..') && !rel.includes(':');
}

async function runSuite(client, serverEnv) {
  const runSmoke   = ['all', 'smoke'].includes(SUITE);
  const runRouting = ['all', 'routing'].includes(SUITE);
  const runLLM     = ['all', 'llm'].includes(SUITE);

  // ── 1. Smoke: Tool & Resource Discovery ───────────────────────────────────
  if (runSmoke) {
    hdr('Smoke: Tool & Resource Discovery');

    await runTest('list tools', async () => {
      const resp = await client.listTools();
      const tools = resp.tools ?? [];
      dim(`Tools found: ${tools.map(t => t.name).join(', ')}`);

      // Always-present tools (no external dependencies)
      const coreTools = [
        'route_task',
        'preemptive_route_task',
        'get_cost_estimate',
        'cancel_job',
        'get_task_status',
        'cancel_task',
        'benchmark_task',
        'benchmark_tasks',
        'benchmark_model',
        'retriv_init',
      ];
      // Conditionally registered tools
      const conditionalTools = [
        { name: 'retriv_search',           condition: 'Python + retriv' },
        { name: 'benchmark_free_models',   condition: 'OPENROUTER_API_KEY' },
        { name: 'get_free_models',         condition: 'OPENROUTER_API_KEY' },
        { name: 'clear_openrouter_tracking', condition: 'OPENROUTER_API_KEY' },
        { name: 'set_model_prompting_strategy', condition: 'OPENROUTER_API_KEY' },
      ];

      assert(tools.length >= 1, `Server registers tools (got ${tools.length})`);
      for (const name of coreTools) {
        const found = tools.some(t => t.name === name);
        assert(found, `Core tool registered: ${name}`);
      }
      for (const { name, condition } of conditionalTools) {
        const found = tools.some(t => t.name === name);
        if (found) {
          ok(`Optional tool registered: ${name} (${condition} available)`);
          results.passed++;
        } else {
          info(`Optional tool absent: ${name} (requires ${condition} — expected when not configured)`);
          results.skipped++;
        }
      }
    });

    await runTest('list resources', async () => {
      const resp = await client.listResources();
      const uris = (resp.resources ?? []).map(r => r.uri);
      dim(`Resources: ${uris.join(', ')}`);
      assert(uris.length >= 1, `Server registers resources (got ${uris.length})`);
      assert(uris.includes('locallama://status'), 'Resource: locallama://status');
      assert(uris.includes('locallama://models'), 'Resource: locallama://models');
    });

    await runTest('read locallama://status', async () => {
      const resp = await client.readResource({ uri: 'locallama://status' });
      const content = resp.contents?.[0]?.text;
      dim(`Status: ${content?.substring(0, 200)}`);
      assert(!!content, 'locallama://status returns content');
      let parsed;
      try { parsed = JSON.parse(content); } catch { /* plain text ok */ }
      if (parsed) {
        assert(!!parsed.version || !!parsed.status || !!parsed.server, 'Status has expected fields');
      }
    });

    await runTest('read locallama://models', async () => {
      const resp = await client.readResource({ uri: 'locallama://models' });
      const content = resp.contents?.[0]?.text;
      dim(`Models: ${content?.substring(0, 400)}`);
      assert(!!content, 'locallama://models returns content');
      let parsed;
      try { parsed = JSON.parse(content); } catch { /* plain text ok */ }
      if (parsed) {
        const hasModels = Array.isArray(parsed) || (parsed.models && Array.isArray(parsed.models));
        assert(hasModels, 'Models resource returns an array or {models:[]}');
      }
    });

    await runTest('smoke — rootDir and artifact path placement', async () => {
      const expectedRoot = resolve(serverEnv.LOCALLAMA_ROOT_DIR || __dirname);
      const { config } = await import('./dist/config/index.js');
      const resolvedRoot = resolve(config.rootDir);

      if (process.platform === 'win32') {
        assert(resolvedRoot === expectedRoot, 'Windows rootDir resolves to project root (or LOCALLAMA_ROOT_DIR override)', `expected=${expectedRoot}, actual=${resolvedRoot}`);
      } else {
        info('Skipping Windows-only rootDir equality assertion on non-Windows platform');
        results.skipped++;
      }

      const lockPath = join(resolvedRoot, 'locallama.lock');
      const ollamaTrackingPath = join(resolvedRoot, 'ollama-models.json');
      const benchmarkDbPath = process.env.BENCHMARK_DB_PATH
        ? resolve(process.env.BENCHMARK_DB_PATH)
        : join(resolvedRoot, 'data', 'benchmarks.db');

      assert(isPathUnderRoot(lockPath, resolvedRoot), 'Lock file path is under expected root');
      assert(isPathUnderRoot(ollamaTrackingPath, resolvedRoot), 'Ollama tracking path is under expected root');
      assert(isPathUnderRoot(benchmarkDbPath, resolvedRoot), 'Benchmark DB path is under expected root');

      // lock file should exist while server process is alive during this suite
      assert(existsSync(lockPath), 'Lock file is created at expected root path');
    });
  }

  // ── 1b. Smoke: retriv_init + retriv_search (native BM25, no LLM) ─────────
  if (runSmoke) {
    hdr('Smoke: retriv_init + retriv_search (native BM25)');

    // Index the small src/config/ directory so we don't scan the whole repo.
    const configDir = join(__dirname, 'src', 'config');

    await runTest('retriv_init — index src/config/', async () => {
      const result = await client.callTool({
        name: 'retriv_init',
        arguments: {
          directories: [configDir],
          exclude_patterns: ['node_modules/**', 'dist/**'],
          force_reindex: true,
        },
      });
      const text = extractText(result);
      dim(`retriv_init response: ${text?.substring(0, 400)}`);
      assert(!!text, 'retriv_init returns content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* plain text ok */ }
      if (parsed) {
        assert(
          parsed.success === true || !!parsed.summary || !!parsed.searchReady,
          'retriv_init reports successful indexing'
        );
        if (parsed.summary) {
          info(`Indexed ${parsed.summary.totalFiles ?? '?'} files, ${parsed.summary.documentCount ?? '?'} documents`);
        }
      }
    });

    await runTest('retriv_search — query after init', async () => {
      const result = await client.callTool({
        name: 'retriv_search',
        arguments: {
          query: 'model endpoint config',
          limit: 3,
        },
      });
      const text = extractText(result);
      dim(`retriv_search response: ${text?.substring(0, 400)}`);
      assert(!!text, 'retriv_search returns content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* plain text ok */ }
      if (parsed) {
        const isArray = Array.isArray(parsed);
        const hasResults = isArray || (parsed.results && Array.isArray(parsed.results));
        assert(hasResults, 'retriv_search returns an array of results');
        const items = isArray ? parsed : parsed.results ?? [];
        if (items.length > 0) {
          info(`retriv_search found ${items.length} result(s); top score: ${items[0]?.score?.toFixed(3) ?? 'n/a'}`);
        } else {
          info('retriv_search returned 0 results (index may be empty for this query)');
        }
      }
    });
  }

  // ── 2. Routing: Lightweight tool calls (no LLM) ───────────────────────────
  if (runRouting) {
    hdr('Routing: Lightweight tool calls (no LLM)');

    await runTest('preemptive_route_task — simple task', async () => {
      const result = await client.callTool({
        name: 'preemptive_route_task',
        arguments: {
          task: 'Write a TypeScript function that reverses a string.',
          context_length: 20,
          expected_output_length: 80,
          priority: 'cost',
        },
      });
      const text = extractText(result);
      dim(`preemptive_route_task response: ${text?.substring(0, 300)}`);
      assert(!!text, 'preemptive_route_task returns content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* may be plain text */ }
      if (parsed) {
        assert(
          !!parsed.costClass || !!parsed.providerId || !!parsed.modelId || !!parsed.reason,
          'Response contains routing decision fields'
        );
        if (String(process.env.EXPECT_LOCAL_PROVIDER_DOWN || '').toLowerCase() === 'true') {
          assert(
            parsed.costClass !== 'local',
            'With EXPECT_LOCAL_PROVIDER_DOWN=true, preemptive route does not suggest a local model'
          );
        }
        info(`Routing decision: costClass=${parsed.costClass}, model=${parsed.modelId ?? parsed.providerId}`);
      }
    });

    await runTest('preemptive_route_task — complex task', async () => {
      const result = await client.callTool({
        name: 'preemptive_route_task',
        arguments: {
          task: 'Implement a complete OAuth2 authentication server with JWT tokens, refresh token rotation, and rate limiting. Include database models, REST endpoints, middleware, and unit tests.',
          context_length: 500,
          expected_output_length: 2000,
          complexity: 0.9,
          priority: 'quality',
        },
      });
      const text = extractText(result);
      dim(`Complex routing response: ${text?.substring(0, 300)}`);
      assert(!!text, 'preemptive_route_task (complex) returns content');
    });

    await runTest('preemptive_route_task — three simultaneous calls', async () => {
      const makeArgs = (index) => ({
        task: `Generate a concise helper function example #${index}.`,
        context_length: 64,
        expected_output_length: 128,
        complexity: 0.35,
        priority: 'cost',
      });

      const responses = await Promise.all([
        client.callTool({ name: 'preemptive_route_task', arguments: makeArgs(1) }),
        client.callTool({ name: 'preemptive_route_task', arguments: makeArgs(2) }),
        client.callTool({ name: 'preemptive_route_task', arguments: makeArgs(3) }),
      ]);

      assert(responses.length === 3, 'Concurrent preemptive routing returned three responses');

      for (let i = 0; i < responses.length; i++) {
        const text = extractText(responses[i]);
        assert(!!text, `Concurrent preemptive response ${i + 1} has content`);
        let parsed;
        try { parsed = JSON.parse(text); } catch { /* plain text fallback */ }
        if (parsed) {
          assert(
            !!parsed.reason || !!parsed.costClass || !!parsed.modelId || !!parsed.providerId,
            `Concurrent preemptive response ${i + 1} has routing fields`,
          );
        }
      }
    });

    await runTest('get_cost_estimate', async () => {
      const result = await client.callTool({
        name: 'get_cost_estimate',
        arguments: {
          context_length: 50,
          expected_output_length: 100,
          model: 'gemma3n:e2b',
        },
      });
      const text = extractText(result);
      dim(`Cost estimate response: ${text?.substring(0, 300)}`);
      assert(!!text, 'get_cost_estimate returns content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* may be plain text */ }
      if (parsed) {
        // Response shape: {local:{cost:{input,output,total},...}, paid:{cost:{...},...}}
        // OR flat shape:  {estimatedCost, cost, totalCost}
        const hasCost =
          'estimatedCost' in parsed ||
          'cost' in parsed ||
          'totalCost' in parsed ||
          ('local' in parsed && parsed.local?.cost) ||
          ('paid'  in parsed && parsed.paid?.cost);
        assert(hasCost, 'Cost estimate contains a cost field');
        const localCost = parsed.local?.cost?.total ?? parsed.local?.cost?.input ?? '?';
        const paidCost  = parsed.paid?.cost?.total ?? parsed.estimatedCost ?? '?';
        info(`Cost estimate — local: $${localCost}  paid: $${paidCost}`);
      }
    });

    await runTest('route_task — oversized prompt returns context_overflow', async () => {
      const { countTokens } = await import('./dist/modules/utils/tokenCount.js');
      const modelsResp = await client.readResource({ uri: 'locallama://models' });
      const modelsText = modelsResp.contents?.[0]?.text;
      let maxContextWindow = 256000;
      try {
        const parsedModels = JSON.parse(modelsText);
        const models = Array.isArray(parsedModels) ? parsedModels : parsedModels.models ?? [];
        const windows = models
          .map((model) => Number(model.contextWindow ?? model.capabilities?.contextWindow))
          .filter((value) => Number.isFinite(value) && value > 0);
        if (windows.length > 0) maxContextWindow = Math.max(...windows);
      } catch { /* keep conservative fallback */ }

      const oversizedPrompt = [
        'Return the word overflow after reading this intentionally oversized prompt.',
        'token '.repeat(maxContextWindow + 1000),
      ].join('\n');
      assert(
        countTokens(oversizedPrompt) > maxContextWindow,
        'Test prompt is longer than the largest declared model context window'
      );

      const result = await client.callTool(
        {
          name: 'route_task',
          arguments: {
            task: oversizedPrompt,
            context_length: 100,
            expected_output_length: 10,
            complexity: 0.1,
            priority: 'cost',
          },
        },
        undefined,
        { timeout: 60_000 }
      );

      const text = extractText(result);
      dim(`context_overflow response: ${text?.substring(0, 300)}`);
      assert(!!text, 'route_task oversized prompt returns content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* fail below */ }
      assert(parsed?.error === 'context_overflow', 'Oversized prompt returns context_overflow error');
      assert(Number.isFinite(parsed?.estimatedTokens), 'context_overflow includes estimatedTokens');
      assert(Number.isFinite(parsed?.modelContextWindow), 'context_overflow includes modelContextWindow');
      assert(parsed.estimatedTokens > parsed.modelContextWindow, 'estimatedTokens exceeds modelContextWindow');
    });

    await runTest('[mock][F-1] OpenRouter quarantined free model is skipped and healthy fallback remains selectable', async () => {
      const previousApiKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = previousApiKey || serverEnv.OPENROUTER_API_KEY || 'test-operational-key';

      try {
        const { openRouterModule } = await import('./dist/modules/openrouter/index.js');

        const nowIso = new Date().toISOString();
        const futureIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        openRouterModule.modelTracking = {
          lastUpdated: nowIso,
          freeModels: ['bad/free-model', 'good/free-model'],
          freeModelHealth: {
            'bad/free-model': {
              consecutiveFailures: 2,
              lastErrorType: 'invalid_request',
              lastFailureAt: nowIso,
              quarantinedUntil: futureIso,
            },
          },
          models: {
            'bad/free-model': {
              id: 'bad/free-model',
              name: 'Bad Free Model',
              provider: 'openrouter',
              isFree: true,
              contextWindow: 8192,
              capabilities: { chat: true, completion: true, vision: false },
              costPerToken: { prompt: 0, completion: 0 },
              lastUpdated: nowIso,
            },
            'good/free-model': {
              id: 'good/free-model',
              name: 'Good Free Model',
              provider: 'openrouter',
              isFree: true,
              contextWindow: 8192,
              capabilities: { chat: true, completion: true, vision: false },
              costPerToken: { prompt: 0, completion: 0 },
              lastUpdated: nowIso,
            },
          },
        };

        const freeModels = await openRouterModule.getFreeModels(false);
        const freeModelIds = freeModels.map((model) => model.id);

        assert(!freeModelIds.includes('bad/free-model'), '[mock][F-1] quarantined free model is excluded from eligible OpenRouter models');
        assert(freeModelIds[0] === 'good/free-model', '[mock][F-1] healthy free model remains the selected fallback candidate');
      } finally {
        if (previousApiKey === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = previousApiKey;
        }
      }
    });

    await runTest('[mock][F-5] OpenRouter quarantine expiry re-admits the model', async () => {
      const previousApiKey = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = previousApiKey || serverEnv.OPENROUTER_API_KEY || 'test-operational-key';

      try {
        const { openRouterModule } = await import('./dist/modules/openrouter/index.js');

        const nowIso = new Date().toISOString();
        const expiredIso = new Date(Date.now() - 60_000).toISOString();
        openRouterModule.modelTracking = {
          lastUpdated: nowIso,
          freeModels: ['expired/free-model', 'healthy/free-model'],
          freeModelHealth: {
            'expired/free-model': {
              consecutiveFailures: 2,
              lastErrorType: 'invalid_request',
              lastFailureAt: nowIso,
              quarantinedUntil: expiredIso,
            },
          },
          models: {
            'expired/free-model': {
              id: 'expired/free-model',
              name: 'Expired Free Model',
              provider: 'openrouter',
              isFree: true,
              contextWindow: 8192,
              capabilities: { chat: true, completion: true, vision: false },
              costPerToken: { prompt: 0, completion: 0 },
              lastUpdated: nowIso,
            },
            'healthy/free-model': {
              id: 'healthy/free-model',
              name: 'Healthy Free Model',
              provider: 'openrouter',
              isFree: true,
              contextWindow: 8192,
              capabilities: { chat: true, completion: true, vision: false },
              costPerToken: { prompt: 0, completion: 0 },
              lastUpdated: nowIso,
            },
          },
        };

        const freeModels = await openRouterModule.getFreeModels(false);
        const freeModelIds = freeModels.map((model) => model.id);

        assert(openRouterModule.isModelQuarantined('expired/free-model') === false, '[mock][F-5] quarantine-expired model is no longer flagged as quarantined');
        assert(freeModelIds.includes('expired/free-model'), '[mock][F-5] quarantine-expired model re-enters the free-model pool');
      } finally {
        if (previousApiKey === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = previousApiKey;
        }
      }
    });

    await runTest('[mock][F-4] circuit-open Ollama fallback routes to LM Studio', async () => {
      const { ProviderRegistry, _setProviderRegistryForTests } = await import('./dist/modules/core/provider/index.js');
      const { ModelRegistry, _setModelRegistryForTests } = await import('./dist/modules/core/model/index.js');
      const { TaskExecutor } = await import('./dist/modules/api-integration/task-execution/index.js');

      const makeProvider = (id, costClass, modelIds, content) => ({
        id,
        displayName: id,
        costClass,
        isLocal: costClass === 'local',
        init: async () => {},
        isAvailable: async () => true,
        listModels: async () => modelIds.map((modelId) => ({ id: modelId })),
        supportsModel: async (modelId) => modelIds.includes(modelId),
        executeTask: async () => ({ content, model: id }),
        getCost: () => ({ prompt: 0, completion: 0 }),
      });

      const registry = new ProviderRegistry();
      const ollamaProvider = makeProvider('ollama', 'local', ['shared-local-model'], 'result-from-ollama');
      const lmStudioProvider = makeProvider('lm-studio', 'local', ['shared-local-model'], 'result-from-lm-studio');

      registry.register(ollamaProvider);
      registry.register(lmStudioProvider);
      registry.recordProviderFailure('ollama');
      registry.recordProviderFailure('ollama');
      registry.recordProviderFailure('ollama');
      _setProviderRegistryForTests(registry);

      const modelRegistry = new ModelRegistry();
      modelRegistry.registerModel({
        id: 'shared-local-model',
        providerId: 'ollama',
        displayName: 'Shared Local Model',
        contextWindow: 8192,
        capabilities: { chat: true, code: true, vision: false, toolUse: false, largeContext: false, maxContextTokens: 8192 },
        cost: { prompt: 0, completion: 0 },
        promptingStrategyId: 'default',
      });
      _setModelRegistryForTests(modelRegistry);

      try {
        const executor = new TaskExecutor();
        const result = await executor.executeTask('shared-local-model', 'hello', 'job-routing-failover');

        assert(result === 'result-from-lm-studio', '[mock][F-4] local fallback returns LM Studio result when Ollama circuit is open');
        assert(registry.isAvailable('ollama') === false, '[mock][F-4] Ollama circuit is open during fallback probe');
      } finally {
        _setProviderRegistryForTests(undefined);
        _setModelRegistryForTests(undefined);
      }
    });

    await runTest('[mock][F-2a] cross-provider handoff triggers releaseResources on previous local runtime', async () => {
      const {
        ProviderRegistry,
        _setProviderRegistryForTests,
        localProviderLifecycle,
        _resetLocalProviderLifecycleForTests,
      } = await import('./dist/modules/core/provider/index.js');

      _resetLocalProviderLifecycleForTests();

      const unloadCalls = [];
      const makeLocalProvider = (id) => ({
        id,
        displayName: id,
        costClass: 'local',
        isLocal: true,
        init: async () => {},
        isAvailable: async () => true,
        listModels: async () => [],
        supportsModel: () => true,
        executeTask: async () => ({ content: 'ok', model: id }),
        releaseResources: async (opts) => { unloadCalls.push({ id, opts }); },
        getCost: () => ({ prompt: 0, completion: 0 }),
      });

      const registry = new ProviderRegistry();
      const ollama = makeLocalProvider('ollama');
      const lmStudio = makeLocalProvider('lm-studio');
      registry.register(ollama);
      registry.register(lmStudio);
      _setProviderRegistryForTests(registry);

      try {
        // First execution on Ollama with model A
        await localProviderLifecycle.beforeExecution(ollama, 'qwen2.5-coder:7b');
        assert(unloadCalls.length === 0, '[mock][F-2a] no unload before any cross-provider switch');

        // Switch to LM Studio — should trigger Ollama unload
        await localProviderLifecycle.beforeExecution(lmStudio, 'google/gemma-4');
        assert(unloadCalls.length === 1, '[mock][F-2a] exactly one releaseResources call after cross-provider switch');
        assert(unloadCalls[0].id === 'ollama', '[mock][F-2a] releaseResources called on the previous provider (ollama)');
        assert(unloadCalls[0].opts?.reason === 'cross-provider-handoff', '[mock][F-2a] releaseResources called with cross-provider-handoff reason');
        assert(unloadCalls[0].opts?.modelId === 'qwen2.5-coder:7b', '[mock][F-2a] releaseResources passes the previously loaded model ID');
      } finally {
        _resetLocalProviderLifecycleForTests();
        _setProviderRegistryForTests(undefined);
      }
    });

    await runTest('[mock][F-2b] same-provider reuse does NOT trigger releaseResources', async () => {
      const {
        ProviderRegistry,
        _setProviderRegistryForTests,
        localProviderLifecycle,
        _resetLocalProviderLifecycleForTests,
      } = await import('./dist/modules/core/provider/index.js');

      _resetLocalProviderLifecycleForTests();

      const unloadCalls = [];
      const ollama = {
        id: 'ollama',
        displayName: 'ollama',
        costClass: 'local',
        isLocal: true,
        init: async () => {},
        isAvailable: async () => true,
        listModels: async () => [],
        supportsModel: () => true,
        executeTask: async () => ({ content: 'ok', model: 'ollama' }),
        releaseResources: async (opts) => { unloadCalls.push(opts); },
        getCost: () => ({ prompt: 0, completion: 0 }),
      };

      const registry = new ProviderRegistry();
      registry.register(ollama);
      _setProviderRegistryForTests(registry);

      try {
        await localProviderLifecycle.beforeExecution(ollama, 'model-a');
        await localProviderLifecycle.beforeExecution(ollama, 'model-b');
        await localProviderLifecycle.beforeExecution(ollama, 'model-c');
        assert(unloadCalls.length === 0, '[mock][F-2b] same-provider reuse across 3 model switches triggers zero releaseResources calls — no VRAM accumulation signal');
      } finally {
        _resetLocalProviderLifecycleForTests();
        _setProviderRegistryForTests(undefined);
      }
    });

    await runTest('[mock][F-2c] multiple cross-provider switches each unload exactly the previous local runtime', async () => {
      const {
        ProviderRegistry,
        _setProviderRegistryForTests,
        localProviderLifecycle,
        _resetLocalProviderLifecycleForTests,
      } = await import('./dist/modules/core/provider/index.js');

      _resetLocalProviderLifecycleForTests();

      const unloadLog = [];
      const makeLocalProvider = (id) => ({
        id,
        displayName: id,
        costClass: 'local',
        isLocal: true,
        init: async () => {},
        isAvailable: async () => true,
        listModels: async () => [],
        supportsModel: () => true,
        executeTask: async () => ({ content: 'ok', model: id }),
        releaseResources: async (opts) => { unloadLog.push({ providerId: id, modelId: opts?.modelId }); },
        getCost: () => ({ prompt: 0, completion: 0 }),
      });

      const registry = new ProviderRegistry();
      const ollama = makeLocalProvider('ollama');
      const lmStudio = makeLocalProvider('lm-studio');
      registry.register(ollama);
      registry.register(lmStudio);
      _setProviderRegistryForTests(registry);

      try {
        // ollama → lmStudio → ollama → lmStudio: 3 switches, 3 unloads
        await localProviderLifecycle.beforeExecution(ollama, 'model-A');
        await localProviderLifecycle.beforeExecution(lmStudio, 'model-B');
        await localProviderLifecycle.beforeExecution(ollama, 'model-C');
        await localProviderLifecycle.beforeExecution(lmStudio, 'model-D');

        assert(unloadLog.length === 3, '[mock][F-2c] exactly 3 unloads for 3 cross-provider switches — no accumulation');
        assert(unloadLog[0].providerId === 'ollama' && unloadLog[0].modelId === 'model-A', '[mock][F-2c] first unload: ollama:model-A');
        assert(unloadLog[1].providerId === 'lm-studio' && unloadLog[1].modelId === 'model-B', '[mock][F-2c] second unload: lm-studio:model-B');
        assert(unloadLog[2].providerId === 'ollama' && unloadLog[2].modelId === 'model-C', '[mock][F-2c] third unload: ollama:model-C');
      } finally {
        _resetLocalProviderLifecycleForTests();
        _setProviderRegistryForTests(undefined);
      }
    });

  }

  // ── 3. LLM: Real model calls via Ollama ───────────────────────────────────
  if (runLLM) {
    hdr('LLM: Real model calls via Ollama (may be slow)');
    info('Using model: gemma3n:e2b (5.6GB — smallest available)');

    await runTest('route_task — tiny prompt queues and can be polled', async () => {
      const result = await client.callTool(
        {
          name: 'route_task',
          arguments: {
            task: 'Write a JavaScript function named `add` that takes two numbers and returns their sum. Include a JSDoc comment.',
            context_length: 30,
            expected_output_length: 150,
            priority: 'cost',
          },
        },
        undefined,      // resultSchema — use default
        { timeout: 180_000 }  // 3-minute timeout for LLM inference
      );
      const text = extractText(result);
      dim(`route_task response (first 500 chars): ${text?.substring(0, 500)}`);
      assert(!!text, 'route_task returns queued task content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* plain text */ }
      assert(!!parsed?.task_id, 'route_task returns task_id immediately');
      assert(parsed?.status === 'queued', 'route_task initial status is queued');
      assert(Number.isFinite(parsed?.poll_again_after_ms), 'route_task includes poll_again_after_ms');
      assert(!!parsed?.provider && !!parsed?.model, 'route_task identifies queued provider and model');

      let statusPayload = null;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const statusResult = await client.callTool({
          name: 'get_task_status',
          arguments: { task_id: parsed.task_id },
        });
        const statusText = extractText(statusResult);
        statusPayload = JSON.parse(statusText);
        dim(`get_task_status response: ${statusText?.substring(0, 500)}`);
        assert(statusPayload.task_id === parsed.task_id, 'get_task_status returns matching task_id');
        if (['completed', 'failed', 'partially_failed', 'cancelled'].includes(statusPayload.status)) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(statusPayload.poll_again_after_ms ?? 5000, 5000)));
      }

      assert(statusPayload?.status === 'completed', 'Task reaches completed status');
      const completedJob = statusPayload.jobs?.find((job) => job.status === 'completed');
      assert(!!completedJob?.result, 'Completed task exposes job result inline');
      assert(
        completedJob.result.includes('function') || completedJob.result.includes('add') || completedJob.result.includes('=>'),
        'Completed task result looks like JavaScript code',
      );
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractText(toolResult) {
  if (!toolResult) return null;
  const content = toolResult.content ?? [];
  if (Array.isArray(content)) {
    const textBlock = content.find(b => b.type === 'text');
    return textBlock?.text ?? null;
  }
  return typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
}

main().catch(e => {
  console.error(`\n${C.red}Fatal error:${C.reset}`, e);
  process.exit(1);
});
