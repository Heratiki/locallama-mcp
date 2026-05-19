# LocalLama MCP Revival Roadmap

Last updated: 2026-04-24

## Purpose

LocalLama MCP is being revived as a local-first, provider-neutral MCP server for modern coding agents. The project should help agents choose between local models, free or low-cost remote models, and paid frontier models using measured task fit, cost, latency, context capacity, reliability, and benchmark history.

The project should support current MCP-capable tools such as Codex, Claude Code, Claw Code, Cursor, GitHub Copilot Agent mode, and generic MCP clients. It should not be designed around Cline or Roo Code as primary clients.

## Current Baseline

- TypeScript source type-checks with `npx tsc --project tsconfig.json --noEmit`.
- `npm run build` fails on native Windows after TypeScript compilation because it uses Unix `cp`.
- `npm run lint` fails because `eslint-plugin-import` is referenced but not installed.
- `npm run benchmark` and `npm run benchmark:comprehensive` reference missing `run-benchmarks.js`.
- Tool definitions include duplication and some stale descriptions.
- Benchmarking still contains simulated paid-model paths.
- Routing still relies on hardcoded model-name heuristics and stale fallback models.
- Documentation still contains old Cline/Roo positioning in several places.

## Roadmap

### Phase 0: Documentation and Shared Memory

Status: in progress

- Update `AGENTS.md` as the primary agent-neutral operating guide.
- Keep `CLAUDE.md` as a thin Claude Code pointer to shared docs.
- Add a multi-author memory convention under `memory-bank/`.
- Add this roadmap as the implementation source of truth.
- Update README positioning away from Cline/Roo-specific language.

Exit criteria:

- A new contributor can identify current goals, known broken commands, and where to leave project state.

### Phase 1: Restore Developer Workflow

Status: pending

- Make `npm run build` cross-platform by replacing `cp` with a Node script or `cpy`-style package.
- Fix lint by installing `eslint-plugin-import` or removing the unused import rule.
- Restore or remove benchmark npm scripts so package commands are truthful.
- Run `npm test` after build script repair.
- Document any environment-specific requirements for Windows, WSL, macOS, and Linux.

Exit criteria:

- `npm run build`, `npm run lint`, and `npm test` complete or fail only for documented external-service reasons.

### Phase 2: MCP Surface Modernization

Status: pending

- Audit tool result shapes against current MCP content expectations.
- Remove duplicate tool definitions in `api-integration/tool-definition`.
- Add clearer tool descriptions for model-controlled agent use.
- Split read-only tools from tools that execute work, cancel jobs, mutate benchmark state, or call paid APIs.
- Consider optional Streamable HTTP transport while preserving stdio.
- Add client setup examples for Codex, Claude Code, Cursor, Copilot Agent mode, and generic MCP clients.

Exit criteria:

- MCP tool discovery is concise, client-neutral, and safe for modern agents.

### Phase 3: Provider Abstraction

Status: pending

- Define one provider interface for model listing, chat/completion calls, token usage, pricing, and capability metadata.
- Implement adapters for LM Studio, Ollama, OpenRouter, and at least one direct paid provider.
- Keep provider-specific quirks inside provider modules.
- Replace hardcoded stale fallback models with configured defaults and discovered capabilities.
- Track model metadata: context window, cost, tool support, structured output support, reasoning controls, latency, throughput, and local resource cost where available.

Exit criteria:

- Routing and benchmarking consume a common provider contract instead of scattered provider checks.

### Phase 4: Benchmarking Rebuild

Status: pending

- Replace simulated paid benchmarks with real provider calls or explicitly labeled dry-run mode.
- Make benchmark results reproducible and structured.
- Add benchmark suites by task class:
  - Simple function/code generation
  - Multi-file code editing
  - Bug fix with tests
  - Refactor with behavior preservation
  - Documentation and explanation
- Prefer executable scoring over text heuristics: apply diffs, run tests, and record pass/fail.
- Keep heuristic quality scores as supplemental metadata only.
- Add cost and latency reporting per successful task.

Exit criteria:

- Benchmark output can be trusted by the decision engine for model routing.

### Phase 5: Task Understanding and Routing

Status: pending

- Replace regex-heavy prompt parsing with validated structured outputs where supported.
- Add task classification fields: task type, risk level, expected artifact, relevant files, test strategy, context needs, latency tolerance, and cost ceiling.
- Route based on measured performance and capabilities before model-name heuristics.
- Add cold-start routing rules for unknown models.
- Track routing decisions and outcomes for later calibration.

Exit criteria:

- The decision engine can explain why a model was selected using current evidence, not just hardcoded names.

### Phase 6: Documentation, Examples, and Release Prep

Status: pending

- Rewrite README into a current quickstart plus architecture overview.
- Add `docs/CONFIGURATION.md`, `docs/MCP_CLIENTS.md`, and `docs/BENCHMARKING.md` if the README grows too large.
- Update `.env.example` with current provider and benchmark settings.
- Add troubleshooting for local model servers, OpenRouter failures, Python/Retriv setup, and lock-file issues.
- Decide whether old Roo-specific files should remain, be archived, or be removed.

Exit criteria:

- A user can install, configure, run, benchmark, and connect the MCP server from current docs.

## Open Design Decisions

- Whether to keep Retriv or move code search toward a simpler built-in index plus optional semantic backends.
- Whether to support only stdio initially or add Streamable HTTP during MCP modernization.
- Which direct paid provider should be implemented first.
- How much benchmark data should be committed versus treated as local generated output.
- Whether old `.roomodes` and `.rooignore` files are useful historical artifacts or should be removed.

## Working Agreement

- Keep `AGENTS.md` and this roadmap aligned when project direction changes.
- Append meaningful decisions to `memory-bank/decisionLog.md`.
- Update `memory-bank/progress.md` when finishing a roadmap item.
- Update `memory-bank/activeContext.md` when the current focus changes.
