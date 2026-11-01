# Patch seed runner (Part A)

The fixed manifest is `test/fixtures/patch-seed/requests.json`: five TypeScript
and five Python requests, from one function to a two-file receipt change.
Fixtures are plain directories. The runner copies them into a temporary root
and initializes Git there. Each repetition starts from an independent baseline.
No dependencies are installed. Prerequisites: Node.js, Python 3, Git and this
project's existing TypeScript compiler (`node_modules/.bin/tsc`, added to PATH).
TypeScript compiles with `tsc` and tests with `node --test`; Python tests use
`python3 -m unittest`.

```sh
node scripts/patch-seed/run.mjs --dry-run
node scripts/patch-seed/run.mjs --dry-run --only ts-median
```

Dry-run validates the entire manifest, then checks the selected requests in
temporary copies. Both fixtures must pass their checks; every selected hidden
test must fail an assertion against the unmodified baseline. Syntax/import
errors and timeouts do not count as expected failures. It prints a JSON summary
on stdout and child PIDs on stderr, starts no server and deletes the temp root.

Hidden tests live in `hidden/`, outside both fixtures. They are absent from the
submitted repository, file hints and task checks. In live mode a hidden test is
copied into a separate evaluation repo only after the returned diff applies
and the task checks pass. A run passes only if all three steps succeed.

Live mode is written against PRD 01 §5.1 and awaits #147. It has **not** been
live-verified as part of Part A. Live runs, model selection, floor simulation
and published results belong to Part B. After building the server, the Part B
operator records the fixed model list, runtime/version/flags and settings in a
JSON file before starting. Example shape (replace model and runtime values):

```json
{
  "runtime": "llama.cpp VERSION, router --models-max 1, fixed model files/settings",
  "models": [
    { "model_id": "MODEL_ID", "provider_id": "llama-cpp", "cost_class": "local" }
  ],
  "settings": {
    "LLAMA_CPP_ENDPOINT": "http://localhost:8080",
    "PATCH_LOCAL_MODELS": "1",
    "PATCH_FREE_MODELS": "0",
    "MODEL_TEMPERATURE": "0"
  }
}
```

```sh
node scripts/patch-seed/run.mjs --run-config /path/to/run.json --output /path/to/results
node scripts/patch-seed/run.mjs --run-config /path/to/run.json --max-attempts 1 --reps 3 --only ts-median
```

By default the runner executes both attempt conditions, 1 then 12, with three
repetitions of every request. `--max-attempts N` runs a single condition;
`--reps N` changes repetitions; `--only ID` selects one request. Positive integer
arguments are required. `--output PREFIX` chooses the JSON/Markdown report
prefix; the default is `scripts/patch-seed/results/<timestamp>` (ignored by Git).

The configuration allows local/free models only. The declaration records the
operator's fixed inventory; it does not configure a model allowlist in the
server. Keep runtime inventories and endpoints fixed throughout the run. If a
result names a model outside the declaration, the run stops as incomplete.
Settings accept string values for the patch budgets/ladder sizes, inference
sampling settings and the three local provider endpoints (see `liveConfig`).
Resolved defaults are written before the first task. The server receives no
inherited project `.env`; put runtime endpoint overrides in this configuration.
An inherited `OPENROUTER_API_KEY` is forwarded for free models only and is never
included in reports. Keep secrets out of configuration and runtime descriptions.
Paid selection and spend are disabled in both server settings and task input.
Returned paid usage must be zero or the run stops and records the violation.

Each condition spawns its own `dist/index.js` through the MCP SDK stdio client.
Root, log, scratch and database paths belong to that condition's temp directory.
Only the server PID started by the runner is terminated; the SDK escalates to
SIGKILL if necessary. SIGINT/SIGTERM and errors trigger cleanup. Every started
child PID is printed to stderr. Provider runtimes are managed by the operator.

JSON records each task's patch result (including tokens/models/cost), application,
checks, hidden result and elapsed wall time. Markdown aggregates pass rate,
time per pass and tokens per pass for each condition. Time/tokens include failed
runs in the numerator; no passes gives null/n/a. Protocol/infrastructure errors
produce an incomplete report and nonzero exit; ordinary rejected patches count
as failures in a completed run. Reports are updated after each result and kept
after temporary server data and repository copies are deleted. No report claims
a floor simulation; Part B records that separately.
