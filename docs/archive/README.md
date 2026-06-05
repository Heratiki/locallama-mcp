# docs/archive — frozen historical material

These docs were moved out of active paths to reduce context bloat. They are **frozen historical
context**, not current requirements or design. History is preserved (`git mv` / `git log
--follow`). For the active doc map and where to look instead, see
[`wiki/11-doc-map.md`](../../wiki/11-doc-map.md).

| Path | What it was | Why archived |
|------|-------------|--------------|
| `dev-plan/` | Early refactor, linting, and route-task plans (last touched 2025-03), incl. `route_task_refactor_old_use_revised_plan/`. | Superseded by shipped routing + current `docs/`. |
| `superpowers/` | Implementation plans & design specs (MCP install/self-update, job recovery, persistent job store, diff-chain architecture, prefill/speculative decoding research). | Features implemented; specs kept for provenance only (`docs/PROJECT_STATE.md`). |
| `audits/Initial-Risk-Audit-5.20.26.md`, `audits/Triage-Governance-Audit-5.20.26.md` | Point-in-time risk & triage-governance audits. | Dated snapshots; `docs/audits/ARCHITECTURAL_TRUTHS.md` + `operational_issue_backlog.md` remain active. |
| `backup-code/orphaned-code.ts` | Orphaned source extracted during refactor. | Dead code, retained for reference. |

**Not archived (intentionally):** root `memory-bank/` is read live by the
`locallama://memory-bank` MCP resource (`src/modules/api-integration/resources.ts:83`);
`dev-docs/` is gitignored third-party retriv library reference; `docs/history/` is the canonical
append-only memory bank.
