# Active Context

Last updated: 2026-04-24

## Current Focus

The project is being revived and repositioned away from Cline/Roo-specific usage. The new direction is a local-first, provider-neutral MCP server for modern coding agents such as Codex, Claude Code, Claw Code, Cursor, GitHub Copilot Agent mode, and generic MCP clients.

The current workstream is documentation and shared project memory. `docs/ROADMAP.md` is now the modernization source of truth.

## Baseline Findings

- `npx tsc --project tsconfig.json --noEmit` succeeds.
- `npm run build` fails on native Windows after TypeScript compilation because the script uses Unix `cp`.
- `npm run lint` fails because `eslint-plugin-import` is referenced by `eslint.config.js` but is not installed.
- `npm run benchmark` and `npm run benchmark:comprehensive` reference missing `run-benchmarks.js`.
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
