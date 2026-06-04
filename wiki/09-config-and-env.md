# 09 — Configuration & environment

All runtime configuration is built from environment variables at startup and exposed as a single
typed object. This page is the reference for *what* is configurable and *which changes need a
restart*.

## How config is built

`src/config/index.ts`:

- **`Config`** interface (`:37`) — the typed shape everything reads.
- **`config`** (`:398`) — the live singleton, built by `buildConfigFromEnv(process.env)`.
- **`validateConfig()`** (`:403`) — fails fast on invalid combinations at startup.
- Config also loads JSON: `src/config/models.json`, `prompting-strategies.json`,
  `provider-compat.json`.

Secrets (API keys, tokens) live in `.env` and are **never** committed. Tracked docs document
variable **names and safe defaults only** (`docs/PROJECT_STATE.md`, "What to keep out of docs").
The template is `.env.example`.

## Hot reload vs restart

The `reload_config` MCP tool calls `reloadConfig()` (`:504`). Only a subset of fields can change
without a restart:

- **`HOT_RELOADABLE_CONFIG_FIELDS`** (`:120`) — applied live by `reload_config`.
- **`RESTART_REQUIRED_CONFIG_FIELDS`** (`:152`) — changes here are ignored until the process
  restarts.

When adding a config field, decide which list it belongs in — putting a binding/port/transport
field in the hot-reloadable list is a bug.

## Environment variable reference

Grouped as in `.env.example`. Document names/defaults here; keep real values in `.env`.

### Server
`PORT`, `HOST`, `API_PREFIX`

### Local providers
`LM_STUDIO_ENDPOINT`, `OLLAMA_ENDPOINT`, `OLLAMA_TIMEOUT`, `LLAMA_CPP_ENDPOINT` (user-managed
llama.cpp), `DEFAULT_LOCAL_MODEL`

### Slots / concurrency
`PROVIDER_MAX_CONCURRENT_LOCAL` (default 1 — the shared local slot),
`PROVIDER_MAX_CONCURRENT_REMOTE` (default 1 per remote provider),
`PROVIDER_HEALTH_PROBE_INTERVAL_MS` — see [04-providers](04-providers.md).

### Model sampling
`MODEL_TEMPERATURE`, `MODEL_MAX_TOKENS`, `MODEL_TOP_P`, `MODEL_FREQUENCY_PENALTY`,
`MODEL_PRESENCE_PENALTY`

### Routing thresholds
`TOKEN_THRESHOLD`, `COST_THRESHOLD`, `QUALITY_THRESHOLD` — the knobs that decide when a local
model is "good enough" vs escalating ([03-decision-engine](03-decision-engine.md)).

### Remote
`OPENROUTER_API_KEY` (+ `OPENROUTER_FREE_ONLY` controls paid routing — see `README.md`)

### Benchmarking
`BENCHMARK_RUNS_PER_TASK`, `BENCHMARK_PARALLEL`, `BENCHMARK_MAX_PARALLEL_TASKS`,
`BENCHMARK_TASK_TIMEOUT`, `BENCHMARK_SAVE_RESULTS`, `BENCHMARK_RESULTS_PATH`,
`RELIABLE_BENCHMARK_COUNT`, `STARTUP_BENCHMARK_TARGETS` — see [06-benchmarking](06-benchmarking.md).

### Validation
`MIN_VALIDATOR_SCORE`, `VALIDATION_RETRY_BUDGET` — the retry-ladder budget
([03-decision-engine](03-decision-engine.md)).

### Code search
`CODE_SEARCH_ENABLED`, `CODE_SEARCH_EXCLUDE_PATTERNS`, `CODE_SEARCH_INDEX_ON_START`,
`CODE_SEARCH_REINDEX_INTERVAL` — see [07-cost-and-search](07-cost-and-search.md).

### Python / retriv (optional)
`PYTHON_PATH`, `PYTHON_VENV_PATH`, `PYTHON_DETECT_VENV`, `RETRIV_PYTHON_PATH` — note the code
search core itself is native TS and needs no Python ([07](07-cost-and-search.md)).

### Cache & logging
`CACHE_ENABLED`, `CACHE_DIR`, `MAX_CACHE_SIZE`, `LOG_LEVEL`, `LOG_FILE`

## See also
- Full installation/config walkthrough → [`README.md`](../README.md)
- Client-specific config → [`docs/client-compatibility.md`](../docs/client-compatibility.md)
