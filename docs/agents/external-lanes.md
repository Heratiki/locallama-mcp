# External lanes: codex, agy and opencode through the lanes tool

Set up 2026-10-29. The orchestrator drives codex, agy and opencode through the lane-panel
`lanes` tool (`mcp__lane-panel__lanes`), not through the `codex:` or `agy:`
plugins, and routes each lane to
the tool that is strongest at that kind of work. General method:
`~/.claude/multi-lane-orchestration.md`.

## Limits at the same time

| Kind | At most | Note |
|---|---|---|
| Claude subagent lanes | 5 | Disjoint owned paths. |
| codex lane | 1 | The `lanes` tool refuses a second one unless `force`. |
| agy lane | 1 | The `lanes` tool refuses a second one unless `force`. |
| opencode lane | 1 | The `lanes` tool refuses a second one unless `force`. |
| Test harness run | 1 | Only `suite-verifier` or the orchestrator. |

No two lanes, of any kind, own the same file at the same time.

## The lanes tool

`action`: `start`, `list`, `tail`, `stop`. `start` takes `runner` (`codex` |
`agy` | `opencode`), `lane`, `label`, `prompt` (`"@<abs>/BRIEF.md"`), and `model`,
`effort`, `task`, `sandbox`, `resume`, `force`. The tool runs in the session's
repo. For a lane in its own worktree, use the CLI with the worktree as the
repo:

```bash
python3 ~/.claude/plugins/marketplaces/heratiki-mods/bin/lane.py start <worktree> codex <id> "<label>" --model <m> --effort <e> -- @<abs>/BRIEF.md
```

The lane's files: `<repo>/.claude/lane-panel/lanes/<id>/` (`prompt.md`,
`out.log`, `result.md` = the final answer, `exit.json` = the end). A codex
fix round: `resume: <id>`. If a start is refused for a pool or the lane limit,
tell the maintainer; use `force` only on their go. If a CLI looks logged out,
ask first.

## opencode lanes (OpenCode Go and Z.ai)

`runner: opencode`. Headless only: no tmux, no `resume`, no `sandbox`, no
`effort` (put a variant in the model: `provider/model#variant`). `model` is
required and must be in the live allowed list:

```bash
python3 ~/.claude/plugins/marketplaces/heratiki-mods/bin/models.py /home/heratiki/Source/locallama-mcp list opencode
```

| Model prefix | Pool |
|---|---|
| `opencode-go/<id>` | OpenCode Go (`go5hUsed`, `goWkUsed`, `goMoUsed`) |
| `zai-coding-plan/<id>` | Z.ai (`zaiWkUsed`); the 80% hold does not apply, 100% of the week refuses |

The lane is done when its exit code is 0 and `result.md` is not empty. In a
worktree, use the CLI: `lane.py start <worktree> opencode <id> "<label>"
--model <provider/model> -- @<abs>/BRIEF.md`.

## codex build lanes in a worktree (learned 2026-11-01)

A worktree's git metadata lives in the main tree's `.git/worktrees/`, outside
the worktree. Under `--sandbox workspace-write`, codex cannot write it, so it
cannot commit (lane issue-138). Either the orchestrator commits the lane's
owned paths for it (`git add <owned paths>`, a message that ends with
`Refs #<N>`), or start a build lane with `--sandbox danger-full-access` when
the brief allows commits. Review lanes stay `read-only`.

## tmux windows

Not used in this repo (`tmux_session: none`). All external lanes run through
the `lanes` tool.

## Routing by strength

| Work | Route |
|---|---|
| Issue with written acceptance, bounded files | Claude `lane-dev`, Sonnet |
| Issue with design decisions inside | Claude `lane-dev`, Opus |
| Hard or order-sensitive diagnosis; second implementation; long refactor | codex workhorse, high |
| Adversarial review of a risky lane before merge | codex (a different model from the builder) |
| Simple research, audits, drafts, bounded reading | agy Gemini Flash FIRST |
| Bounded build or fix with a written issue, when the Claude or codex pool is high | opencode, `opencode-go/` or `zai-coding-plan/` model |
| Harder research after a measured Flash failure | agy Pro-class |
| Issue bodies and ADR prose | Claude `ticket-writer` |
| Test runs | Claude `suite-verifier` |
| Verdicts: design rulings, play/visual pass-fail | the maintainer |

Current model names: `docs/agents/model-register.md`. Always pass the model
explicitly (`-m`, `--model`); config defaults go stale.

## One lane, start to end

1. `scripts/lane-worktree.sh add lane/<id>`. codex works only inside it; agy
   research writes only its output file.
2. Brief from `docs/agents/lane-brief-TEMPLATE.md` to
   `.scratch/lanes/<id>/BRIEF.md` (absolute paths), ledger to
   `.scratch/lanes/<id>/GATES.md`. Read the pools (`~/.claude/lane-usage.sh`).
3. Start it: the CLI above with the worktree as the repo (or the `lanes` tool
   for a lane that needs no worktree), `-- @<abs>/BRIEF.md`, model named.
4. Wait with `~/.claude/skills/watch/watch.sh file <lane dir>/exit.json`; read
   `result.md` and `REPORT.md`. Flash may end a turn early with nothing
   written: a fix round (`--resume`), once or twice.
5. (No tmux windows in this repo.)
6. On return the orchestrator runs every `CHECK:` itself from the worktree.
   A failed gate goes back to the same lane as one fix round. Then
   `lane-verifier`, merge, `scripts/lane-worktree.sh rm lane/<id>`.
7. Read the pools again; record the delta and the outcome in the register.

## Balance and sizing

- A pool above 80% of its 5-hour window, or above 85% of its week with more
  than a day left, takes no new lane.
- Claude's weekly pool is shared with the orchestrator: above 70%, research
  goes to agy and diagnosis to codex first.
- Keep one codex and one agy lane busy when suitable work exists.
- Start at the lowest model and effort that has worked for the class; raise
  one step only after a measured model-fault failure.
