# 11 — Doc map & maintenance

Where every doc lives, what's authoritative, and what got archived. The point of this wiki is to
be the **single entry**, so this page tells you when to leave it for an authoritative doc.

## Authoritative & active

| Doc | Role |
|-----|------|
| [`CONTEXT.md`](../CONTEXT.md) | **Canonical domain language.** Source of truth for all terms. |
| [`docs/adr/`](../docs/adr/) | Architecture Decision Records — the *why* (0001 job queue, 0002 queue position, 0003 system state). |
| [`docs/AGENTS.md`](../docs/AGENTS.md) | Shared operating guide + reading order for all coding agents. |
| [`docs/PROJECT_STATE.md`](../docs/PROJECT_STATE.md) | Current status snapshot (dated append-only notes). |
| [`docs/audits/ARCHITECTURAL_TRUTHS.md`](../docs/audits/ARCHITECTURAL_TRUTHS.md) | Core constraints / design philosophy. |
| [`docs/audits/operational_issue_backlog.md`](../docs/audits/operational_issue_backlog.md) | Active operational backlog. |
| [`docs/OPERATIONAL_TEST_PLAN.md`](../docs/OPERATIONAL_TEST_PLAN.md) | Live verification plan + records. |
| [`docs/LIVE_TESTING.md`](../docs/LIVE_TESTING.md) | Real-world MCP test log + open bugs (check before filing issues). |
| [`docs/PRD-validator-benchmarking.md`](../docs/PRD-validator-benchmarking.md) | Validator benchmarking PRD. |
| [`docs/fixture-promotion-policy.md`](../docs/fixture-promotion-policy.md) | Validator fixture acceptance/promotion rules. |
| [`docs/architecture/provider-registry.md`](../docs/architecture/provider-registry.md) | Provider registry design. |
| [`docs/agents/`](../docs/agents/) | Issue tracker, triage labels, domain layout conventions. |
| [`docs/client-compatibility.md`](../docs/client-compatibility.md), [`docs/lightweight-models.md`](../docs/lightweight-models.md) | Client quirks; lightweight-model notes. |
| [`README.md`](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md) | User-facing install/usage; contribution guide. |

## Strategic / background (not active requirements)

`docs/PLAN.md`, `docs/ROADMAP.md`, `docs/ROADMAP_ACTIVE.md` are strategic/historical context
**only** unless a GitHub Issue references them for a specific task (`docs/AGENTS.md`).

## Historical (append-only, not a decision source)

`docs/history/memory-bank/` — canonical append-only project memory. Not the active source of
truth.

## Archived (frozen — moved out of active paths to cut context bloat)

Relocated into [`docs/archive/`](../docs/archive/) with history preserved. Index:
[`docs/archive/README.md`](../docs/archive/README.md).

| Archived path | Was | Why archived |
|---------------|-----|--------------|
| `docs/archive/dev-plan/` | Root `dev-plan/` | 2025-03 refactor/linting plans, superseded. |
| `docs/archive/superpowers/` | `docs/superpowers/` | Historical implementation plans/specs (job recovery, persistent store, self-update). Implemented; notes frozen. |
| `docs/archive/audits/` | Two dated `docs/audits/*-5.20.26.md` | Point-in-time risk/governance audits. |
| `docs/archive/backup-code/` | Root `backup-code/` | Orphaned `orphaned-code.ts` — dead code, kept for reference. |

## Intentionally **not** touched

- **Root `memory-bank/`** — looks like a stale duplicate but is read **live** by the
  `locallama://memory-bank` MCP resource (`src/modules/api-integration/resources.ts:83`). Moving it
  would silently break that resource. Left in place on purpose.
- **`dev-docs/`** — gitignored third-party **retriv library** reference, not this codebase's docs.
- **`docs/history/`**, **`docs/adr/`** — canonical historical / decision records.

## Maintenance contract

- Wiki pages cite `file:line`. Trust the **symbol name** over the exact number; numbers drift.
- **Change a subsystem → update its wiki page in the same change.** The
  `.github/instructions/update-docs-on-code-change.instructions.md` rule applies.
- Don't fork `CONTEXT.md` or ADRs into the wiki — link to them.
- Archive, don't delete: move superseded docs into `docs/archive/` with `git mv` and add a line to
  its README.
