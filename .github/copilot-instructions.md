# LocalLlama MCP Copilot Instructions

Use these repository-wide rules together with path-specific instruction files in .github/instructions.

## Core Priorities

- Prefer minimal, focused changes over broad refactors.
- Preserve existing project style and naming conventions.
- Keep TypeScript MCP server changes aligned with current SDK patterns.
- Update docs whenever behavior, configuration, commands, or interfaces change.

## Path-Specific Instruction Routing

- For TypeScript/JavaScript and package metadata work, follow:
  - .github/instructions/typescript-mcp-server.instructions.md
- For shell script changes (.sh), follow:
  - .github/instructions/shell.instructions.md
- For PowerShell script changes (.ps1, .psm1), follow:
  - .github/instructions/powershell.instructions.md
- For markdown and code changes that affect usage, setup, API, or behavior, follow:
  - .github/instructions/update-docs-on-code-change.instructions.md

## Expected Workflow

- Validate assumptions by reading nearby code before editing.
- Keep edits small and testable.
- If code behavior changes, update README.md and relevant docs in the same change.
- Mention any residual risks or follow-up validation needed when finishing a task.
