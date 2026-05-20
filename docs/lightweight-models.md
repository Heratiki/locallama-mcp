# Lightweight Model Guide

This guide documents recommended model configurations for machines with ≤16 GB RAM and no discrete GPU. Use `LOCALLAMA_PROFILE=lightweight` to activate routing thresholds tuned for these models.

## Recommended models

| Model | Runtime | Quant | RAM (idle) | RAM (loaded) | ctx (tokens) | Tok/s (M1 16 GB) | Good for |
|---|---|---|---|---|---|---|---|
| `qwen2.5-coder-1.5b` | Ollama | q4_K_M | ~900 MB | ~1.2 GB | 32 768 | ~55–70 | code completion, short refactors, docstrings |
| `phi-3.5-mini-instruct` | LM Studio | q4_K_M | ~1.1 GB | ~1.4 GB | 4 096 | ~45–60 | chat, Q&A, simple code review |
| `gemma-2-2b-it` | Ollama **or** LM Studio | q4_K_M | ~1.5 GB | ~1.8 GB | 8 192 | ~40–55 | instruction-following, summarization |

> Numbers measured on a 2020 Apple M1 MacBook Pro (16 GB unified memory) with models loaded via Ollama 0.4 / LM Studio 0.3.  
> Expect 15–25 % lower throughput on Intel x86-64 without AVX-512.

### Notes

- **`qwen2.5-coder-1.5b`** is the primary recommendation for code-routing. Despite its small size, it performs competitively on single-function generation tasks and is fast enough to be interactive.
- **`phi-3.5-mini-instruct`** is better for conversational or mixed-task work. Its 4 096-token context window matches the `TOKEN_THRESHOLDS.LARGE` value used in lightweight mode.
- **`gemma-2-2b-it`** is a balanced fallback. Its 8 192-token window allows medium-length prompts.

## Setup

### 1. Pull the models

```bash
# Ollama
ollama pull qwen2.5-coder:1.5b
ollama pull gemma2:2b

# LM Studio (GUI) — search for "phi-3.5-mini-instruct" and download the Q4_K_M GGUF
```

### 2. Configure the server

Add to your `.env` (or shell environment):

```env
LOCALLAMA_PROFILE=lightweight
OLLAMA_ENDPOINT=http://localhost:11434/api
# Optionally disable OpenRouter to stay fully local:
# OPENROUTER_API_KEY=
STARTUP_BENCHMARK_TARGETS=local
```

### 3. Start the server

```bash
npm start
# or, for verbose output:
bash start-locallama-verbose.sh
```

On first boot the server benchmarks all locally available models. With the three recommended models the benchmark takes ~2 minutes. Results are stored in `data/benchmarks.db` and inform future routing decisions.

## Routing behaviour in lightweight mode

`LOCALLAMA_PROFILE=lightweight` adjusts two sets of thresholds:

### Complexity thresholds

| Level | Default | Lightweight | Effect |
|---|---|---|---|
| `SIMPLE` | 0.3 | 0.4 | Wider simple zone → more tasks stay local |
| `MEDIUM` | 0.6 | 0.7 | Wider medium zone → borderline tasks try local first |
| `COMPLEX` | 0.8 | 0.9 | Higher bar before routing to paid API |

### Token thresholds

| Level | Default | Lightweight | Effect |
|---|---|---|---|
| `SMALL` | 500 | 500 | (unchanged) |
| `MEDIUM` | 2 000 | 2 000 | (unchanged) |
| `LARGE` | 8 000 | 4 096 | Matches practical context limit of small quantized models |

When a task exceeds 4 096 tokens in lightweight mode the router either:
1. Routes to a free OpenRouter model (if `OPENROUTER_API_KEY` is set), or  
2. Routes to a paid model as the last resort.

Before either escalation the router attempts **task decomposition** via `codeTaskCoordinator`. If the task can be split into subtasks that each fit within 4 096 tokens, the local small model handles them sequentially and the results are synthesized.

## Decomposition path assessment

`codeTaskCoordinator` decomposes code tasks into typed subtasks (analysis, generation, review, refactoring) and assigns each to the best-scoring local model. In lightweight mode:

- **Works well for**: multi-step refactors where each function fits in context, sequential code generation (generate → review → fix), documentation generation.
- **Works poorly for**: tasks where every subtask is itself large (e.g., summarizing a 1 500-line file in one go). In that case the coordinator logs a warning and falls back to paid routing.

The decomposition path is **on by default** — no extra configuration is needed. To disable it (e.g., for debugging), set `DISABLE_TASK_DECOMPOSITION=true` in your environment (not recommended for production).

## Manual smoke-test checklist

Run these after starting the server in lightweight mode to confirm routing works end-to-end:

```bash
# 1. Simple refactor — should route to local
echo '{"tool":"route_task","arguments":{"task":"Rename variable x to count in the following Python snippet: x = 0\nfor i in range(10):\n    x += i","task_type":"code","complexity":0.2,"priority":"cost"}}' | node dist/index.js

# 2. Medium complexity — should route to local (threshold raised to 0.7)
echo '{"tool":"route_task","arguments":{"task":"Write a TypeScript function that merges two sorted arrays","task_type":"code","complexity":0.65,"priority":"cost"}}' | node dist/index.js

# 3. High complexity — should route to paid (above 0.9 threshold)
echo '{"tool":"route_task","arguments":{"task":"Design and implement a distributed rate limiter with Redis","task_type":"code","complexity":0.95,"priority":"quality"}}' | node dist/index.js
```

Expected results:
- Cases 1 & 2: `"costClass": "local"` in the response.
- Case 3: `"costClass": "paid"` or `"costClass": "free"` (if OpenRouter configured).
