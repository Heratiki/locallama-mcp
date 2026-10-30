# CLAUDE.md

Primary Claude guidance is now in `docs/CLAUDE.md`.

This root file is kept as a compatibility shim for tools that auto-discover `CLAUDE.md` at repository root.

**New here?** Start with [`wiki/README.md`](wiki/README.md) — the agent-facing system map.

## Lanes and Subagents (set up 2026-10-29)

Work in this repo goes through lanes. The main session is the
**orchestrator**: it plans, writes briefs, routes, verifies, merges and
reports. It edits only orchestration material itself: `CLAUDE.md`,
`.claude/agents/*.md`, `.claude/skills/**`, `docs/agents/**`, memory and the
handoff (`docs/HANDOFF.md`). The method: `~/.claude/multi-lane-orchestration.md`.

### Agents

The general agents live in `~/.claude/agents/`; a file of the same name in
this repo's `.claude/agents/` wins.

| Agent | Model | Does | Never does |
|---|---|---|---|
| `lane-dev` | Sonnet (Opus on the call for an issue with design inside) | Builds one GitHub issue in its own worktree; runs the static gates; commits with `Refs #<N>` | Runs the test harness; pushes; merges |
| `ticket-writer` | Sonnet, low | Writes a GitHub issue body (acceptance criteria, owned paths, rulings), ADR text when asked; never a `docs/tickets/` file | Invents a ruling; edits code |
| `lane-verifier` | Sonnet, low | Checks one lane branch against main and its GitHub issue; PASS or FAIL | Edits, merges or commits |
| `suite-verifier` | Sonnet, low | The only agent that runs the test harness; faithful counts and causes | Fixes a failure; re-runs to make it pass |

Every Agent call names `model`. A new or changed agent file loads only after
the session reloads its agents; until then, launch `general-purpose` with the
file's text in the brief.

### Rules

- **unlazy in every lane.** Each lane loads `unlazy`, writes
  `.unlazy/<lane>/GATES.md` (one gate per acceptance criterion and ruling)
  before it works, and reports only at ALL MET or explicit ABANDONs. The
  Stop/SubagentStop hook in `.claude/settings.local.json` holds a lane with
  unmet gates; lane-verifier re-runs the ledger.
- **One worktree per code lane, disjoint paths.** `isolation: "worktree"` on
  the Agent call, or `scripts/lane-worktree.sh add <name>` for a codex/agy lane.
  Never install dependencies inside a worktree. The main tree belongs to the
  orchestrator. Every brief lists the paths the lane owns; concurrent lanes
  own disjoint paths; a shared file changes in wave order.
- **Design questions go to the maintainer** (AskUserQuestion, 1-2 per round,
  recommended option first), never to a lane. With the maintainer away,
  decisions go in `docs/agents/decisions-YYYY-MM-DD.md` with a revert note.
- **Work items are GitHub issues** (`docs/agents/issue-tracker.md`), not
  `docs/tickets/` files. One lane branch (`lane/issue-<N>`) and one PR per
  issue; the PR body says `Closes #<N>`. Every brief carries the issue number
  and the text of `gh issue view <N> --comments`. The global agents name
  `docs/tickets/`; in this repo, read "ticket" as "GitHub issue".
  Queue: `docs/agents/work-ledger.md`. Models:
  `docs/agents/model-register.md`. External lanes: docs/agents/external-lanes.md.

### The rhythm of a wave

1. GitHub issues with recorded rulings, acceptance criteria and owned paths.
2. One `lane-dev` per issue, in parallel, in the background.
3. As each returns: `lane-verifier` on its branch (and an adversarial review
   by a different strong model on a risky merge), `git merge --no-ff`, the
   `gates` at HEAD, then `suite-verifier` with a FULL run. Main is frozen
   during the run. A failure goes to a fix lane.
4. Commit when a lane lands. Never push without the maintainer, and only with
   a green full run at the HEAD you push. `/ship` pushes and deploys.
5. `/session-start` begins a session; `/session-close` ends one.

## Orchestration settings

The global skills and agents (`session-start`, `session-close`, `ship`,
`lane-dev`, `lane-verifier`, `suite-verifier`, `ticket-writer`) read this
block. Keep the keys; write `none` for what does not apply. `{tests}` in a
command is replaced by a space-separated test list; `{worktree}` by a lane
worktree path.

```yaml
gates:                       # static gates, run by every lane, by lane-verifier and on main after a merge
  - npx tsc --noEmit
ticket_lint: none
tracker: github                      # work items are GitHub issues (gh); no docs/tickets/
test_paths: test/**/*.test.ts           # globs of test files (lane-verifier's test-only-fix check)
test_full: npm run build && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config=jest.config.mjs             # the full suite; only suite-verifier or the orchestrator runs it
test_scoped: npm run build && node --experimental-vm-modules ./node_modules/jest/bin/jest.js --config=jest.config.mjs {tests}         # e.g. "npm test -- {tests}"; none if the runner has no scoped mode
test_scoped_list: none  # command that prints the tests a lane touched; none
test_lock: none             # lock file the harness holds; none
test_log: none               # file where runs are stamped; none
test_logs: none             # where suite-verifier reads causes (log path or "docker logs <name>"); none
deploy: none                   # command; none = /ship stops after the push
deploy_precheck: none # e.g. "players online" query; ask the maintainer if it reports users; none
deploy_verify: none     # prints the deployed commit; must equal HEAD; none
rig_check: none             # extra session-start commands (servers, containers); none
handoff: docs/HANDOFF.md
worktree_links: node_modules .venv   # dirs symlinked from main into every lane worktree
tmux_session: none       # only for tmux window lanes; none when lanes run through the lanes tool
external_lanes: codex, agy, opencode   # codex, agy | codex | agy | none
codex_start: none         # tmux window lanes only; else none
agy_start: none             # tmux window lanes only; else none
max_lanes: claude=5 codex=1 agy=1 opencode=1 test=1
```
