# Active Context

Last updated: 2026-04-24

## Current Focus

This file is historical context, not the active source of truth. The current branch snapshot lives in `docs/PROJECT_STATE.md`, with `PLAN.md` and `OPERATIONAL_TEST_PLAN.md` carrying implementation and verification authority for `future-testing`.

The project is being revived and repositioned away from Cline/Roo-specific usage. The new direction is a local-first, provider-neutral MCP server for modern coding agents such as Codex, Claude Code, Claw Code, Cursor, GitHub Copilot Agent mode, and generic MCP clients.

The current workstream is documentation and shared project memory.

## Baseline Findings

- `npx tsc --project tsconfig.json --noEmit` succeeds.
- `npm run build` now succeeds on native Windows after TypeScript compilation because the script uses a Node copy step.
- `npm run lint` fails because `eslint-plugin-import` is referenced by `eslint.config.js` but is not installed.
- `npm run benchmark` and `npm run benchmark:comprehensive` now use the root benchmark CLI after build.
- Benchmarks are configured by model discovery in the server path, with optional CLI filtering via `benchmark-models.json` in the root runner.
- Benchmarking still includes simulated paid-model paths.
- Routing still includes stale hardcoded model fallbacks and model-name heuristics.
- README opening and MCP client setup sections now use current agent-neutral positioning.

## Current Goals

- Finish documentation refresh.
- Repair the local developer workflow.
- Modernize MCP tool definitions and result shapes.
- Rebuild provider and benchmark layers around real provider adapters and executable scoring.
- Move routing from hardcoded model names toward discovered capabilities and benchmark history.

## Open Questions

- Should the project keep Retriv as the main code search backend, or make it optional behind a simpler built-in index?
- Should Streamable HTTP support be added during the MCP modernization phase or after stdio is cleaned up?
- Which direct paid provider should be implemented first alongside OpenRouter?
- Should old Roo-specific files such as `.roomodes` and `.rooignore` be archived or removed?
- How much generated benchmark data should stay in the repository?
