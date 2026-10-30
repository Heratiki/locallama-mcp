# Ticket format

Set up 2026-10-29. `node scripts/check-tickets.mjs` (`scripts/check-tickets.mjs`) enforces it
over every file in `docs/tickets/`.

## File and heading

- File name: `T-NNN-slug.md` (three or more digits, lowercase slug, hyphens).
- The H1 starts `# T-NNN:` with the same number as the file name.

## Status line

Before the first `## ` heading there is exactly one line starting `Status:`.
It reads `Status: <value>`, where value is one of:

| Value | Meaning | The header must also carry |
|-------|---------|----------------------------|
| `open` | Written, not launched. | Nothing. |
| `in-progress` | A lane is running it. | A `Lane:` header line before the first `##`, e.g. `Lane: lane/t047`. |
| `landed` | Merged to main. | In the detail: the lane branch (`lane/t047`, `worktree-agent-…`) or a 7+ hex sha, and a `YYYY-MM-DD` date. |
| `closed` | Done without a lane of its own. | In the detail: why, or what closed it. |
| `wontfix` | Will not be done. | In the detail: the reason (or a T-NNN / ADR-NNN). |
| `superseded` | Replaced. | In the detail: the superseding `T-NNN` or `ADR-NNN`. |

Free text may follow the value on the same line, as ` (...)` or `. ...`, and
on continuation lines. The detail ends at a blank line or the next `Key:`
header line. Example:

    Status: landed (lane/t047, ca920a1, 2026-09-29). Route: Sonnet.

The value is lowercase and plain: no bold, no backticks.

## Sections

`## What happens today`, `## Rulings (YYYY-MM-DD)`, `## Settled design`,
`## Owns`, `## Out of scope`, `## Acceptance`. See
`docs/tickets/T-000-ticket-template.md`.

## Error codes

Output is `path:line: CODE message`, exit 1 on any error.

| Code | Meaning |
|------|---------|
| `BAD-STATUS` | The value is not in the enum (or empty, or wrongly cased). |
| `NO-STATUS` | No `Status:` line before the first `## `. |
| `TWO-STATUS` | More than one `Status:` line before the first `## `. |
| `NO-LANE` | `in-progress` with no `Lane:` header. |
| `LANDED-NO-REF` | `landed` with no lane branch and no 7+ hex sha. |
| `LANDED-NO-DATE` | `landed` with no `YYYY-MM-DD` date. |
| `NO-REASON` | `closed`, `wontfix` or `superseded` with no reason; `superseded` also needs a `T-NNN` or `ADR-NNN`. |
| `NAME-MISMATCH` | File name is not `T-NNN-slug.md`, or the H1 number differs. |

## Rule

A lane updates its own ticket's Status to `landed` in its own commit, with
its branch (or sha) and the date. Change only the Status and Lane header
lines to record status; never edit the body for it.
