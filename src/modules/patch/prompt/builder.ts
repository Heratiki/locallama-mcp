import type { CheckResult, EditBlock } from '../types.js';
import { estimateTokens } from '../ladder/paid.js';
import { PATCH_SYSTEM_PROMPT } from './system.js';

export interface HintedFile {
  path: string;
  content: string;
}

export interface SearchHit {
  path: string;
  content: string;
}

export interface PromptInput {
  goal: string;
  /** 1-based attempt number. */
  attempt: number;
  hintedFiles?: HintedFile[];
  /** Checks from the last attempt only; attempt 2+. */
  lastChecks?: CheckResult[];
  /** Other last-attempt error text (apply or validator error). */
  lastErrorText?: string;
  /** Edit blocks of the last attempt only; attempt 2+. */
  lastBlocks?: EditBlock[];
  /** BM25 over the snapshot (CodeSearchEngine on the worktree). */
  search?: (query: string, topK: number) => Promise<SearchHit[]>;
  /** The model's context window in tokens. */
  modelContextWindow: number;
  /** PATCH_CONTEXT_TOKENS */
  contextTokens: number;
  /** PATCH_MAX_OUTPUT_TOKENS */
  maxOutputTokens: number;
  /** PATCH_ERROR_TAIL_TOKENS */
  errorTailTokens: number;
  searchTopK?: number;
}

export interface BuiltPrompt {
  system: string;
  prompt: string;
  /** Tokens available for the prompt (after output cap and system prompt). */
  budget: number;
  used: number;
}

export function formatBlock(b: EditBlock): string {
  if (b.whole_file) return `${b.path}\n\`\`\`\n${b.replace}${b.replace.endsWith('\n') ? '' : '\n'}\`\`\`\n`;
  const nl = (s: string) => (s === '' || s.endsWith('\n') ? s : s + '\n');
  return `${b.path}\n<<<<<<< SEARCH\n${nl(b.search)}=======\n${nl(b.replace)}>>>>>>> REPLACE\n`;
}

/** Keep the last `tokens` worth of text. */
function tailTokens(text: string, tokens: number): string {
  const chars = Math.max(0, tokens) * 4;
  return text.length <= chars ? text : text.slice(text.length - chars);
}

/** Cut text to fit `tokens`, keeping the start. */
function headTokens(text: string, tokens: number): string {
  const chars = Math.max(0, tokens) * 4;
  return text.length <= chars ? text : text.slice(0, chars);
}

/** Section with a header; returns null when even the header does not fit. */
function fit(header: string, body: string, remaining: number, note: string): string | null {
  const full = `${header}${body}\n`;
  if (estimateTokens(full) <= remaining) return full;
  const room = remaining - estimateTokens(header) - estimateTokens(note) - 2;
  if (room <= 0) return null;
  const out = `${header}${headTokens(body, room)}\n${note}\n`;
  return estimateTokens(out) <= remaining ? out : null;
}

/**
 * Build one attempt's prompt within the context budget (PRD 5.8). Fill order:
 * goal; hinted files; last errors and blocks (attempt 2+); BM25 results.
 */
export async function buildPrompt(input: PromptInput): Promise<BuiltPrompt> {
  const system = PATCH_SYSTEM_PROMPT;
  const window = Math.min(input.modelContextWindow, input.contextTokens);
  const budget = Math.max(0, window - input.maxOutputTokens - estimateTokens(system));
  let remaining = budget;
  const parts: string[] = [];
  const add = (s: string | null): boolean => {
    if (s === null) return false;
    parts.push(s);
    remaining -= estimateTokens(s);
    return true;
  };

  // 1. goal
  add(fit('## Goal\n', input.goal, remaining, '[goal cut]'));

  // 2. hinted files
  const seen = new Set<string>();
  for (const f of input.hintedFiles ?? []) {
    seen.add(f.path);
    add(fit(`## File: ${f.path}\n`, f.content, remaining, `[file cut: ${f.path}]`));
  }

  // 3. last errors and blocks (attempt 2+)
  if (input.attempt > 1) {
    const failed = (input.lastChecks ?? []).find(c => c.timed_out || c.exit_code !== 0);
    let errText = '';
    if (failed) {
      errText = `${failed.name}${failed.timed_out ? ' (timed out)' : ` (exit ${failed.exit_code})`}\n` +
        tailTokens(failed.tail, input.errorTailTokens);
    }
    if (input.lastErrorText) errText += `${errText ? '\n' : ''}${tailTokens(input.lastErrorText, input.errorTailTokens)}`;
    if (errText) add(fit('## Errors from your last attempt\n', errText, remaining, '[errors cut]'));

    const blocks = (input.lastBlocks ?? []).map(formatBlock);
    if (blocks.length > 0) {
      const header = '## Your last edit blocks\n';
      let body = '';
      for (const b of blocks) {
        if (estimateTokens(header + body + b + '\n') > remaining) break;
        body += b;
      }
      if (body) add(`${header}${body}\n`);
    }
  }

  // 4. BM25 results until full
  if (input.search && remaining > 50) {
    let hits: SearchHit[] = [];
    try {
      hits = await input.search(input.goal, input.searchTopK ?? 5);
    } catch {
      hits = [];
    }
    for (const h of hits) {
      if (remaining <= 50) break;
      if (seen.has(h.path)) continue;
      seen.add(h.path);
      add(fit(`## Related: ${h.path}\n`, h.content, remaining, `[cut: ${h.path}]`));
    }
  }

  const prompt = parts.join('\n');
  return { system, prompt, budget, used: estimateTokens(prompt) };
}
