# LocalLama MCP — Goal and Roadmap of Goals

_Status: draft, 2026-11-01. Rulings from the maintainer are marked **Ruling**._

## North star

LocalLama lets a person code with working results at $0. It uses free online
models and small local models that barely run on old hardware. A person who
cannot pay for a coding subscription or API credits gets a slow but steady way
to do what only companies and people with money could do before.

A client sends a code request. LocalLama diagnoses it, and small local or free
models grind through it with a strong harness. LocalLama returns a patch that
passes the repo's own checks.

The same harness also cuts the frontier tokens of people who do pay: a
frontier agent (Claude Code, Codex) spends tokens only to write the request and
to review the patch.

Speed is secondary. A slow result that works is better than a fast result that
does not. Paid models are opt-in only.

In the maintainer's words (2026-11-01): "For those people that can't afford
coding subscriptions or API credits I'd love for them to find Free model use
online and have local models barely running on old hardware and let Locallama
give them a slow but steady way to achieve something that has only really been
available to companies, or those with money."

## Rulings (2026-11-01)

1. **Working code** means the patch passes the commands that the repo declares
   (for example `tsc`, lint and scoped tests), in a scratch copy of the repo.
   The LLM judge (`OutputValidator`) stays as an extra filter, not as proof.
2. **Patch lands:** LocalLama returns a unified diff and the check results. The
   coding agent applies the diff. Later, an optional small local model can
   apply the diff after the agent approves it. LocalLama never writes the
   user's working tree without that approval.
3. **Escalation:** when local and free models cannot make a passing patch, the
   grind loop stops and LocalLama returns a diagnosis: the check errors, the
   best attempt and what was tried. An optional paid override on the task
   allows paid "repairs". The default is no paid spend.
4. **Checks:** the agent can send the check commands in the request. A repo
   can also keep default checks in `.locallama/checks.json`. The request
   wins over the file.
5. **Scratch workspace:** a temporary `git worktree` of the target repo now,
   with dependency folders linked from the main tree, a timeout and a
   controlled env. The check runner has a backend seam, so a container
   backend can replace the worktree later with no change to the MCP surface.
6. **Savings estimate (G1):** saved = the prompt and completion tokens that the
   small models used on the accepted attempt, times a fixed factor, minus the
   agent's request and review tokens. The factor is a setting. The A/B runs in
   G6 check the factor later.
7. **Patch request shape:** the agent sends a goal line, the repo path,
   optional file hints and optional checks. LocalLama finds the rest of the
   context itself with BM25.
8. **Front door:** first target the free clients that already speak MCP
   (Cline, Roo Code, Continue, OpenCode) on a free or local model. The
   client's model can be weak, because LocalLama does the hard work. A
   built-in front door (CLI or dashboard page) comes later.
9. **Hardware floor:** an old laptop with 8 GB RAM and no usable GPU. Local
   models are 1-3B at a few tokens per second, plus free online models. Every
   "done when" line must also pass on this machine, at $0.

## Gaps in the code today (2026-11-01)

- Nothing records the frontier tokens that a task saved. `cost-monitor`
  measures only context trimming.
- Nothing compiles or runs the code that a task returns. Only the benchmarks
  run a `codeCheck`. `OutputValidator` is a model that answers YES or NO.
- The retry ladder (`good` → `better` → `best`) changes the model. It does not
  give the check errors back to the same small model.
- The only free online provider is the OpenRouter free tier. Other free tiers
  are not providers yet.
- The hardware floor (Ruling 9) is not tested. Defaults (timeouts, context
  sizes, the shared local slot) assume a GPU.

## Roadmap of goals

Each goal has a "done when" line. A goal is done only when the line is true in
a live run against real providers (`docs/audits/ARCHITECTURAL_TRUTHS.md`).

### G1 — Measure the savings

Record per task: tokens used by local, free and paid models; dollars spent; an
estimate of the frontier tokens the agent did not spend (Ruling 6); whether
the client accepted the result (`rate_model`); and the time to the result.

Done when: one MCP read (or `get_system_state` field) gives accepted tasks,
pass rate, dollars spent and estimated frontier tokens saved, per day and per
task type.

### G2 — Verified patch (patch DAG, one node)

LocalLama makes a patch in a scratch workspace, applies it, and runs the repo's
declared checks there, apart from the server process (own CWD, controlled env,
timeout, output capture). It returns a diff only when the checks pass.

Done when: a real request on a real repo returns a diff that applies cleanly to
the working tree and passes the same checks there.

### G3 — Grind loop

When a check fails, LocalLama gives the errors back to the small model and
tries again. It moves up the model ladder only after N failed attempts, and
inside a per-task budget of attempts and time. At the end it returns the
passing diff or the diagnosis (Ruling 3). A paid override allows paid repairs
under a dollar cap.

Done when: on a fixed set of seed requests, the pass rate with the loop is
higher than without it, at zero paid spend by default.

### G4 — Diagnose and split (patch DAG, many nodes)

LocalLama breaks a request into a DAG of small patches, each inside what a
small model can do. Each node gets BM25 context from the repo. Nodes run in
dependency order and in parallel where the slots allow. Each node is verified
(G2) and ground (G3). The final diff is the merged result, verified again.

Done when: a request that no single small-model attempt passes is done by the
DAG, and the merged diff passes the repo's checks.

### G5 — Learn from real work

Routing uses measured pass rates per task type and per model, from real tasks
(G1) and not only from benchmarks.

Done when: model choice for a task type changes because of recorded pass rates,
and the change shows in the G1 numbers.

### G6 — Fit the clients

Each client gets short instructions on when to offload work. The responses are
small: a diff, a check summary and a status, with no prose. Free MCP clients
come first (Ruling 8), frontier agents second. Later: the optional local
apply-model (Ruling 2) and a built-in front door.

Done when: Cline or Roo Code on a free model sends a request, applies the
returned diff, and the checks pass, at $0. And: Claude Code and Codex each
offload a request, and the agent-side token use is lower than doing it
directly (measured, not estimated).

### G7 — Free pool and patient queue

Add the free online tiers that allow code use as providers, next to the
OpenRouter free tier. Each one gets its rate limits and daily quotas from its
own docs. The queue is patient: when every free tier is at its limit, a Job
waits for the next window and does not fail, and the status shows when it
will run.

Done when: a grind run that uses more requests than one free tier allows per
day still finishes at $0, by moving across free tiers and waiting for quota.

### G8 — Old hardware works

Defaults fit the hardware floor (Ruling 9): long timeouts for slow tokens,
small context sizes, one local model in RAM at a time, and CPU-only runtimes
(llama.cpp, Ollama). Setup finds the hardware and picks a profile. Install is
one command, and a first-run check says what the machine can do.

Done when: on an 8 GB, CPU-only machine with no API key, a fresh install
finishes a small seed request with a passing diff, using only local and free
models.

## Order

G1 first, so every later goal has a number. G2 and G3 together are the first
useful product. G8 runs next to G2/G3, so the first product works on the
hardware floor from the start. G7 comes before long grind runs need it. G4
builds on G2/G3. G5 and G6 can start after G2.

## Next planning step

Write `docs/prd/01-verified-patch-and-grind-loop.md` (G2 and G3, at the G8 floor) on top of
these rulings and the grounding map. Then split it into GitHub issues.

See `docs/prd/validated-patch-dag/00-repo-grounding-and-reuse-map.md` for the
code that G2–G4 reuse, and the seven gaps that need new code.
