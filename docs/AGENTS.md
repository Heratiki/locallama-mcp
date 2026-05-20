# AGENTS.md

This file is the shared operating guide for Codex, Claude Code, Claw Code, Cursor, Copilot Agent mode, and any other coding agent working in this repository.

## Project Direction

LocalLama MCP is being revived as a local-first, provider-neutral MCP server for coding-agent workflows. The goal is no longer to target Cline or Roo Code specifically. The server should help modern agents route coding work across local models, free/low-cost remote models, and paid frontier models using measured cost, latency, quality, context capacity, and task fit.

Use `docs/PLAN.md` for the `future-testing` implementation plan, `docs/OPERATIONAL_TEST_PLAN.md` for live verification, and `docs/PROJECT_STATE.md` for the current snapshot. Keep `docs/ROADMAP.md` as long-form background.

## Shared Memory

This repo uses `docs/history/memory-bank/` as append-only historical project memory, not as the active source of truth. Before planning non-trivial work, read:

- `docs/PROJECT_STATE.md`
- `docs/PLAN.md`
- `docs/OPERATIONAL_TEST_PLAN.md`
- `docs/history/memory-bank/README.md` for historical context conventions

After meaningful work, append or update memory with:

- What changed
- Why it changed
- Verification performed
- Known follow-ups or blockers

Do not rewrite another contributor's historical notes unless the user explicitly asks. Add dated entries instead.

Do not store secrets, API keys, private prompts, or sensitive logs in tracked docs or memory files.

## Development Commands

### Build and Run

- `npm run build` - Compile TypeScript to JavaScript and copy `lock-file.js` to `dist/`
- `npm start` - Start the MCP server after building
- `npm run dev` - Development mode with TypeScript watching and auto-restart

`npm run build` now succeeds on native Windows because the package script uses a Node copy step. `npx tsc --project tsconfig.json --noEmit` currently type-checks successfully.

### Testing

- `npm test` - Run all tests
- `npm test:watch` - Run tests in watch mode
- Tests live in `test/` and mirror `src/`
- The test scripts are OS-agnostic: they invoke Jest through `node --experimental-vm-modules ./node_modules/jest/bin/jest.js` instead of shell-specific environment-variable syntax.

### Code Quality

- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Run ESLint with auto-fix

Current known issue: lint references `eslint-plugin-import`, which is not installed.

### Benchmarking

- `npm run benchmark` - Intended basic benchmark command
- `npm run benchmark:comprehensive` - Intended comprehensive benchmark command

Current benchmark scripts now run the root `run-benchmarks.js` CLI after building the project.

## Architecture Overview

The project is a TypeScript ESM MCP server built around these areas:

- `src/index.ts` - MCP server entry point, process lifecycle, lock-file handling, tool routing
- `src/modules/api-integration/` - MCP tool definitions, resources, routing adapters, OpenRouter integration
- `src/modules/decision-engine/` - task analysis, model selection, task coordination, code evaluation
- `src/modules/cost-monitor/` - token accounting, cost estimation, code search/cache helpers
- `src/modules/benchmark/` - benchmark execution, scoring, summaries, storage
- `src/modules/lm-studio/`, `src/modules/ollama/`, `src/modules/openrouter/` - provider integrations

### Decision engine: two model data stores
`ModelRegistry` + `CapabilityDetector` is canonical for benchmark-derived capability scores — written by `benchmark_model`, read by `taskRouter` and `codeModelSelector` (full routing path). `modelsDbService` holds heuristic performance data — seeded from `ModelRegistry` at startup via `seedModelRegistry()`, but the reverse path (`benchmark_model` → `modelsDb`) does not exist. `preemptiveRouting()` reads `modelsDb` via `getBestLocalModel()`, not `CapabilityDetector`. See issue #49.

## Modernization Priorities

1. Restore reliable local development: cross-platform build, lint dependencies, tests, benchmark entrypoints.
2. Make MCP responses and schemas match current MCP expectations, including structured tool content where appropriate.
3. Replace simulated paid benchmarks with real provider adapters behind a common interface.
4. Replace stale hardcoded model fallbacks with discovered capabilities and benchmark history.
5. Move prompt understanding toward structured output and validated parsing.
6. Update docs and examples for current agent clients: Codex, Claude Code, Claw Code, Cursor, Copilot Agent mode, and generic MCP clients.

## Coding Guidelines

- Prefer existing module boundaries and patterns before adding new abstractions.
- Keep changes scoped. Do not refactor unrelated code while fixing docs or one subsystem.
- Use TypeScript types for contracts between routing, benchmarking, and provider modules.
- Prefer structured parsing over regex when model output is expected to be machine-readable.
- Keep provider-specific logic behind provider modules; do not scatter model-name checks through the decision engine.
- For benchmark changes, prefer executable scoring: apply patches, run tests, and record results. Heuristic quality scoring should be secondary metadata, not the main pass/fail signal.

## Safety

- Treat MCP tools as model-controlled surfaces. Avoid adding tools that mutate files, run commands, or call paid APIs without clear user/client approval paths.
- Do not commit API keys, local model inventories with secrets, logs containing tokens, or private benchmark outputs.
- Be careful with `docs/history/memory-bank/`: it is historical project context, not a scratchpad for secrets.

## Code Search Dependencies

Retriv code search is implemented with the native TypeScript BM25 engine and has no Python runtime dependency.

## Agent skills

### Issue tracker

Issues tracked in GitHub Issues (`Heratiki/locallama-mcp`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

### CLI Tool: chat.ts

The `chat.ts` script is a command-line interface for interacting with the LocalLlama MCP server. It provides advanced users and developers with direct access to server functionalities, such as task routing and resource management.

#### Key Commands
- `route-task <task> <contextLength>`: Routes a task with specific parameters.
- `list-resources`: Lists available resources from the server.
- `exit`: Gracefully exits the CLI tool.

Refer to the [README.md](../README.md) for detailed usage instructions.
