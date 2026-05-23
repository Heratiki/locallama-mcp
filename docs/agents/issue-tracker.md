# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Current recommended work order (2026-05-23)

Prioritize by production impact first (correctness/concurrency), then contention/visibility, then llama-cpp feature work with explicit dependencies.

| Order | Issue | Why this order |
| --- | --- | --- |
| 1 | [#86](https://github.com/Heratiki/locallama-mcp/issues/86) | [COMPLETE — [PR #98](https://github.com/Heratiki/locallama-mcp/pull/98)] Core P1 correctness bug: local single-slot FIFO is broken under concurrency; many queue semantics depend on this being fixed first. |
| 2 | [#83](https://github.com/Heratiki/locallama-mcp/issues/83) | [COMPLETE — [PR #100](https://github.com/Heratiki/locallama-mcp/pull/100)] Core P1 correctness bug: stale `get_task_status` breaks polling trust and masks real queue behavior. |
| 3 | [#88](https://github.com/Heratiki/locallama-mcp/issues/88) | [COMPLETE — [PR #101](https://github.com/Heratiki/locallama-mcp/pull/101)] Queue position reporting bug; read-time per-slot queue position eliminates duplicate positions. |
| 4 | [#97](https://github.com/Heratiki/locallama-mcp/issues/97) | [COMPLETE — [bf0cdab](https://github.com/Heratiki/locallama-mcp/commit/bf0cdab)] Disables startup benchmark sweeps by default; adds `BenchmarkFreshnessService` with TTL-based lazy scheduling, backoff, and reason codes. |
| 5 | [#84](https://github.com/Heratiki/locallama-mcp/issues/84) | [COMPLETE — [PR #103](https://github.com/Heratiki/locallama-mcp/pull/103)] Complements #97 by adding queue/priority semantics and contention signaling when benchmarks block task work. |
| 6 | [#85](https://github.com/Heratiki/locallama-mcp/issues/85) | Observability layer (`get_system_state`) is most useful after status/queue/benchmark behavior above is corrected. |
| 7 | [#94](https://github.com/Heratiki/locallama-mcp/issues/94) | llama-cpp prerequisite: binary discovery is explicitly required by #92 and #95. |
| 8 | [#92](https://github.com/Heratiki/locallama-mcp/issues/92) | llama-cpp process ownership baseline; needed before metadata-aware spawn behavior in #93. |
| 9 | [#93](https://github.com/Heratiki/locallama-mcp/issues/93) | Depends on spawn flow from #92; adds GGUF-driven flag correctness for reliable inference behavior. |
| 10 | [#95](https://github.com/Heratiki/locallama-mcp/issues/95) | Depends on #94 and #93 (and references #91); best delivered once llama-cpp discovery + metadata are in place. |

### Dependency notes

- Explicit issue dependencies from descriptions: `#94 -> (#92, #95)`, `#92 -> #93`, `#93 -> #95`.
- Related sequencing constraints: `#86/#83` before `#88`; `#97` before full contention/visibility polishing in `#84/#85`.
