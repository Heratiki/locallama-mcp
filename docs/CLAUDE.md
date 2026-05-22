# CLAUDE.md

Claude Code should use `docs/AGENTS.md` as the primary project guide.

Before starting non-trivial work, read:

- `docs/AGENTS.md`
- `docs/ROADMAP.md`
- `docs/PROJECT_STATE.md`
- `docs/PLAN.md`
- `docs/OPERATIONAL_TEST_PLAN.md`
- `docs/history/memory-bank/README.md`

When configuring this MCP server for Claude Code, prefer project-scoped MCP config when sharing with collaborators and keep secrets in environment variables. Append historical notes to `docs/history/memory-bank/` rather than replacing prior contributor context.

## MCP Server (locallama-dev)

Configured in `.claude/settings.json` (project-scoped). Not in global `~/.claude/settings.json` or Claude Desktop config.

If `locallama-dev` is missing from `/mcp`: check for stale lock file at `C:\Users\herat\locallama-dev\locallama.lock`. Delete it, then restart Claude Code. Stale locks are left by ungraceful process kills (crash, SIGKILL, `timeout` commands).

## Windows Environment

Shell is PowerShell. Use PowerShell tool, not Bash tool, for all shell commands. Use Windows paths (`C:\...`), not Unix paths (`/c/...`).
