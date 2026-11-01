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

Note: rows marked 05:15-05:40 were estimated times; the true times are 05:00-05:12Z. Rows after this note use `date -u`.

| Time (UTC) | Item | Decision | Reason | Revert |
|---|---|---|---|---|
| 05:18 | G4 gate defect | The steward's G4 CHECK (`tr` + unquoted list) found no tests; lane 149 wrote ABANDON correctly. Fixed in mkbrief.sh and the 140/142/149/150 ledgers; lanes did not change gates | Steward fault, not a lane fault | — |
| 05:18 | #149, #140 done | Both ALL MET after the fix; lane-verifier on each. #140 built in its own lane-dev worktree (lesson in external-lanes.md) | — | — |
| 05:18 | #150 | Z.ai glm-5.3 lane started (worktree reset to main 95eeb82 first) | Fix found problems before new work | `lanes stop issue-150` |
| 05:19 | #149, #140 merged | `f88df78`, `69742dc`; both lane-verifier PASS; full suite green at 69742dc. OC-Go kimi-k2.7-code did #149 cleanly (sample) | Gates, review, suite | `git revert -m1` each |
| 05:23 | #143, #142 merged | `ecacbe7`, `cd4eb7a`; lane-verifier PASS (adversarial on #142); full suite green at cd4eb7a. #141 (codex) and #144 (lane-dev) started | Gates, review, suite | `git revert -m1` each |
| 05:27 | #144 review FAIL | Two blockers (paid cost clamped to reservation; 4 chars/token instead of `countTokens`). One fix round to the same lane-dev | Spec §5.11, §5.8; the steward flagged both before review | — |
| 05:27 | #145 | lane-dev Sonnet started (second Claude builder for a short time, while #144 is in a fix round) | Throughput; Claude week low | stop agent |
| 05:36 | #141 merged | `5bf4277`; lane-verifier PASS (process-group kill, env, no orphans) | Gates, review | `git revert -m1 5bf4277` |
| 05:36 | #144 merged | `a50b675` after one fix round (true paid cost; `countTokens`); re-verify PASS | Gates, review | `git revert -m1 a50b675` |
| 05:36 | Stuck test process | Killed jest pid 84405 + 15 workers (stalled #144 gate run, 4.5 min, tiktoken on a 200k-char run) by PID | Maintainer rule: watch for stuck test processes | — |
| 05:36 | #145 review FAIL | Open socket in the HTTP test (jest does not exit); caller abort reported as timeout. Fix round to the same lane-dev. G4 now greps `^Tests:` (was `tail -6`) | Review | — |
| 05:36 | #150 review FAIL | Qualified-id probe picks the wrong provider; producer `modelsDb.ts:156` still writes provider = model id. Scope widened to modelsDb.ts (comment on #150); fix round on Z.ai (lane issue-150b) | Fix the source, not only the symptom | — |
| 05:40 | #145 merged | `edde477` after 2 fix rounds (found a real timer leak on cancel; OpenRouter abort error); re-verify PASS; merge hook enforced the verifier verdict. Wave 2 of PRD 01 done | Gates, review, suite | `git revert -m1 edde477` |
| 05:40 | #146 | codex high, danger-full-access, from edde477 | Central integration issue; codex idle | `lanes stop issue-146` |
| 05:45 | #150 merged | `a03c81c` after 1 fix round; re-verify PASS; producer `modelsDb.ts` fixed (no more provider = model id); full suite green | Gates, review, suite | `git revert -m1 a03c81c` |
| 05:45 | docs/CLAUDE.md | PowerShell rule made Windows-only, Linux line added (`871918b`) | Tier 2: it misled agents on this Linux host | `git revert 871918b` |
| 05:45 | #151 | Z.ai glm-5.3 lane from a03c81c | Fix found problems first | `lanes stop issue-151` |
| 05:48 | Z.ai 5h limit | Lane issue-151 stopped at Z.ai `Usage limit reached for 5 hour` (429); zai5h 99%, resets 09:51Z; Z.ai week 51%→71% this run. Build lanes go to OpenCode Go until 09:51Z; #151 restarted on `opencode-go/deepseek-v4-pro` | Pool limit; maintainer asked to sample OC-Go | Back to Z.ai after 09:51Z |
| 05:55 | #146 merged | `4f2e54c`; adversarial lane-verifier PASS (43 tests; model path, cancel, recovery, cleanup); full suite green. Wave 3 of PRD 01 done. Known limit: the cap cannot stop a provider that bills past its output cap; actual spend is kept and further paid calls stop | Gates, review, suite | `git revert -m1 4f2e54c` |
| 05:55 | #148 split | Part A (fixtures, seed requests, hidden tests, runner with --dry-run) on codex now; part B (live runs, floor sim, wiki, test plan) after #147 | Parallel work while #147 waits for #151 (shared routing/index.ts) | — |
| 06:01 | #151 merged | `61010ed`; lane-verifier PASS; suite green. Text-match failure detection kept as a ledger follow-up (patch_task does not use this path) | Bounded review rounds (memory) | `git revert -m1 61010ed` |
| 06:01 | #147 | lane-dev Opus (public MCP tool + src/index.ts: the riskiest integration) | CLAUDE.md: Opus for an issue with design inside; Claude week 3% | stop agent |
| 06:05 | #148 part A merged | `69502ed`; lane-verifier PASS; dry run: 10 requests, both baselines pass, 10 hidden tests fail before a patch; no process or temp folder left | Gates, review | `git revert -m1 69502ed` |
| 06:05 | Beyond PRD 01 | G1 (measure the savings) issue via ticket-writer, to build after #147; PRD 02 draft for G7/G8 via agy Sonnet (docs only, rulings left to the maintainer). F5/F6 not worked (not approved) | Roadmap order puts G1 first; G7/G8 need maintainer rulings | Close the issue / delete the draft |
| 05:14 | Claude lanes | At most 1 Sonnet lane-dev at a time for wave-2 issues, next to the one opencode (Z.ai/OC-Go) lane and codex | One opencode lane at a time; Claude week 1% (reset 2026-11-06); Z.ai stays the main build route | Stop using lane-dev |
| 05:13 | #139 merged | `4d4e45c`; lane-verifier PASS (docs only); wave 1 of PRD 01 complete | Gates, review | `git revert -m1 4d4e45c` |
| 05:40 | #138 merged | `933d517`; lane-verifier PASS; full suite green. Codex sandbox could not commit in a worktree; steward committed; lesson in external-lanes.md | Gates, review, suite | `git revert -m1 933d517` |
| 05:40 | #139, #142 | #139 docs to ticket-writer (Sonnet) in its worktree; #142 to codex high, danger-full-access | Routing table (ADR prose); codex idle, opencode busy | stop lanes |
| 05:25 | R1 run 2 | Accepted `docs/research/free-model-landscape-2026-11-01.md` (agy Sonnet): live-page rows, 70 `unconfirmed` cells, Method list; spot check of Groq model ids matches the live page. Key facts: GitHub Models retired; G7 first = OpenRouter :free, Groq, Gemini free, Cloudflare Workers AI; G8 local = Granite 4.2 3B, LFM3-1.7B, Gemma 4 E2B | Fixes PRD 01 open question 1 inputs | `git revert` |
| 05:20 | #137 merged | `f292453`; lane-verifier PASS; full suite 67/67 suites, 510/510 tests. Not pushed | Gates, review, suite green | `git revert -m1 f292453` |
| 05:18 | #138 | Codex lane (medium) for the contracts, because the opencode runner holds one lane (#149) | Throughput; codex week 20% | `lanes stop issue-138` |
| 05:12 | Maintainer away | Maintainer went to bed (~05:10Z). Note from them: "You aren't forced into a mold on what this MCP has been in the past." Steward decides routine items alone; consequential ones go to "Waits for the maintainer" | Maintainer message | — |
| 05:12 | #137 | Lane on Z.ai glm-5.3 met 8/8 gates; benchmarkService limits drafts to lm-studio/ollama as the issue said (llama-cpp not included; old path, accepted). Z.ai week 51%→54% | Gates re-run by the steward | — |
| 05:12 | #149 | Lane on OpenCode Go `kimi-k2.7-code` (sample of OC-Go, as the maintainer asked) | Routing preference | `lanes stop issue-149` |
| 05:05 | Order of work | Fix found problems before new work: #137, then #149-#151, then PRD 01 waves | Maintainer direction 05:00Z; steward tier rule | — |
| 05:05 | R1 research | Flash run failed a spot check (2024 numbers, illustrative values); file marked DRAFT; run 2 on agy claude-sonnet-5-5-medium with live-page rules. Argon not used (reserved) | Routing: Pro-class after a measured Flash failure | Use run 1 draft |
| 05:15 | route_task defects | Maintainer chose "file and fix": #149 (F1), #150 (F2), #151 (F3). F1 cause confirmed: `cost-monitor/api.ts getAvailableModels` never asks llama-cpp | Two live runs reproduce F2/F3 | Close the issues |
| 05:15 | Test servers | Maintainer rule: watch for stuck test servers by PID; own log/data dir per run; check `df` and `ps` around runs (memory test-servers-watch). Disk at 05:15: 82G free (81% used) | Maintainer instruction | — |
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

- **PRD 02 draft** (`docs/prd/02-free-pool-and-old-hardware.md`, G7 + G8): §12 lists 10 rulings, each with a recommended option (first free providers; Gemini data-use opt-in; patient wait; 8 GB default model Granite 4.2 3B; npm `locallama setup`; first-run report; llama.cpp first; model download consent; free-provider descriptor file; ladder spread across providers). Nothing in G7/G8 is built until you rule. Then an adversarial review and issues.

- F5 (ladder ranks tinyllama 1.1B as `best`) and F6 (`get_system_state` shows OpenRouter as `paid` under free-only): found in the live run, not approved for fixing. File and fix them?

- `~/.claude/skills/watch/watch.sh`: the `file` kind printed `WATCH OK` for lane issue-151, whose `exit.json` held `"code": 1, "failed": true` (Z.ai 429). A pattern cannot fix it (the kind does not read content). Suggest a lane-exit kind that reads `exit.json` and gives `WATCH FAIL` on a non-zero code. Outside the repo, so not changed. The steward reads `exit.json` after every lane end.

- Validator default for patch tasks: I set opt-in (`validate: false`). Say if you want it on by default.
- Done 05:00: new OpenRouter key; reconnect done.
- F7: check https://openrouter.ai/settings/privacy (free endpoints / data policy). Only you can change the account.
- Push of main (8+ commits ahead of origin at start; all docs).
