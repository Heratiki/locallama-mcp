# Prefill Cache & Speculative Decoding for locallama-mcp: Deep Research, Testing Regime, Validation, Memory Analysis, and Implementation Proposal

***

## Executive Summary

locallama-mcp orchestrates local LLMs via the Model Context Protocol, decomposing tasks into subtasks and routing them across models. The prefill cache — in all the variants discussed — is one of the highest-leverage optimization opportunities available, because the project's workload has an inherently high-prefix-reuse structure: a shared system prompt, repeated tool schemas, accumulated context, and similar code patterns across subtasks. Speculative decoding compounds this by reducing the per-token decode latency on the primary large model, while the prefill cache reduces the cost of re-processing that shared context on every call.

This report covers:

1. The full technical landscape of the strategies discussed — Automatic Prefix Caching (APC), shared-prefix KV reuse, speculative decoding (draft-model, n-gram, and hierarchical variants), sequential vs. concurrent model loading, speculative prefill/prompt compression, and SpecOffload
2. A structured testing regime with concrete benchmarks and success criteria
3. A validation framework for correctness and quality assurance
4. Memory usage analysis with formulae and per-model estimates
5. A phased implementation proposal specific to the locallama-mcp architecture
6. Concerns and risks — including several that have not been raised yet

***

## Part 1: Technical Landscape

### 1.1 Automatic Prefix Caching (APC) — The Foundation

Automatic Prefix Caching (APC) caches the KV states computed during the prefill phase and reuses them for any subsequent request sharing the same token prefix. In vLLM, this is enabled via `enable_prefix_caching=True`. In llama.cpp's server, it is controlled via `cache_prompt: true` per request and the `--cache-reuse` flag server-side.[^1][^2]

The critical insight for locallama-mcp is that APC addresses the prefill bottleneck specifically — it does not reduce decode latency. Its value is therefore maximized when:[^2]

- The shared prefix (system prompt + tool schemas) is long relative to the unique per-request suffix
- Requests are sent sequentially or with sufficient overlap to keep the cached KV entries warm
- The same model instance handles multiple sequential requests

The llama.cpp server implements slot-based KV cache reuse. By default, a slot is considered a match if at least 50% of the prompt context matches (controlled by the `-sps` parameter). The slot can also be explicitly specified per request via the `id_slot` parameter in the request body, giving locallama-mcp fine-grained control over which cached state to reuse.[^1]

**Known bugs**: There was a regression in llama.cpp around commit `b7a1746` where `--cache-reuse` stopped functioning correctly for prompt prefixes — it was fixed but confirmed the fragility of this feature across versions. Version pinning is therefore essential.[^3]

### 1.2 The Vocab Size Mismatch Problem — Qwen Family

This is the most practically significant concern for any Qwen-based speculative decoding setup in locallama-mcp.

Within the Qwen2.5 and Qwen2.5-Coder families, the vocabulary size is not uniform across model sizes. The 0.5B and 1.5B models use `vocab_size=151936`, while the 7B, 14B, 32B, and 72B models use `vocab_size=152064`. The difference is padding tokens added for distributed training efficiency — they are semantically inert, but inference engines enforce exact vocab matching by default.[^4][^5]

This affects the speculative decoding pairing matrix for Qwen2.5-Coder:

| Draft Model | Target Model | Standard Spec Decoding | Notes |
|---|---|---|---|
| 0.5B | 32B | ❌ Blocked (vLLM default) | vocab 151936 vs 152064[^6] |
| 1.5B | 32B | ❌ Blocked (vLLM default) | same mismatch[^6] |
| 7B | 32B | ✅ Works | both use 152064[^6] |
| 3B | 14B | ❌ Blocked | 3B uses 151936 |
| 7B | 14B | ✅ Works | same vocab |

**Workarounds**:
- Manually edit `config.json` of the smaller model to set `vocab_size=152064`. The padding tokens are never sampled, so this is safe in practice.[^7]
- In llama.cpp, a vocab mismatch triggers a "vocab not compatible" warning but does not abort — it continues with real-time token translation, which adds overhead and reduces acceptance rates.[^8]
- The vLLM GitHub issue #7252 proposed a `--disable-vocab-check-for-spec-decoding` flag, but as of early 2026, the standard workaround is the config.json patch.[^4]
- For Qwen3 / Qwen3-Coder variants, the `transplant-vocab` tool from ik_llama.cpp can create a vocab-aligned GGUF from a mismatched draft checkpoint.[^9]

**Qwen3.6 and hybrid architectures**: Qwen3.6 uses hybrid recurrent layers which caused speculative decoding to silently fail in some forks — rejected tokens require state rollback that recurrent layers cannot support. This was patched in mainline llama.cpp but illustrates an important class of silent failure.[^8]

### 1.3 Speculative Decoding Variants

#### 1.3.1 Draft-Model Speculative Decoding

The canonical approach: a smaller draft model autoregressively proposes `k` tokens, and the target model verifies them in a single forward pass. The output distribution is provably identical to the target model's distribution.[^10]

Speed improvement depends on:
- Acceptance rate `α` — the fraction of draft tokens accepted by the target
- The cost ratio between draft and target forward passes

LM Studio provides practical guidance: for a 14B target, use a ≤3B draft; for a 32B target, use a ≤7B draft. If the draft model is too large relative to the target, the verification overhead eliminates gains. For Qwen2.5-Coder-32B with the 0.5B draft on a single 3090, after the vocab config fix, baseline 33.92 tokens/s improved to 83.21 tokens/s (2.45×) for Python-like tasks.[^11][^12]

**Concurrent memory requirement**: Both models must be loaded simultaneously. For a 32B Q4 target (~18GB) and a 0.5B Q8 draft (~0.5GB), total VRAM is approximately 18.5GB plus KV cache.[^11]

#### 1.3.2 N-gram / Prompt Lookup Decoding

N-gram speculative decoding requires no draft model — it uses token patterns from the existing context or previously generated output as the draft. This makes it:[^13][^14]
- Memory-free (no second model to load)
- Immediately applicable to any model family without vocab matching concerns
- Most effective for code generation, structured JSON, templated outputs, and reasoning traces with repeated patterns[^13]

For locallama-mcp, n-gram decoding is particularly strong because:
1. Code tasks have high n-gram overlap — both from tool schemas and repeated code idioms
2. Multi-trajectory subtask outputs tend to reuse similar expressions — one study found 80% of 4-grams reuse across 16 independent reasoning trajectories[^15]
3. It requires zero additional VRAM, keeping headroom for KV cache

The STAND research (STochastic Adaptive N-gram Drafting) demonstrates 60–65% inference latency reduction for code tasks with 16 reasoning trajectories, outperforming EAGLE-2 by 14–28% in throughput when stochastic drafting and logit-based history are combined.[^15]

In vLLM, n-gram speculative decoding is configured within `--speculative-config` using `method: "ngram"`.

#### 1.3.3 Self-Speculative Decoding (Layer Skip)

An entire model can act as its own drafter by skipping intermediate layers during the draft phase. Self-speculative decoding requires no additional model in memory and achieves up to 1.99× speedup on LLaMA-2 class models. The tradeoff is that the output quality of early exits varies by architecture — models explicitly trained with an early-exit loss (LayerSkip class) perform significantly better than ad-hoc layer skipping.[^16][^17]

This is relevant for locallama-mcp if a single model must serve both roles on very constrained hardware.

#### 1.3.4 Hierarchical Speculative Decoding (HSD)

HSD stacks multiple draft models into a hierarchy — the smallest model generates autoregressively, larger intermediate models verify and pass accepted tokens upward, until the target model performs a final verification pass. The key finding is that this hierarchy can achieve up to 1.2× additional speedup over the best single-draft baseline. The optimal hierarchy is computable in polynomial time via reduction to the Generalized Shortest Path problem.[^18]

For locallama-mcp, an example hierarchy on a well-resourced machine could be:
```
Qwen2.5-Coder 0.5B (generate) → 7B (verify) → 32B (final verify)
```
However, HSD requires shared vocabulary across all models in the hierarchy, making the Qwen vocab mismatch issue apply at every edge of the hierarchy.[^18]

#### 1.3.5 Sequential Loading (Swap Speculation)

An alternative for severely memory-constrained setups: load the draft model, generate candidate tokens, swap it out, load the target model, verify. This approach does not yield speedups under normal conditions because the model swap cost (seconds) dominates any savings from reduced target decode calls. However, SpecOffload demonstrates that embedding speculative decoding into an offloading pipeline — using GPU idle time during weight transfers to run the draft model — achieves 2.54× throughput improvement over baselines on consumer hardware. This requires careful pipeline orchestration and is most beneficial for batched offline inference rather than interactive MCP calls.[^19]

### 1.4 Speculative Prefill / Prompt Compression

A distinct but related technique: instead of caching the full prefix KV, use a lightweight draft model to identify which tokens in a long prompt are most important (via attention-derived importance scores), compress the prompt, and forward only the compressed version to the target.[^18]

The 2026 cross-family speculative prefill research shows that this importance estimation transfers across model families — a Qwen3-1.7B draft can compress prompts for a LLaMA-3.1-8B target to 45% of original length while retaining 98% of task performance on LongBench v1. TTFT reduction of up to 18× was measured when compressing 128K-token inputs to 16K.[^18]

For locallama-mcp, this is the correct technique for agentic subtask calls that accumulate large reasoning traces or tool call histories. There is a critical caveat: aggressive compression (below ~15% keep rate) degrades code debugging tasks noticeably — 87.6% baseline retention at 15% keep rate for DeepSeek-V3.1. The recommended floor for code tasks is 20–30% keep rate.[^18]

### 1.5 Disaggregated Prefilling

vLLM supports separating the prefill and decode phases into distinct instances connected by a KV cache transfer mechanism. A prefill instance processes the prompt and produces a KV cache, which is transferred to a decode instance. This can be advantageous when:[^20][^21]

- Prefill is a bottleneck (long prompts)
- Different hardware is available for compute-heavy vs. memory-heavy operations

For a single-machine locallama-mcp deployment this is complex to justify, but relevant for future scaling.

***

## Part 2: Memory Analysis

### 2.1 KV Cache Formula

The per-token KV cache memory consumption (bytes) for a standard MHA/GQA model is:[^22][^23]

```
bytes_per_token = 2 × n_layers × n_kv_heads × d_head × bytes_per_element
```

Where `bytes_per_element` = 2 for BF16/FP16, 1 for FP8/INT8.

For GQA models (which Qwen2.5 uses), `n_kv_heads` is the number of *key-value* heads, which is smaller than the total query heads. Total KV cache size:

```
total_kv_bytes = n_sequences × seq_len × bytes_per_token
```

### 2.2 Qwen2.5-Coder KV Cache Estimates (BF16, batch=1)

| Model | n_layers | n_kv_heads | d_head | Bytes/token | @ 4K ctx | @ 32K ctx | @ 128K ctx |
|---|---|---|---|---|---|---|---|
| 0.5B | 24 | 2 | 64 | 768 B | ~3 MB | ~24 MB | ~96 MB |
| 1.5B | 28 | 2 | 128 | 1,792 B | ~7 MB | ~56 MB | ~224 MB |
| 7B | 28 | 4 | 128 | 3,584 B | ~14 MB | ~112 MB | ~448 MB |
| 14B | 48 | 8 | 128 | 12,288 B | ~48 MB | ~384 MB | ~1.5 GB |
| 32B | 64 | 8 | 128 | 16,384 B | ~64 MB | ~512 MB | ~2.0 GB |

These are significant relative to model weight sizes (~18GB for 32B Q4). The critical observation: **a 32B model with 128K context occupies ~2GB KV cache on top of model weights**. When running speculative decoding, both the target and draft models require KV cache simultaneously, roughly doubling the KV cache overhead.

### 2.3 APC Memory Behavior

APC keeps KV blocks allocated in a pool. In vLLM, blocks are evicted using LRU eviction — if a new request cannot fit in the remaining KV cache budget, the least-recently-used cached prefix is evicted. In llama.cpp, cached KV state is associated with a slot — if the slot is reassigned to a different conversation, the prefix cache for the previous conversation is lost.[^2][^1]

**Pathological case**: Enabling `cache_prompt=true` in llama.cpp without sufficient context size causes the KV cache to fill rapidly and enter continuous prediction mode — this was a documented bug where 3 requests could exhaust the default 512-token context. Always ensure context size is allocated proportional to the expected prefix length.[^24]

### 2.4 Draft Model Memory Cost

For speculative decoding with a concurrent draft model, memory budget splits approximately as:

| Configuration | Target VRAM | Draft VRAM | KV Cache (32K ctx) | Total |
|---|---|---|---|---|
| 32B Q4 + 7B Q8 | ~18 GB | ~7 GB | ~1 GB | ~26 GB |
| 32B Q4 + 1.5B Q8 | ~18 GB | ~1.5 GB | ~0.6 GB | ~20 GB |
| 14B Q4 + 3B Q8 | ~8 GB | ~2 GB | ~0.4 GB | ~10.5 GB |
| 7B Q4 + 0.5B Q8 | ~4 GB | ~0.5 GB | ~0.2 GB | ~4.7 GB |

The 32B + 7B pairing requires at least a 32GB VRAM card (RTX 3090/4090 level), or two 16GB GPUs. The 32B + 1.5B pairing fits on a single 24GB card.

### 2.5 N-gram Memory Overhead

N-gram tables (prompt lookup decoding) carry a memory footprint proportional to the stored output so far. For locallama-mcp's typical subtask lengths (~2K–8K tokens), the n-gram table is on the order of a few MB — negligible. For STAND with logit storage, the overhead is bounded by `top_k × vocab_logits × n_gram_entries`, approximately 20–50 MB for typical code generation workloads.[^15]

***

## Part 3: Testing Regime

### 3.1 Testing Architecture

All tests should be run in an isolated environment that mirrors the production locallama-mcp deployment: same model paths, same quantization levels, same context sizes. Define a **test harness** that wraps the MCP tool dispatch mechanism and injects timing probes.

#### Phase 1: Baseline Characterization (No Optimization Active)

**Goal**: Establish ground truth latency and correctness baselines.

| Test | Metric | Success Criterion |
|---|---|---|
| T1.1: Single model TTFT (system prompt only, 512 tokens) | ms | Establish baseline |
| T1.2: Single model TTFT (system prompt + 4K context) | ms | Measure prefix cost |
| T1.3: Single model decode throughput (code task, 512 output tokens) | tok/s | Establish baseline |
| T1.4: Multi-subtask sequential dispatch (5 subtasks, same system prompt) | total ms | Measure repeated-prefix cost |
| T1.5: Multi-subtask sequential dispatch (5 subtasks, unique context) | total ms | Measure non-reusable cost |

Run each test 20× and record mean, p50, p95, p99. The delta between T1.4 and (5 × T1.1) quantifies the wasted prefill cost that APC will recover.

#### Phase 2: APC / Prefix Cache Tests

| Test | Configuration | Metric | Expected Outcome |
|---|---|---|---|
| T2.1: APC warm hit | 2nd request identical prefix | TTFT | ~30–80% reduction vs T1.1 |
| T2.2: APC partial hit (50% overlap) | Varied suffix | TTFT | Proportional reduction |
| T2.3: APC cold miss | Entirely different prefix | TTFT | ≈ T1.1 (no regression) |
| T2.4: APC eviction under load | 10 concurrent sessions | Cache hit rate | Monitor LRU evictions |
| T2.5: Cross-request prefix sharing | Shared system prompt, varied user context | TTFT | Reduction proportional to prefix fraction |
| T2.6: llama.cpp cache_prompt slot collision | Interleave 2 conversations on 1 slot | TTFT | Detect cache invalidation regression |

**Measurement tool**: Log the `n_tokens_cached` field from llama.cpp server responses, or `prefix_cache_hit_rate` from vLLM metrics endpoint.

#### Phase 3: Speculative Decoding Tests

| Test | Configuration | Metric | Success Criterion |
|---|---|---|---|
| T3.1: N-gram on code generation | Qwen2.5-Coder target, no draft model | tok/s vs T1.3 | ≥ 1.2× improvement for Python code |
| T3.2: Draft model spec decoding | 32B + 7B, vocab-aligned | tok/s | ≥ 1.4× over T1.3 |
| T3.3: Draft model spec decoding | 32B + 1.5B, config.json patched | tok/s | ≥ 1.3× over T1.3 |
| T3.4: Vocab mismatch detection | 32B + 0.5B, unpatched config | Error/warning log | Confirm warning appears; verify output still correct |
| T3.5: Draft model on natural language | Spec decoding on description/planning task | tok/s | May be ≤ 1.0× (regression risk) |
| T3.6: Speculative decoding + APC combined | Full system | Total latency | Additive gains from both |
| T3.7: Acceptance rate measurement | Log accepted/rejected tokens per request | α (acceptance rate) | Code tasks ≥ 0.65; NL tasks ≥ 0.45 |

**Critical note**: vLLM speculative decoding is not yet uniformly optimized and may not yield improvements for all datasets or sampling parameters. T3.5 exists specifically to catch regression cases.[^25][^10]

#### Phase 4: Speculative Prefill / Compression Tests

| Test | Configuration | Metric | Success Criterion |
|---|---|---|---|
| T4.1: Prompt compression at 50% keep rate | Draft: small Qwen/LLaMA, target: primary model | TTFT + accuracy | ≥ 5× TTFT reduction, ≥ 95% task accuracy |
| T4.2: Prompt compression at 25% keep rate | Code task | TTFT + correctness | Code correctness must not drop >10% |
| T4.3: Prompt compression at 15% keep rate | Code debugging subtask | correctness | Expected regression — establish floor |
| T4.4: Cross-family compatibility | LLaMA draft → Qwen target | Task accuracy | ≥ 90% of full-prompt baseline per research[^18] |

#### Phase 5: Stress / Regression Tests

| Test | Metric | Risk Targeted |
|---|---|---|
| T5.1: 100-request sequential batch with APC | Cache hit rate, memory | KV cache exhaustion[^24] |
| T5.2: Mixed short/long context requests | p99 latency | Eviction thrash |
| T5.3: Model version update | Acceptance rates | Token translation regression[^8] |
| T5.4: Qwen3.6 hybrid architecture (if used) | Silent failure check | Recurrent layer state rollback[^8] |
| T5.5: vLLM multiple instances same GPU | Launch success | CUDA race condition[^26] |

***

## Part 4: Validation Framework

### 4.1 Correctness Validation

Speculative decoding is *lossless by design* — the output distribution is provably identical to the target model's distribution under rejection sampling. However, "silent failures" exist where the output is subtly wrong without error messages. The following must be validated:[^16][^18]

**Output Equivalence Tests**

For every speculative decoding configuration, run paired generation:
1. Generate 50 outputs from the target model alone (ground truth)
2. Generate 50 outputs from the same model with speculative decoding enabled using the same seed
3. With `temperature=0.0` (greedy), outputs must be *bit-identical*
4. With `temperature>0.0`, compare via semantic similarity and task metric equivalence (pass@1 for code)

If greedy outputs diverge, speculative decoding is broken — likely a vocab mismatch or architecture incompatibility.

**Quality Regression Tests**

| Task | Metric | Regression Threshold |
|---|---|---|
| Code generation (HumanEval-style) | pass@1 | ≤ 1% drop allowed |
| Code debugging | Bug identification accuracy | ≤ 3% drop at 30% keep rate |
| JSON structured output | Schema validity | 0% regression allowed |
| Multi-turn conversation | Semantic coherence (ROUGE/BERTScore) | ≤ 2% drop |

### 4.2 Prefix Cache Validity

APC introduces a correctness risk if two logically distinct conversations share a token-level prefix by coincidence (e.g., two different users asking similar-looking questions). The KV state from the first would be applied to the second, potentially leaking context.

**Tests required**:
- Validate that conversation isolation is maintained: generate sensitive context in session A, then start session B with the same prefix — verify B's output does not reference A's content
- Check llama.cpp slot assignment: confirm that `id_slot` is correctly scoped per conversation
- Test with multi-user simulation (if locallama-mcp ever serves more than one user concurrently)

### 4.3 Memory Leak Validation

Both speculative decoding and APC require careful KV cache lifecycle management.

**Tests**:
- Run 500 sequential requests and monitor GPU VRAM with `nvidia-smi` or `torch.cuda.memory_allocated()`
- Confirm KV cache returns to baseline after context eviction
- Detect the `cache_prompt` fill-to-exhaustion bug (T5.1) — monitor for continuous prediction mode[^24]

### 4.4 Acceptance Rate Monitoring

Implement an acceptance rate tracker that logs per-request speculative decoding statistics. Low acceptance rates indicate a misconfigured or misaligned draft model and signal that speculative decoding may be *hurting* performance. Alert threshold: if α < 0.4 for more than 20% of requests, disable speculative decoding and fall back to standard decode.

***

## Part 5: Implementation Proposal for locallama-mcp

### 5.1 Architecture Overview

The implementation is structured as a layered optimization stack, applied independently to avoid coupling failures:

```
┌─────────────────────────────────────┐
│         MCP Tool Dispatcher          │
├─────────────────────────────────────┤
│    Layer 3: Speculative Prefill      │  (compress long accumulated context)
├─────────────────────────────────────┤
│    Layer 2: Speculative Decoding     │  (reduce per-token decode latency)
├─────────────────────────────────────┤
│    Layer 1: Automatic Prefix Cache   │  (eliminate repeated prefill cost)
├─────────────────────────────────────┤
│     Model Backend (vLLM/llama.cpp)   │
└─────────────────────────────────────┘
```

Each layer has an independent enable/disable flag, allowing gradual rollout and per-task toggling.

### 5.2 Phase 1: Automatic Prefix Caching (Low Risk, High Reward)

**Backend: llama.cpp server**

```bash
llama-server \
  --model /path/to/model.gguf \
  --ctx-size 32768 \
  --n-parallel 4 \
  --slot-save-path /tmp/kv-slots/ \
  --cache-reuse 256 \
  --flash-attn
```

The `--slot-save-path` enables slot persistence across server restarts. The `--cache-reuse 256` means slots with at least 256 shared tokens are considered a match.

**In the MCP request layer**, add a `PrefixCacheManager` that:
1. Maintains a registry of conversation IDs to slot IDs
2. Pins the system prompt + tool schema as a canonical prefix hash
3. Sets `cache_prompt: true` and `id_slot: <registered_slot>` on every request
4. Evicts slot registrations after a configurable idle timeout

```typescript
class PrefixCacheManager {
  private slotRegistry = new Map<string, number>();
  private systemPromptHash: string;
  
  getSlotForConversation(conversationId: string): number | undefined {
    return this.slotRegistry.get(conversationId);
  }
  
  registerSlot(conversationId: string, slotId: number): void {
    this.slotRegistry.set(conversationId, slotId);
  }
}
```

**Backend: vLLM**

```python
llm = LLM(
    model="Qwen/Qwen2.5-Coder-32B-Instruct",
    enable_prefix_caching=True,
    gpu_memory_utilization=0.85,
)
```

vLLM's APC requires no per-request configuration — it automatically detects shared prefixes across requests in the same engine instance.

**Risk flag**: Ensure the system prompt + tool schema is always prepended in *exactly* the same token sequence. Any change (whitespace, ordering of tool schemas) breaks the prefix match and incurs full recompute.

### 5.3 Phase 2: N-gram Speculative Decoding (Zero Additional Memory)

Enable as the first speculative decoding layer — it adds no memory cost and degrades gracefully to standard decoding when no n-grams match.

**vLLM configuration**:

```python
llm = LLM(
    model="Qwen/Qwen2.5-Coder-32B-Instruct",
    enable_prefix_caching=True,
    speculative_config={
        "method": "ngram",
        "num_speculative_tokens": 5,
        "ngram_prompt_lookup_max": 4,
        "ngram_prompt_lookup_min": 1,
    }
)
```

**llama.cpp**: N-gram speculative decoding is not yet a first-class feature in llama.cpp server; it requires prompt lookup decoding via custom patches or can be approximated by the Python wrapper layer.

**Expected gains**: 1.2–1.5× for code generation tasks; near-zero gain for unstructured natural language.[^13]

### 5.4 Phase 3: Draft-Model Speculative Decoding (High Reward, Requires VRAM Budget)

**Prerequisites**:
- Confirm vocab compatibility (apply config.json patch to 0.5B/1.5B/3B models if needed)
- Budget VRAM: target_model_size + draft_model_size + 2× KV_cache

**Recommended pairings for locallama-mcp**:

| Primary Target | Draft | Expected Speed-up | Vocab Fix Needed |
|---|---|---|---|
| Qwen2.5-Coder-32B | Qwen2.5-Coder-7B | 1.4–2.0× | No |
| Qwen2.5-Coder-32B | Qwen2.5-Coder-1.5B (patched) | 1.3–1.8× | Yes — patch 1.5B config |
| Qwen2.5-Coder-14B | Qwen2.5-Coder-7B | 1.3–1.6× | No |
| Qwen2.5-Coder-7B | Qwen2.5-Coder-1.5B (patched) | 1.2–1.5× | Yes |

**vLLM configuration**:

```python
llm = LLM(
    model="Qwen/Qwen2.5-Coder-32B-Instruct",
    enable_prefix_caching=True,
    speculative_config={
        "model": "Qwen/Qwen2.5-Coder-7B-Instruct",
        "num_speculative_tokens": 5,
        "method": "draft_model",
    },
    gpu_memory_utilization=0.82,
)
```

**llama.cpp configuration**:

```bash
llama-server \
  --model /path/to/Qwen2.5-Coder-32B-Q4_K_M.gguf \
  --model-draft /path/to/Qwen2.5-Coder-7B-Q8_0.gguf \
  --draft-max 8 \
  --draft-min 2 \
  --draft-p-min 0.4 \
  --device CUDA0 \
  --device-draft CUDA0 \
  --ctx-size 32768 \
  --cache-reuse 256
```

Placing the draft on a second GPU (if available) can free VRAM for a larger context window, as demonstrated in the llama-swap example where this freed space for a larger context.[^11]

### 5.5 Phase 4: Speculative Prefill for Long-Context Subtasks

For subtasks where the accumulated context (reasoning trace + tool call history) exceeds ~8K tokens, apply speculative prefill before forwarding to the target model.

**Implementation**:

```typescript
class SpeculativePrefillCompressor {
  private draftModel: DraftModelClient;
  
  async compressContext(
    fullPrompt: TokenSequence,
    keepRate: number = 0.3,
    task: 'code' | 'general' = 'code'
  ): Promise<TokenSequence> {
    // Minimum keep rate floor for code tasks
    const effectiveRate = task === 'code' ? Math.max(keepRate, 0.20) : keepRate;
    
    const importanceScores = await this.draftModel.getAttentionImportance(
      fullPrompt,
      lookaheadTokens: 8
    );
    return this.chunkSelect(fullPrompt, importanceScores, effectiveRate);
  }
}
```

Keep rate guidance based on research findings:[^18]
- General tasks: 30–50% keep rate → 90–100% task accuracy retained
- Code understanding: 25–30% keep rate minimum
- Code debugging: 20–30% keep rate minimum; avoid below 15%

The draft model for compression can be from any family — cross-family importance estimation works reliably. A Qwen3-1.7B or LLaMA-3.2-1B serves well as the compression draft while adding minimal overhead.[^18]

### 5.6 Task Routing Logic

Different subtask types in locallama-mcp's decomposition pipeline should route to different optimization configurations:

```typescript
type OptimizationProfile = {
  apc: boolean;
  ngramSpec: boolean;
  draftModelSpec: boolean;
  specPrefill: boolean;
  specPrefillKeepRate: number;
};

function getOptimizationProfile(subtask: SubTask): OptimizationProfile {
  switch (subtask.type) {
    case 'code_generation':
      return { apc: true, ngramSpec: true, draftModelSpec: true, 
               specPrefill: false, specPrefillKeepRate: 1.0 };
    case 'code_review':
      return { apc: true, ngramSpec: true, draftModelSpec: true, 
               specPrefill: subtask.contextTokens > 8000, specPrefillKeepRate: 0.3 };
    case 'planning':
      return { apc: true, ngramSpec: false, draftModelSpec: false,
               specPrefill: subtask.contextTokens > 16000, specPrefillKeepRate: 0.5 };
    case 'patch_assembly':
      return { apc: true, ngramSpec: true, draftModelSpec: false,
               specPrefill: false, specPrefillKeepRate: 1.0 };
  }
}
```

Speculative decoding is *disabled* for planning/reasoning tasks where the target model's distribution diverges significantly from the draft — this is the primary source of acceptance rate collapse.

***

## Part 6: Concerns and Risks

### 6.1 Concerns Previously Discussed

**Vocab size mismatch**: Covered in detail in Section 1.2. The 0.5B/1.5B vs. 7B+ split within Qwen2.5-Coder is the most likely silent failure mode — easy to hit, easy to fix, but catastrophic if missed.

**Hybrid architectures breaking prefix caching**: mlx-lm confirmed in a 2026 issue that prefix cache reuse is silently broken for sliding window attention, Mamba/SSM, and mixed attention models — full prompt recomputation occurs with no error message. If locallama-mcp ever adds a Qwen3-Next or similar hybrid model, this assumption must be re-validated.[^27]

**Silent speculative decoding failure**: Qwen3.6's recurrent layers caused speculative decoding to silently fall back to standard decoding in some forks. The token output is correct but no speedup occurs and no warning is emitted.[^8]

### 6.2 Concerns Not Previously Raised

**6.2.1 Context Window Fragmentation Under APC**

vLLM's KV cache is managed in fixed-size blocks (default 16 tokens per block). With APC enabled, prefix blocks are pinned in GPU memory until eviction. In a scenario where locallama-mcp runs many concurrent subtask conversations with different prefix lengths, the KV cache can become fragmented — the raw memory is available but not contiguous enough to accommodate a new large prefix. This manifests as unexpected TTFT spikes or evictions of warm prefixes despite available VRAM.[^28]

*Mitigation*: Set `--max-num-seqs` in vLLM proportional to expected concurrent conversations, and monitor the `kv_cache_usage_perc` metric. Block size tuning may also help.

**6.2.2 speculative decoding and temperature > 0**

Speculative decoding with sampling (temperature > 0) uses rejection sampling to maintain the target distribution. However, at high temperatures (>1.0) or with top-p sampling, acceptance rates collapse significantly — the draft and target distributions diverge, and nearly every draft token is rejected, adding pure overhead. locallama-mcp should disable speculative decoding automatically when `temperature > 0.8` or `top_p < 0.9`.[^29]

**6.2.3 Speculative Decoding and Pipeline Parallelism Incompatibility**

vLLM explicitly documents that speculative decoding is not compatible with pipeline parallelism. If locallama-mcp ever distributes a single model across multiple GPUs using pipeline parallelism (as opposed to tensor parallelism), speculative decoding must be disabled. Tensor parallelism is compatible.[^30][^10]

**6.2.4 Tool Schema Order Sensitivity**

APC depends on byte-level token identity of the shared prefix. If locallama-mcp ever dynamically reorders tool schemas (e.g., surfacing most-relevant tools first), this breaks the prefix hash entirely, converting every request into a cache miss. The system prompt and tool schema must be sorted in a deterministic canonical order regardless of usage frequency.

**6.2.5 The "Warm Prefix Cold KV" Problem on Server Restart**

llama.cpp's slot-based KV cache is stored in GPU VRAM and is lost on server restart unless explicitly saved to disk via `--slot-save-path`. For long-running locallama-mcp sessions that persist across deployments, a server restart causes the first request in each conversation to re-incur full prefill cost even though the prefix has been "seen before." Implementing a slot snapshot/restore mechanism mitigates this.

**6.2.6 Draft Model Quantization Mismatch with Target**

Running the target at Q4_K_M and the draft at Q8_0 (recommended for quality) can cause subtle distribution divergence at the boundary between accepted and rejected tokens. The draft at Q8 is *more precise* than the target at Q4 — it may accept tokens with high confidence that the target would assign lower probability to, leading to unexpected rejections. The counterintuitive recommendation is: quantize the draft at the same or lower precision than the target, not higher.

**6.2.7 n-gram Speculative Decoding and Repetition Loops**

The n-gram approach works by proposing continuations based on previously seen token sequences. If the model enters a repetition loop (a common LLM failure mode), n-gram speculation will aggressively reinforce the loop by always proposing the repeating pattern with high confidence — and the target will accept it because it has also entered the loop. This is a case where speculative decoding *accelerates a failure mode*. Repetition detection logic must be applied independently of, and before, speculative decoding.

**6.2.8 Multi-GPU vLLM Instance Sharing**

Running two separate vLLM processes on the same physical GPU is not reliably supported — each instance attempts to pre-allocate the full `gpu_memory_utilization` fraction of VRAM, and if launched simultaneously, they race for CUDA context initialization causing failures. Workaround: sequential launch with a delay. For locallama-mcp this matters if separate model instances are managed per subtask type.[^26]

**6.2.9 Speculative Decoding Batch Size Degradation**

Speculative decoding provides its greatest benefit at batch size 1 (interactive use) and diminishing returns as batch size grows. At batch size 16, Aurora-Spec on Qwen3-Coder-Next showed only 1.09× speedup. Since locallama-mcp typically dispatches one subtask at a time to a model endpoint, batch size 1 is the common case — but this must be confirmed if the architecture ever adds parallel dispatch to the same model endpoint.[^31]

**6.2.10 Code Patch Assembly and Prompt Compression Incompatibility**

The speculative prefill / prompt compression technique works by removing low-importance tokens from the context. For the final patch assembly phase (where locallama-mcp reassembles subtask outputs into a coherent result), prompt compression is *unsafe* — the exact function signatures, variable names, and import statements removed as "low importance" by the draft model's attention are the precise tokens that matter for structural correctness. This is consistent with the research finding that code debugging degrades most under aggressive compression.[^18]

**Recommendation**: Apply a hard rule — `specPrefill: false` for any subtask whose output will be directly inserted into code, or whose input is a code diff/patch.

***

## Part 7: Summary Recommendations

| Priority | Action | Risk | Gain |
|---|---|---|---|
| 1 | Enable APC on all model backends | Low | High — eliminates repeated system prompt prefill cost |
| 2 | Pin system prompt + tool schemas in canonical order | Low | Required for APC to work correctly |
| 3 | Enable n-gram speculative decoding for code tasks | Low | 1.2–1.5× decode speed, no memory cost |
| 4 | Apply config.json vocab patch to Qwen 0.5B/1.5B/3B models | Low | Unlocks smaller draft pairings |
| 5 | Add acceptance rate monitor; auto-disable spec decoding at α < 0.4 | Medium | Prevents hidden performance regression |
| 6 | Enable draft-model spec decoding for code generation tasks only | Medium | 1.4–2.0× decode speed for primary target |
| 7 | Implement speculative prefill for contexts > 8K tokens, code keep rate ≥ 20% | Medium | Significant TTFT reduction on large context subtasks |
| 8 | Disable spec decoding when temperature > 0.8 | Low | Prevents overhead-only use |
| 9 | Implement slot save/restore for APC persistence across server restarts | Medium | Eliminates cold-start penalty |
| 10 | Hard-disable prompt compression for patch assembly subtasks | Low | Prevents structural code corruption |

---

## References

1. [Tutorial: KV cache reuse with llama-server #13606](https://github.com/ggml-org/llama.cpp/discussions/13606) - This tutorial demonstrates how to use the slots management feature in llama-server to optimize repea...

2. [Automatic Prefix Caching - vLLM](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching.html) - Automatic Prefix Caching (APC in short) caches the KV cache of existing queries, so that a new query...

3. [Misc. bug: --cache-reuse no longer seems to be caching prompt ...](https://github.com/ggml-org/llama.cpp/issues/15082) - This is a re-open of #14113 Name and Version Affected: Version at commit: b7a1746 Not affected: Vers...

4. [[Feature]: Support to use draft models with different vocabulary sizes ...](https://github.com/vllm-project/vllm/issues/7252) - I propose adding an engine argument, such as --disable-vocab-check-for-spec-decoding, to allow the u...

5. [Qwen/Qwen1.5-72B-Chat · Why 72B model has different vocab size ...](https://huggingface.co/Qwen/Qwen1.5-72B-Chat/discussions/1) - The problem is that vLLM checks for vocab size and if it doesn't match, the speculative decoding is ...

6. [[Bug]: Speculative decoding inconsistency for Qwen-Coder-32B ...](https://github.com/vllm-project/vllm/issues/10913) - Speculative decoding for the Qwen-coder-32B using the 0.5B model does not work. However, using the 7...

7. [How to run speculative decoding of this model with 0.5B model.](https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct/discussions/18) - I get errors in vllm. First is that vocab_size is different. So in 0.5B in config.json I set vocab_s...

8. [speculative decoding silently broken for Qwen3.6 on the TurboQuant fork — PR to fix](https://www.reddit.com/r/LocalLLaMA/comments/1ss46dj/speculative_decoding_silently_broken_for_qwen36/) - speculative decoding silently broken for Qwen3.6 on the TurboQuant fork — PR to fix

9. [draft model not compatible with Qwen3 Coder - Hugging Face](https://huggingface.co/jukofyork/Qwen3-0.6B-YaRN-GGUF/discussions/1) - I'm using the ik_llama.cpp PR #645 for the speculative decoding. It works fine with your DeepSeek-R1...

10. [Speculative Decoding](https://docs.vllm.ai/en/stable/features/spec_decode.html)

11. [llama-swap/examples/speculative-decoding/README.md at main · mostlygeek/llama-swap](https://github.com/mostlygeek/llama-swap/blob/main/examples/speculative-decoding/README.md) - transparent proxy server for llama.cpp's server to provide automatic model swapping - mostlygeek/lla...

12. [Speculative Decoding - LM Studio](https://lmstudio.ai/docs/app/advanced/speculative-decoding) - Speculative decoding is a technique that can substantially increase the generation speed of large la...

13. [Introducing N-gram Speculative Decoding: Faster Inference for ...](https://friendli.ai/blog/n-gram-speculative-decoding) - We're excited to introduce N-gram Speculative Decoding, a new feature in Dedicated Endpoints that sp...

14. [Accelerating LLM Inference with Speculative Decoding for AI Agent ...](https://www.zenml.io/llmops-database/accelerating-llm-inference-with-speculative-decoding-for-ai-agent-applications) - N-gram speculative decoding (also known as prompt lookup decoding) is a model-agnostic, purely stati...

15. [Accelerated Test-Time Scaling with Model-Free Speculative Sampling](https://arxiv.org/html/2506.04708v1) - We introduce STAND (STochastic Adaptive N-gram Drafting), a novel model-free speculative decoding ap...

16. [Draft & Verify: Lossless Large Language Model Acceleration via Self ...](https://aclanthology.org/2024.acl-long.607/) - Jun Zhang, Jue Wang, Huan Li, Lidan Shou, Ke Chen, Gang Chen, Sharad Mehrotra. Proceedings of the 62...

17. [Toward Training-Aware Speculative Decoding](https://openreview.net/forum?id=CwvY6TXLxr) - Autoregressive (AR) decoding is a major latency bottleneck for large language models. Speculative de...

18. [Cross-Family Speculative Prefill: Training-Free Long-Context ... - arXiv](https://arxiv.org/html/2603.02631v1) - Using the same speculative prefill mechanism as prior work, we evaluate a range of cross-family draf...

19. [SpecOffload: Unlocking Latent GPU Capacity for LLM Inference on ...](https://arxiv.org/html/2505.10259v1) - To harnesses GPU compute and memory resources more efficiently, we design SpecOffload, a novel offlo...

20. [Development](https://docs.vllm.ai/en/v0.7.0/features/disagg_prefill.html)

21. [Disaggregated Prefilling (experimental)¶](https://docs.vllm.ai/en/stable/features/disagg_prefill.html)

22. [Balancing Memory & Compute: Strategies to Manage KV Cache in ...](https://www.aakashvarma.com/blog/kv_cache_optimization) - Techniques for Reducing the Memory Footprint of KV Caches Without Sacrificing Performance

23. [LLM Inference Series: 4. KV caching, a deeper look - Medium](https://medium.com/@plienhar/llm-inference-series-4-kv-caching-a-deeper-look-4ba9a77746c8) - In this post, we will look at how big the KV cache, a common optimization for LLM inference, can gro...

24. [Enabling `cache_prompt` on completion request fills KV cache quickly](https://github.com/ggml-org/llama.cpp/issues/4989) - llama.cpp version: 5c99960 When running the llama.cpp example server and sending requests with cache...

25. [Speculative Decoding - vLLM](https://docs.vllm.ai/en/v0.8.0/features/spec_decode.html)

26. [2 vllm containers on a single GPU - General](https://discuss.vllm.ai/t/2-vllm-containers-on-a-single-gpu/608) - I have a 16GB GPU which is enough to handle 2 instances of 8B models using vLLM. But when I try to d...

27. [Prefix cache reuse is broken for all hybrid-architecture models ...](https://github.com/ml-explore/mlx-lm/issues/980) - Prompt prefix caching — the mechanism that reuses computed KV states across requests sharing a commo...

28. [Optimization and Tuning - vLLM](https://docs.vllm.ai/en/v0.8.2/performance/optimization.html)

29. [Speculative decoding: how it works & when to use it - Redis](https://redis.io/blog/speculative-decoding-llm/) - Learn how speculative decoding speeds up LLM responses, when batch size works against it, and how it...

30. [Speculative Decoding](https://docs.vllm.ai/en/latest/features/spec_decode/)

31. [togethercomputer/Aurora-Spec-Qwen3-Coder-Next-FP8](https://huggingface.co/togethercomputer/Aurora-Spec-Qwen3-Coder-Next-FP8) - Speculative decoding still provides meaningful throughput improvements for moderate batching. Batch ...

