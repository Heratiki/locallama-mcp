/**
 * Reads ~/.locallama/telemetry.jsonl and computes actionable summaries that
 * help improve model selection, routing, and prompting decisions.
 */
import fs from 'fs';
import readline from 'readline';
import { TELEMETRY_FILE } from './file-exporter.js';
import type { TelemetrySpanRecord } from './file-exporter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModelStats {
  count: number;
  totalDurationMs: number;
  p50Ms: number;
  p95Ms: number;
  errorCount: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostUsd: number;
  qualityScores: number[];
  avgQualityScore?: number;
}

interface FlowStats {
  count: number;
  totalDurationMs: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errorCount: number;
  errorRate: number;
}

export interface TelemetrySummary {
  generatedAt: string;
  periodHours: number;
  spanCount: number;
  llmCalls: {
    total: number;
    byModel: Record<string, {
      count: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      errorRate: number;
      totalPromptTokens: number;
      totalCompletionTokens: number;
      totalCostUsd: number;
      avgQualityScore?: number;
    }>;
    byProvider: Record<string, {
      count: number;
      avgLatencyMs: number;
      errorRate: number;
    }>;
  };
  flows: Record<string, {
    count: number;
    avgDurationMs: number;
    p95DurationMs: number;
    errorRate: number;
  }>;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

async function readSpans(lookbackMs: number): Promise<TelemetrySpanRecord[]> {
  const cutoff = Date.now() - lookbackMs;
  const spans: TelemetrySpanRecord[] = [];

  try {
    await fs.promises.access(TELEMETRY_FILE);
  } catch {
    return spans; // file not yet created
  }

  await new Promise<void>((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(TELEMETRY_FILE, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const rec = JSON.parse(line) as TelemetrySpanRecord;
        if (rec.startTimeMs >= cutoff) spans.push(rec);
      } catch {
        // skip malformed lines
      }
    });
    rl.on('close', resolve);
    rl.on('error', reject);
  });

  return spans;
}

// ---------------------------------------------------------------------------
// Main analytics function
// ---------------------------------------------------------------------------

export async function computeTelemetrySummary(
  lookbackHours = 168,
): Promise<TelemetrySummary> {
  const lookbackMs = lookbackHours * 60 * 60 * 1000;
  const spans = await readSpans(lookbackMs);

  // LLM call spans carry model.id and provider.id attributes
  const llmSpans = spans.filter((s) => s.name === 'provider.execute_task');

  // Per-model accumulation
  const modelMap = new Map<string, {
    durations: number[];
    errors: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    qualityScores: number[];
  }>();

  // Per-provider accumulation
  const providerMap = new Map<string, { durations: number[]; errors: number }>();

  for (const s of llmSpans) {
    const modelId = String(s.attributes['model.id'] ?? 'unknown');
    const providerId = String(s.attributes['model.provider'] ?? 'unknown');
    const isError = s.status === 'ERROR';

    // model
    if (!modelMap.has(modelId)) {
      modelMap.set(modelId, {
        durations: [],
        errors: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        qualityScores: [],
      });
    }
    const ms = modelMap.get(modelId)!;
    ms.durations.push(s.durationMs);
    if (isError) ms.errors++;
    ms.promptTokens += Number(s.attributes['llm.prompt_tokens'] ?? 0);
    ms.completionTokens += Number(s.attributes['llm.completion_tokens'] ?? 0);
    ms.costUsd += Number(s.attributes['llm.cost_usd'] ?? 0);
    const qs = s.attributes['quality.score'];
    if (typeof qs === 'number') ms.qualityScores.push(qs);

    // provider
    if (!providerMap.has(providerId)) {
      providerMap.set(providerId, { durations: [], errors: 0 });
    }
    const ps = providerMap.get(providerId)!;
    ps.durations.push(s.durationMs);
    if (isError) ps.errors++;
  }

  // Per-flow accumulation (non-LLM spans that represent pipeline stages)
  const FLOW_SPANS = new Set([
    'mcp.route_task',
    'mcp.preemptive_route_task',
    'mcp.benchmark_model',
    'mcp.benchmark_task',
    'mcp.benchmark_tasks',
    'decision_engine.decompose',
    'decision_engine.analyze_complexity',
    'decision_engine.execute_subtask',
    'decision_engine.integrate_results',
    'benchmark.run_category',
    'benchmark.run_task',
    'routing.select_model',
  ]);

  const flowMap = new Map<string, { durations: number[]; errors: number }>();
  for (const s of spans) {
    if (!FLOW_SPANS.has(s.name)) continue;
    if (!flowMap.has(s.name)) flowMap.set(s.name, { durations: [], errors: 0 });
    const f = flowMap.get(s.name)!;
    f.durations.push(s.durationMs);
    if (s.status === 'ERROR') f.errors++;
  }

  // Build byModel output
  const byModel: TelemetrySummary['llmCalls']['byModel'] = {};
  for (const [modelId, m] of modelMap) {
    const sorted = [...m.durations].sort((a, b) => a - b);
    byModel[modelId] = {
      count: m.durations.length,
      avgLatencyMs: Math.round(avg(m.durations)),
      p95LatencyMs: Math.round(percentile(sorted, 95)),
      errorRate: m.durations.length > 0 ? m.errors / m.durations.length : 0,
      totalPromptTokens: m.promptTokens,
      totalCompletionTokens: m.completionTokens,
      totalCostUsd: Math.round(m.costUsd * 1e6) / 1e6,
      ...(m.qualityScores.length > 0
        ? { avgQualityScore: Math.round(avg(m.qualityScores) * 1000) / 1000 }
        : {}),
    };
  }

  // Build byProvider output
  const byProvider: TelemetrySummary['llmCalls']['byProvider'] = {};
  for (const [providerId, p] of providerMap) {
    byProvider[providerId] = {
      count: p.durations.length,
      avgLatencyMs: Math.round(avg(p.durations)),
      errorRate: p.durations.length > 0 ? p.errors / p.durations.length : 0,
    };
  }

  // Build flows output
  const flows: TelemetrySummary['flows'] = {};
  for (const [name, f] of flowMap) {
    const sorted = [...f.durations].sort((a, b) => a - b);
    flows[name] = {
      count: f.durations.length,
      avgDurationMs: Math.round(avg(f.durations)),
      p95DurationMs: Math.round(percentile(sorted, 95)),
      errorRate: f.durations.length > 0 ? f.errors / f.durations.length : 0,
    };
  }

  // Derive recommendations
  const recommendations: string[] = [];

  // Find slowest model vs fastest
  const sortedByLatency = Object.entries(byModel)
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].avgLatencyMs - a[1].avgLatencyMs);

  if (sortedByLatency.length >= 2) {
    const [slowId, slowStats] = sortedByLatency[0];
    const [fastId, fastStats] = sortedByLatency[sortedByLatency.length - 1];
    if (slowStats.avgLatencyMs > fastStats.avgLatencyMs * 2) {
      recommendations.push(
        `Model '${slowId}' averages ${slowStats.avgLatencyMs}ms vs '${fastId}' at ${fastStats.avgLatencyMs}ms — consider routing simple tasks to the faster model`,
      );
    }
  }

  // High error rate models
  for (const [modelId, stats] of Object.entries(byModel)) {
    if (stats.count >= 5 && stats.errorRate > 0.1) {
      recommendations.push(
        `Model '${modelId}' has a ${(stats.errorRate * 100).toFixed(1)}% error rate over ${stats.count} calls — review provider stability or context window limits`,
      );
    }
  }

  // Quality score spread
  const withQuality = Object.entries(byModel)
    .filter(([, v]) => v.avgQualityScore !== undefined && v.count >= 3)
    .sort((a, b) => (b[1].avgQualityScore ?? 0) - (a[1].avgQualityScore ?? 0));
  if (withQuality.length >= 2) {
    const [bestId, bestStats] = withQuality[0];
    const [worstId, worstStats] = withQuality[withQuality.length - 1];
    if ((bestStats.avgQualityScore ?? 0) - (worstStats.avgQualityScore ?? 0) > 0.15) {
      recommendations.push(
        `Quality: '${bestId}' scores ${bestStats.avgQualityScore?.toFixed(2)} vs '${worstId}' at ${worstStats.avgQualityScore?.toFixed(2)} — prefer '${bestId}' for quality-sensitive tasks`,
      );
    }
  }

  // Slow decomposition
  const decompFlow = flows['decision_engine.decompose'];
  if (decompFlow && decompFlow.avgDurationMs > 15000) {
    recommendations.push(
      `Task decomposition averages ${(decompFlow.avgDurationMs / 1000).toFixed(1)}s — consider caching decomposition results for repeated task patterns`,
    );
  }

  // Provider error comparison
  const providerEntries = Object.entries(byProvider).filter(([, v]) => v.count >= 5);
  const remoteProviders = providerEntries.filter(([id]) => id === 'openrouter');
  const localProviders = providerEntries.filter(([id]) => id !== 'openrouter');
  if (remoteProviders.length > 0 && localProviders.length > 0) {
    const remoteErr = avg(remoteProviders.map(([, v]) => v.errorRate));
    const localErr = avg(localProviders.map(([, v]) => v.errorRate));
    if (remoteErr > localErr * 3 && remoteErr > 0.05) {
      recommendations.push(
        `Remote provider error rate (${(remoteErr * 100).toFixed(1)}%) is significantly higher than local (${(localErr * 100).toFixed(1)}%) — local models may be more reliable for current workloads`,
      );
    }
  }

  if (recommendations.length === 0 && spans.length > 0) {
    recommendations.push('System operating normally — no significant anomalies detected in this period.');
  } else if (spans.length === 0) {
    recommendations.push('No telemetry data yet. Run some tasks and call this tool again.');
  }

  return {
    generatedAt: new Date().toISOString(),
    periodHours: lookbackHours,
    spanCount: spans.length,
    llmCalls: {
      total: llmSpans.length,
      byModel,
      byProvider,
    },
    flows,
    recommendations,
  };
}
