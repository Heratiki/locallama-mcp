import * as os from 'node:os';
import * as path from 'node:path';
import { countTokens } from '../../utils/tokenCount.js';
import type { ResearchRecord, ResearchSourceKind, ResearchSourceRun } from '../types.js';
export type { StuckAttempt, StuckResult } from './detect.js';
export { detectStuck } from './detect.js';
export { buildQueries } from './queries.js';
export type { ResearchQuery, ResearchQueryKind } from './queries.js';
export { redactText, normalizeSignatureText } from './redact.js';
export { probeSearxng, searchSearxng, resetSearxngProbeCache } from './searxng.js';
export type { SearxngProbeState, SearxngResult, FetchLike } from './searxng.js';
export {
  detectLanguage, repoAdapter, depsAdapter, pydocAdapter, goDocAdapter, manAdapter, cManAdapter, shellHelpAdapter,
  searxngAdapter, runTool, ToolMissingError,
} from './sources.js';
export { explainAdapter, explainCommands } from './explain.js';
export { stackexchangeAdapter, resetStackexchangeState } from './stackexchange.js';
export type { ResearchLanguage, ResearchSourceAdapter, ResearchSourceContext, SourceText } from './sources.js';
export { findReusedNote } from './notes.js';
export type { ReusableNote, ReuseLookup } from './notes.js';
import type { StuckResult } from './detect.js';
import type { RedactTerms } from './redact.js';
import { buildQueries, type ResearchQuery } from './queries.js';
import { probeSearxng, type FetchLike } from './searxng.js';
import { explainAdapter, explainCommands } from './explain.js';
import { stackexchangeAdapter } from './stackexchange.js';
import {
  detectLanguage, depsAdapter, goDocAdapter, manAdapter, cManAdapter, shellHelpAdapter, pydocAdapter, repoAdapter, searxngAdapter,
  ToolMissingError, type ResearchSourceAdapter, type ResearchSourceContext,
} from './sources.js';
import { findReusedNote, type ReusableNote } from './notes.js';
import { redactText } from './redact.js';

export interface ResearchLimits {
  /** PATCH_RESEARCH_SEARXNG_URL; empty means research is off (ruling 3). */
  searxngUrl: string;
  /** PATCH_RESEARCH_SOURCE_TIMEOUT_MS, applied to SearXNG too (criterion 10). */
  sourceTimeoutMs: number;
  /** PATCH_RESEARCH_TOKENS; 0 turns research off (criterion 11). */
  tokens: number;
  /** PATCH_RESEARCH_NOTES_MAX per scope (criterion 12i). */
  notesMax: number;
  /** Top N SearXNG results to keep (criterion 5). */
  searxngResults?: number;
  /**
   * Stack Exchange API source (#163). Present = on (PATCH_RESEARCH_STACKEXCHANGE),
   * absent = off. `key` is the optional app key.
   */
  stackexchange?: { key?: string };
}

export interface RunResearchInput extends RedactTerms {
  jobId: string;
  /** The attempt that will use the research (rows are written for it). */
  attemptN: number;
  repoPath: string;
  workspacePath: string;
  stuck: StuckResult;
  /** Touched file paths of the last attempt. */
  files: string[];
  repoSearch: (query: string, topK: number) => Promise<{ path: string; content: string }[]>;
  /** Every helped=1 note, loaded from the research_notes table. */
  helpedNotes: ReusableNote[];
  limits: ResearchLimits;
  now?: () => number;
  fetchImpl?: FetchLike;
}

/** research_notes row to insert; the worker owns the store seam. */
export interface ResearchNoteInsert {
  job_id: string;
  attempt_n: number;
  created_at: number;
  repo_path: string;
  reason: string;
  query: string;
  source: ResearchSourceKind;
  info: string;
  helped: null;
}

export interface ResearchOutcome {
  /** False when research is off for this run (no URL, zero budget, SearXNG 403). */
  enabled: boolean;
  block: string;
  record: ResearchRecord;
  inserts: ResearchNoteInsert[];
  /** Info ranges in the uncut assembly, in the same order as inserts. */
  insertSpans?: { start: number; end: number }[];
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

function homeBasename(): string | undefined {
  return process.env.HOME ? path.basename(process.env.HOME) : undefined;
}

/** Prefix of text that fits `tokens` (binary search on the cheap estimator). */
function headCut(text: string, tokens: number): string {
  if (tokens <= 0 || !text) return '';
  const maxChars = Math.min(text.length, tokens * 16); // a token is rarely over 16 chars
  if (countTokens(text.slice(0, maxChars)) <= tokens) return text.slice(0, maxChars);
  let lo = 0;
  let hi = maxChars;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (countTokens(text.slice(0, mid)) <= tokens) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

/** Whole lines while the token budget holds, else a head-cut of the first part. */
function assembleBlock(parts: string[], tokens: number): string {
  if (tokens <= 0 || parts.length === 0) return '';
  const lines = parts.join('\n\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (countTokens([...kept, line].join('\n')) > tokens) break;
    kept.push(line);
  }
  if (kept.length === 0) return headCut(lines[0] ?? '', tokens);
  return kept.join('\n').trim();
}

function raced<T>(work: Promise<T>, ms: number): Promise<{ value?: T; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    work.then(
      value => { clearTimeout(timer); resolve({ value, timedOut: false }); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function runAdapter(
  adapter: ResearchSourceAdapter, query: ResearchQuery, ctx: ResearchSourceContext,
  limits: ResearchLimits, terms: RedactTerms,
): Promise<ResearchSourceRun> {
  // Grace beyond the per-source limit: tool and fetch adapters kill themselves
  // at the limit; the race only guards in-process work that cannot cancel.
  const { value, timedOut } = await raced(adapter.run(query, ctx), limits.sourceTimeoutMs + 750);
  if (timedOut) return { source: adapter.source, query: query.text, status: 'timed_out' };
  if (!value) return { source: adapter.source, query: query.text, status: 'skipped', detail: 'no result' };
  if (value.timedOut) return { source: adapter.source, query: query.text, status: 'timed_out' };
  if (value.skipped) return { source: adapter.source, query: query.text, status: 'skipped', detail: value.skipped };
  const info = value.text ? redactText(value.text, terms) : '';
  return info
    ? { source: adapter.source, query: query.text, status: 'ran', info }
    : { source: adapter.source, query: query.text, status: 'ran' };
}

function firstOfKind(queries: ResearchQuery[], kind: ResearchQuery['kind']): ResearchQuery | undefined {
  return queries.find(query => query.kind === kind);
}

/**
 * Harness-driven research for a stuck grind loop (#155). Order on a stuck
 * event: (1) a helped note that matches by BM25 goes into the prompt and the
 * SearXNG and local searches are skipped; (2) otherwise run the sources of
 * rulings 1 and 3 — repo BM25, dependency docs, pydoc/go doc/man by language,
 * and the configured SearXNG — each under its own timeout, and assemble a
 * block inside PATCH_RESEARCH_TOKENS.
 */
export async function runResearch(input: RunResearchInput): Promise<ResearchOutcome> {
  const now = input.now ?? Date.now;
  const limits = input.limits;
  const off = (): ResearchOutcome => ({
    enabled: false,
    block: '',
    record: { schema: 'patch_research_v1', reason: '', queries: [], sources: [], block: '' },
    inserts: [],
  });
  // Ruling 3 + criteria 1 and 11: off unless a SearXNG URL is configured and
  // the token budget is positive.
  if (!limits.searxngUrl || limits.tokens <= 0) return off();

  const privateTerms = [...(input.privateTerms ?? []), path.basename(input.repoPath), homeBasename()].filter(Boolean) as string[];
  const terms: RedactTerms = { privateTerms };
  const queries = buildQueries(input.stuck.errorText, input.files, terms);
  const signature = redactText(input.stuck.signature, terms);
  const record: ResearchRecord = {
    schema: 'patch_research_v1',
    reason: redactText(`${input.stuck.reason}\n${signature}`, terms),
    queries: queries.map(query => query.text),
    sources: [],
    block: '',
  };

  // 1. reuse a helped note (criterion 12c): zero SearXNG requests, no local
  // sources, no new rows.
  const reused = await findReusedNote(input.helpedNotes, { signature, queries: record.queries, repoPath: input.repoPath });
  if (reused) {
    record.reusedNoteId = reused.id;
    record.sources.push({
      source: reused.source as ResearchSourceKind,
      query: reused.query,
      status: 'ran',
      detail: `reused research note #${reused.id}`,
      info: reused.info ?? undefined,
    });
    record.block = headCut(reused.info ?? '', limits.tokens);
    return { enabled: true, block: record.block, record, inserts: [] };
  }

  // 2. probe the instance at first web use (criterion 6): a 403 on
  // format=json disables research for the run; a down or timed-out instance
  // only skips the web source.
  const probe = await probeSearxng(limits.searxngUrl, limits.sourceTimeoutMs, input.fetchImpl);
  if (probe === 'disabled') return off();

  // 2. run the sources: local first, SearXNG when the probe passed.
  const language = detectLanguage(input.stuck.errorText);
  const plan: { adapter: ResearchSourceAdapter; query: ResearchQuery | undefined }[] = [
    { adapter: repoAdapter, query: queries[0] },
    { adapter: depsAdapter, query: queries[0] },
    ...(language === 'python' ? [{ adapter: pydocAdapter, query: firstOfKind(queries, 'module') ?? queries[0] }] : []),
    ...(language === 'go' ? [{ adapter: goDocAdapter, query: firstOfKind(queries, 'module') ?? queries[0] }] : []),
    ...(language === 'unknown' ? [{ adapter: manAdapter, query: firstOfKind(queries, 'identifier') ?? queries[0] }] : []),
    ...(language === 'c' ? [{ adapter: cManAdapter, query: firstOfKind(queries, 'identifier') ?? queries[0] }] : []),
    ...(language === 'shell' ? [{ adapter: shellHelpAdapter, query: firstOfKind(queries, 'identifier') ?? queries[0] }] : []),
    // Offline explain commands for error codes in the failing output (#163).
    ...(explainCommands(input.stuck.errorText).length > 0 ? [{ adapter: explainAdapter, query: queries[0] ?? { text: 'explain', kind: 'code' as const } }] : []),
    ...(limits.stackexchange ? [{ adapter: stackexchangeAdapter, query: queries[0] }] : []),
    ...(probe === 'ok' ? [{ adapter: searxngAdapter, query: queries[0] }] : []),
  ];
  const ctx: ResearchSourceContext = {
    workspacePath: input.workspacePath,
    repoSearch: input.repoSearch,
    timeoutMs: limits.sourceTimeoutMs,
    errorText: input.stuck.errorText,
    jobId: input.jobId,
    ...(limits.stackexchange ? { stackexchange: { key: limits.stackexchange.key, fetchImpl: input.fetchImpl } } : {}),
    ...(probe === 'ok' ? {
      searxng: { url: limits.searxngUrl, results: limits.searxngResults ?? 3, fetchImpl: input.fetchImpl },
    } : {}),
  };
  const contributions: string[] = [];
  for (const item of plan) {
    if (!item.query) continue;
    let run: ResearchSourceRun;
    try {
      run = await runAdapter(item.adapter, item.query, ctx, limits, terms);
    } catch (error) {
      // A missing tool is a skip, not a failure (criterion 9); anything else
      // is recorded and the remaining sources still run (criterion 10).
      run = error instanceof ToolMissingError
        ? { source: item.adapter.source, query: item.query.text, status: 'skipped', detail: 'tool_missing' }
        : { source: item.adapter.source, query: item.query.text, status: 'error', detail: redactText(message(error), terms) };
    }
    record.sources.push(run);
    if (run.status === 'ran' && run.info) contributions.push(`[${run.source}] ${run.query}\n${run.info}`);
  }
  record.block = assembleBlock(contributions, limits.tokens);

  // One row per query/source that returned information (criterion 12a).
  let offset = 0;
  const insertSpans: { start: number; end: number }[] = [];
  const inserts: ResearchNoteInsert[] = record.sources
    .filter(run => run.status === 'ran' && run.info)
    .map(run => {
      const start = offset + `[${run.source}] ${run.query}\n`.length;
      const end = start + run.info!.length;
      insertSpans.push({ start, end });
      offset = end + 2; // blank line separating contributions
      return {
        job_id: input.jobId,
        attempt_n: input.attemptN,
        created_at: now(),
        repo_path: input.repoPath,
        reason: record.reason,
        query: run.query,
        source: run.source,
        info: run.info!,
        helped: null,
      };
    });
  return { enabled: true, block: record.block, record, inserts, insertSpans };
}
