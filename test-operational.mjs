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
import { dirname, join } from 'path';
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
    await runSuite(client);
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

async function runSuite(client) {
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
  }

  // ── 3. LLM: Real model calls via Ollama ───────────────────────────────────
  if (runLLM) {
    hdr('LLM: Real model calls via Ollama (may be slow)');
    info('Using model: gemma3n:e2b (5.6GB — smallest available)');

    await runTest('route_task — tiny prompt via Ollama', async () => {
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
      assert(!!text, 'route_task returns content');

      let parsed;
      try { parsed = JSON.parse(text); } catch { /* plain text */ }
      if (parsed) {
        assert(!!parsed.code || !!parsed.result || !!parsed.content, 'Response contains code or result');
        assert(!!parsed.modelUsed || !!parsed.provider || !!parsed.costClass, 'Response identifies which model was used');
        if (parsed.modelUsed) info(`Model used: ${parsed.modelUsed}`);
        if (parsed.costClass) info(`Cost class: ${parsed.costClass}`);
      } else {
        // Plain text response: just verify it looks like code
        assert(
          text.includes('function') || text.includes('add') || text.includes('=>'),
          'Plain text response looks like JavaScript code'
        );
      }
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
