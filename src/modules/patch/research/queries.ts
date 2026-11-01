import { redactText, type RedactTerms } from './redact.js';

export type ResearchQueryKind = 'code' | 'module' | 'identifier';

export interface ResearchQuery {
  text: string;
  kind: ResearchQueryKind;
}

export interface BuildQueriesOptions extends RedactTerms {
  /** Cap on the number of queries; default 6. */
  max?: number;
}

/** Error codes such as TS2339, GH-12, E1101 (2-8 capitals, optional dash, 2-7 digits). */
const CODE_PATTERN = /\b[A-Z]{2,8}-?\d{2,7}\b/g;

/** Module/package extractions, in priority order. */
const MODULE_PATTERNS: RegExp[] = [
  /No module named '([^']+)'/g,
  /cannot import name '[^']+' from '([^']+)'/g,
  /cannot find package "([^"]+)"/g,
  /package "([^"]+)"/g,
  /\bfrom ([A-Za-z_][A-Za-z0-9_.]*) import/g,
  /\bimport ([A-Za-z_][A-Za-z0-9_.]*)/g,
  /\bundefined: ([A-Za-z_][A-Za-z0-9_.]*)/g,
];

const QUOTED_IDENTIFIER = /['"`]([A-Za-z_$][A-Za-z0-9_$]{1,60})['"`]/g;
const PLAIN_IDENTIFIER = /\b[A-Za-z_][A-Za-z0-9_]{2,60}\b/g;

const STOP_WORDS = new Set([
  'error', 'errors', 'property', 'properties', 'type', 'types', 'does', 'not', 'exist',
  'exists', 'cannot', 'find', 'found', 'module', 'modules', 'named', 'import', 'imports',
  'imported', 'undefined', 'defined', 'expected', 'actual', 'argument', 'arguments',
  'object', 'objects', 'attribute', 'method', 'function', 'class', 'return', 'returns',
  'statement', 'assign', 'assigned', 'assignment', 'missing', 'unknown', 'failed',
  'failure', 'build', 'compile', 'compiled', 'check', 'line', 'file', 'traceback',
  'most', 'recent', 'call', 'last', 'make', 'sure', 'correct', 'proper', 'package',
  'packages', 'value', 'values', 'version', 'constraint', 'index', 'length', 'name',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'are', 'have', 'has',
  // Placeholder names produced by redaction; never useful as queries.
  'path', 'paths', 'redacted', 'private', 'hex', 'time',
]);

/**
 * Build the capped, deterministic research query list (#155 criterion 3) from
 * the error signature and the touched file paths. Every query is redacted
 * (criterion 4) before it can leave the machine.
 */
export function buildQueries(errorText: string, files: string[] = [], options: BuildQueriesOptions = {}): ResearchQuery[] {
  const max = options.max ?? 6;
  const safe = redactText(errorText, options);
  const lines = safe.split(/\r?\n/).filter(line => line.trim() !== '');
  const queries: ResearchQuery[] = [];
  const seen = new Set<string>();
  const push = (text: string, kind: ResearchQueryKind): void => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 80 || trimmed.startsWith('<')) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push({ text: trimmed, kind });
  };

  // 1. error codes (most specific first)
  const head = lines.slice(0, 6).join('\n');
  for (const match of head.matchAll(CODE_PATTERN)) push(match[0], 'code');

  // 2. module names from the error text and python file paths
  for (const pattern of MODULE_PATTERNS) {
    for (const match of safe.matchAll(pattern)) push(match[1], 'module');
  }
  for (const file of files) {
    if (file.endsWith('.py')) push(file.replace(/\.py$/, '').replace(/\//g, '.'), 'module');
  }

  // 3. identifiers: quoted names first, then plain tokens from the first lines
  const focus = lines.slice(0, 3).join('\n');
  for (const match of focus.matchAll(QUOTED_IDENTIFIER)) push(match[1], 'identifier');
  for (const match of focus.matchAll(PLAIN_IDENTIFIER)) {
    if (!STOP_WORDS.has(match[0].toLowerCase())) push(match[0], 'identifier');
  }
  for (const file of files) {
    const base = file.split('/').pop() ?? file;
    push(base.replace(/\.[a-z0-9]+$/i, ''), 'identifier');
  }
  return queries.slice(0, max);
}
