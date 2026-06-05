```markdown
# Locallama-MCP: Diff-Chain Task Execution Architecture

## Overview

A small-model-optimized task execution pipeline that decomposes complex requests
into a sequential diff chain, validated at three layers before any file is touched.

---

## Phase 0: Pre-Execution Setup

### BM25 Vectorization
- On request arrival, before decomposition begins
- Vectorize all files relevant to the request scope
- Store BM25 index scoped to this job — discarded on completion
- Provides grounded retrieval for all tasks without hallucinating file contents

---

## Phase 1: Decomposition

**Executor:** Orchestrator (larger/smarter model or routing logic)

**Produces per task node:**
```json
{
  "task_id": "task_3",
  "depends_on": ["task_1", "task_2"],
  "file_target": "src/auth/tokenValidator.ts",
  "code_diff_goal": "add validateToken function that returns Result<User, AuthError>",
  "test_diff_goal": "add test: validateToken returns AuthError on expired token",
  "semantic_search_instructions": ["token validation", "AuthError type", "Result type"],
  "stub_required": false
}
```

**Rules:**
- New files always start with a stub task (task N creates empty/stub, task N+1 builds on diff)
- Each task has exactly one file target
- Goals are surgical — one logical change per task
- Success condition must be mechanically verifiable

---

## Phase 2: Task Execution Chain

### Per-Task Runner Loop

```
Receive: prior_diff (or null for task 1), goal, test_goal, semantic_search_instructions

Step A — Retrieval
  - BM25 semantic query using search_instructions
  - Retrieve relevant file fragments (not full files)
  - Retrieve prior_diff (passed directly from prior task runner)
  - Merge retrieved context, trim to model context budget

Step B — Generate code_diff
  - Small model receives: retrieved context + prior_diff + code_diff_goal
  - Produces: unified diff patch (not full file)
  - Output is a DIFF, never a full file rewrite

Step C — Generate test_diff
  - Small model receives: code_diff + test_diff_goal
  - Produces: unified diff patch for test file
  - One test per task minimum

Step D — RED/GREEN validation loop (per task)
  - Apply code_diff + test_diff to scratch copy
  - Run task-scoped test
  - RED: model retries with failure output as additional context (max N retries)
  - GREEN: diff pair exits task runner
  - FAIL after max retries: escalate to orchestrator for re-decomposition

Step E — Output quantization (before embedding)
  - Strip model reasoning/explanation
  - Extract symbol-level summary:
      "function validateToken added — (token: string, opts: AuthOptions) → Result<User, AuthError>"
  - Embed quantized summary → store in job-scoped embedding store
  - Pass raw diff_pair forward to next task runner
```

### Chain Handoff
```
task_1_runner → (code_diff_1, test_diff_1) → task_2_runner
task_2_runner → (code_diff_2, test_diff_2) → task_3_runner
...
task_N_runner → (code_diff_N, test_diff_N) → validation phase
```

**Context profile stays flat across the chain:**
- Each task receives: prior_diff (raw, small) + BM25 retrieval (bounded) + goal (small)
- Accumulated history is in the embedding store, not the context window
- Context window size is independent of chain length

---

## Phase 3: Three-Layer Validation

### Layer 1 — Per-Task Structural Validation (Deterministic / Small Model)
*Runs inside each task runner at Step D*

- [ ] Diff applies cleanly to current file state
- [ ] File parses without syntax errors after patch applied
- [ ] Task-scoped unit test passes (RED/GREEN)
- [ ] No regressions in directly touched symbols

**Cost:** Near zero — tooling + small model  
**Catches:** Broken diffs, syntax errors, task-local regressions

---

### Layer 2 — Chain Coherence Validation (Fully Deterministic)
*Runs after full chain completes, before any real file is touched*

```
1. Apply full accumulated diff set to scratch copy of files
2. Run: tsc --noEmit (type check)
3. Run: linter
4. Run: full existing test suite
5. Run: all new test diffs from the chain
```

- [ ] TypeScript compiles clean
- [ ] Linter passes
- [ ] All pre-existing tests pass (no regressions)
- [ ] All task-generated tests pass

**Cost:** Zero — no model calls  
**Catches:** Cross-task type breaks, integration regressions, import conflicts

---

### Layer 3 — Intent Validation (Frontier / Mid-Tier Model)
*Runs only if Layer 2 passes*

**Input (compact by design):**
- Original request goal
- Quantized symbol-level summaries from embedding store (not raw diffs)
- Layer 2 test results summary

**Query:**
> "Given this goal and this summary of what changed, and given all tests pass,
> was the original intent accomplished? Are there gaps?"

**Output:**
- PASS → proceed to apply
- FAIL with reason → return to orchestrator for targeted re-decomposition of gap only

**Cost:** One narrow call on compact input, only after cheap layers pass  
**Catches:** Semantic gaps, missing requirements, misunderstood intent

---

## Phase 4: Application

*Only reached after all three validation layers pass*

```
1. Apply full diff set to actual files (not scratch copy)
2. Run full test suite one final time on real files
3. Commit or stage changes
4. Discard job-scoped BM25 index and embedding store
```

---

## Context Budget Model

| What flows forward in chain | Size |
|---|---|
| Prior task raw diff | Small — only changed lines |
| BM25 retrieved fragments | Bounded — trimmed to budget |
| Task goal instruction | Small — one sentence to one paragraph |
| Accumulated history | Zero — lives in embedding store only |
| **Total per-task context** | **Flat regardless of chain length** |

---

## Embedding Store Schema (Job-Scoped)

```typescript
interface StepEmbedding {
  task_id: string;
  files_touched: string[];
  symbols_modified: SymbolSummary[];
  test_names_added: string[];
  quantized_summary: string;       // human-readable, ~30-100 tokens
  embedding_vector: number[];      // fixed-size semantic vector
  confidence: 'high' | 'low';     // high = passed clean, low = needed retries
}

interface SymbolSummary {
  name: string;
  kind: 'function' | 'class' | 'type' | 'const';
  change: 'added' | 'modified' | 'removed';
  signature?: string;
}
```

---

## Model Responsibility Matrix

| Phase | Executor | Reason |
|---|---|---|
| Decomposition | Orchestrator (larger model) | Requires full-picture reasoning |
| BM25 retrieval | Deterministic | Pure keyword scoring |
| Code diff generation | Small model (3B–7B) | Narrow, concrete, verifiable |
| Test diff generation | Small model (3B–7B) | Narrow, concrete, verifiable |
| RED/GREEN loop | Small model + test runner | Iterative narrow correction |
| Output quantization | Rule-based extractor | Deterministic symbol extraction |
| Layer 2 validation | Tooling only (tsc, jest) | Fully deterministic |
| Layer 3 intent check | Frontier / mid-tier model | One focused judgment call |
| Diff application | Deterministic | Pure patch application |

---

## Failure Modes and Recovery

| Failure | Where caught | Recovery |
|---|---|---|
| Diff won't apply | Layer 1 — Step D | Retry with error context |
| Syntax error | Layer 1 — Step D | Retry with parse error |
| Task test fails after N retries | Layer 1 — Step D | Escalate to orchestrator, re-decompose task |
| Type error across tasks | Layer 2 | Identify breaking task, re-run from that task |
| Pre-existing test regression | Layer 2 | Identify offending diff, targeted re-run |
| Intent gap | Layer 3 | Re-decompose gap only, append to chain |

---

## Key Design Principles

1. **The filesystem is shared memory** — not the context window
2. **Diffs, not files** — outputs are always patches, never full rewrites
3. **Flat context profile** — chain length never increases per-task context size
4. **Deterministic first** — every validation that can be mechanical, is
5. **Frontier model last** — expensive reasoning only after cheap validation passes
6. **Test diffs alongside code diffs** — validation intent is built into the chain, not retrofitted
7. **Quantize before embedding** — signal purity improves retrieval accuracy for downstream tasks
```