# Steward decisions — 2026-11-01

## North star

From `docs/prd/00-goals-roadmap.md`:

> LocalLama lets a person code with working results at $0. It uses free online
> models and small local models that barely run on old hardware. A client sends
> a code request; small local or free models grind through it with a strong
> harness; LocalLama returns a patch that passes the repo's own checks. Slow is
> acceptable; paid models are opt-in only.

## Run

- Started: 2026-11-01T04:50Z, by `/steward` (no stop time given).
- Stop (maintainer, second `/steward`): 10:00 local = 2026-11-01T14:00Z, or a
  pool limit. Work may go on beyond PRD 01 when it is done.
- Scope (maintainer, 2026-11-01): all of PRD 01, waves 1-4. The hardware-floor
  run is a simulation, reported as one.
- Routing (maintainer, 2026-11-01): build lanes on Z.ai first; some on
  OpenCode Go to sample its models. Claude and codex for review and
  verification.
- Pools at start (`~/.claude/lane-usage.sh`, 04:49Z):
  `claude=unreadable gemini5h=98% geminiWk=99% (agy: remaining)
  codex5hUsed=0.0% codexWkUsed=19.0% zaiWkUsed=51.0% go5hUsed=0.0%
  goWkUsed=11.0% goMoUsed=5.0%`.

## Decisions

| Time (UTC) | Item | Decision | Reason | Revert |
|---|---|---|---|---|
| 05:10 | Issues | Filed #138-#148 (PRD 01 §10) via ticket-writer; `PATCH_PAID_CAP_USD` default 0.25 (comment on #138, PRD R-E) | Unset default in PRD; paid is opt-in | Edit #138 and PRD R-E |
| 05:05 | Live tests | Never use the maintainer's `locallama-dev` MCP connection for live runs; each run starts its own server from the build under test (`test-operational.mjs` pattern, stdio client) | Maintainer cannot reconnect `/mcp` while the steward works | — |
| 05:25 | Stop time | 14:00Z (10:00 local), beyond PRD 01 allowed | Maintainer's second `/steward` | — |
| 05:20 | PRD 01 review | codex review: 9 blockers, 3 follow-ups; all taken into PRD 01 revision 1 | Each blocker matched the code I read | `git revert` the revision commit |
| 05:20 | R-D own model path | Patch worker calls providers through ProviderRegistry; not executeRouteTaskBlocking / buildRankedTrio | Live findings F1, F2; review blocker 2 | PRD 01 §2 R-D |
| 05:20 | Validator default | `validate` defaults to false for patch tasks (opt-in filter) | Ruling 1 keeps the filter; one extra call per pass is costly on the floor; checks are the proof | PRD 01 §5.9: set default true |
| 05:20 | Paid accounting | Reserve worst-case cost before each paid call; unknown price = not eligible | Review blocker 4; protects the cap | PRD 01 §5.11 |
| 05:20 | Floor simulation | llama.cpp `-ngl 0` + `systemd-run -p MemoryMax=8G` | No 8 GB CPU-only machine here | PRD 01 §7 |
| 05:00 | Lanes | Started issue-137 (opencode, zai-coding-plan/glm-5.3), prd01-review (codex, read-only, high), r1-research (agy, default Flash) | Z.ai first for builds; codex reviews; agy for research | `lanes stop` |
| 04:50 | Stop time | PRD 01 done, a pool limit, or 2026-11-02T05:00Z | No stop time given; Claude pool unreadable, so a time cap limits spend | Edit this row |

## Findings from the live run (step 3, 04:50Z)

One `route_task` (slugify, priority cost) on the running `locallama-dev`
server (pid 3872940, started 04:21Z, older than `dist/` of 04:26Z). Log:
`locallama.log`.

| # | Tier | Finding | Evidence |
|---|---|---|---|
| F1 | 1 | llama.cpp router models are registered but never routed | log 04:21:26 `Provider initialized: llama-cpp (local)` with 6 router models; log 04:50:26 `Models by provider: {"ollama":6,"openrouter":476}` |
| F2 | 1 | A local task fails: the subtask's provider holds the model id | log 04:50:26 `Assigned Model: llama3.2:3b (Provider: llama3.2:3b)`, `No registered provider supports model 'llama3.2:3b'`. The coordinator chose `tinyllama (ollama)`; the reassign in `Router.preserveLocalDecisionModelAssignments` gave the bad object. Exact cause not confirmed |
| F3 | 1 | An error text is returned as `completed` with validation `passed: true` while both validators were skipped | `get_task_status` 6c6d4d06…: result = `Error: Failed to execute subtask…`, `attempts[0].passed: true`, both validations `skipped: true` |
| F4 | env | OpenRouter key refused | log 04:50:39 `401 … "User not found."`; maintainer gets a new key |
| F5 | 2 | Ladder puts `tinyllama` (1.1B) as `best`, above `mistral:7b-instruct` | `route_task` response `ranked_trio` |
| F7 | env? | Free OpenRouter models fail with 404 `No allowed providers are available for the selected model` (new key works; no 401) | log 04:57:52, 04:57:54. Likely the account's privacy setting for free endpoints; not confirmed |
| F6 | 2 | `get_system_state` shows OpenRouter as `paid` while `OPENROUTER_FREE_ONLY` defaults true | `get_system_state` response |

Maintainer note (2026-11-01): they use llama.cpp through llama-router, not Ollama.

## Waits for the maintainer

- Validator default for patch tasks: I set opt-in (`validate: false`). Say if you want it on by default.
- Done 05:00: new OpenRouter key; reconnect done.
- F7: check https://openrouter.ai/settings/privacy (free endpoints / data policy). Only you can change the account.
- Push of main (8+ commits ahead of origin at start; all docs).
