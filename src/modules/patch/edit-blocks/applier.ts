import fs from 'node:fs';
import path from 'node:path';
import type { EditBlock, Workspace } from '../types.js';

export interface ApplyOptions {
  /** Whole-file output is allowed for new files and files below this many lines. */
  wholeFileMaxLines?: number;
}

export interface ApplyResult {
  ok: boolean;
  /** Workspace-relative paths written (empty when not ok). */
  files: string[];
  /** Short, model-facing errors. */
  errors: string[];
}

const DEFAULT_WHOLE_FILE_MAX_LINES = 150;

function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

/** Returns an error reason, or null when the path is acceptable. */
function checkPath(ws: Workspace, rel: string): string | null {
  if (!rel || rel.includes('\0')) return 'invalid path';
  const norm = rel.replace(/\\/g, '/');
  if (path.isAbsolute(norm) || /^[A-Za-z]:/.test(norm)) return 'path outside the worktree';
  const parts = norm.split('/').filter(p => p !== '' && p !== '.');
  if (parts.length === 0) return 'invalid path';
  if (parts.includes('..')) return 'path outside the worktree';
  if (parts.includes('.git')) return 'path in .git is refused';
  const joined = parts.join('/');
  for (const link of ws.links) {
    const l = link.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '');
    if (l && (joined === l || joined.startsWith(l + '/'))) return 'link path is refused';
  }
  // Any existing component that is a symlink is refused.
  let cur = ws.path;
  for (const part of parts) {
    cur = path.join(cur, part);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      break; // does not exist yet: nothing further to check
    }
    if (st.isSymbolicLink()) return 'link path is refused';
  }
  const abs = path.resolve(ws.path, joined);
  const rootAbs = path.resolve(ws.path);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return 'path outside the worktree';
  return null;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const ma = bigrams(a);
  const mb = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const v of ma.values()) total += v;
  for (const v of mb.values()) total += v;
  for (const [g, v] of ma) inter += Math.min(v, mb.get(g) ?? 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

const clip = (s: string): string => (s.length > 120 ? s.slice(0, 117) + '...' : s);

function nearestLines(fileLines: string[], search: string): string {
  const q = search.split('\n').map(l => l.trim()).find(l => l !== '') ?? '';
  const scored = fileLines
    .map((l, idx) => ({ idx, l, s: l.trim() === '' ? -1 : similarity(q, l.trim()) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.idx - b.idx)
    .slice(0, 3)
    .sort((a, b) => a.idx - b.idx);
  return scored.map(x => `  ${x.idx + 1}: ${clip(x.l)}`).join('\n');
}

const stripped = (l: string): string => l.trim();

/** Start line indexes where searchLines match fileLines ignoring indent and trailing space. */
function looseMatches(fileLines: string[], searchLines: string[]): number[] {
  const out: number[] = [];
  if (searchLines.length === 0) return out;
  const want = searchLines.map(stripped);
  for (let i = 0; i + want.length <= fileLines.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (stripped(fileLines[i + k]) !== want[k]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

function exactMatches(content: string, search: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = content.indexOf(search, from);
    if (at < 0) break;
    out.push(at);
    from = at + search.length;
  }
  return out;
}

/** Apply one search/replace to content. Returns new content or an error string. */
function applySearchReplace(rel: string, content: string, block: EditBlock): { text: string } | { error: string } {
  const exact = exactMatches(content, block.search);
  if (exact.length === 1) {
    const at = exact[0];
    return { text: content.slice(0, at) + block.replace + content.slice(at + block.search.length) };
  }
  const fileLines = content.split('\n');
  if (exact.length > 1) {
    const shown = exact.slice(0, 3).map(at => {
      const ln = content.slice(0, at).split('\n').length;
      return `  ${ln}: ${clip(fileLines[ln - 1])}`;
    });
    return { error: `${rel}: SEARCH text matches ${exact.length} places; add more context lines\n${shown.join('\n')}` };
  }

  const searchLines = block.search.split('\n');
  if (searchLines[searchLines.length - 1] === '') searchLines.pop();
  const loose = looseMatches(fileLines, searchLines);
  if (loose.length === 1) {
    const start = loose[0];
    const replLines = block.replace === '' ? [] : block.replace.replace(/\n$/, '').split('\n');
    const next = [...fileLines.slice(0, start), ...replLines, ...fileLines.slice(start + searchLines.length)];
    return { text: next.join('\n') };
  }
  if (loose.length > 1) {
    const shown = loose.slice(0, 3).map(i => `  ${i + 1}: ${clip(fileLines[i])}`);
    return { error: `${rel}: SEARCH text matches ${loose.length} places; add more context lines\n${shown.join('\n')}` };
  }
  return { error: `${rel}: SEARCH text not found. Nearest lines:\n${nearestLines(fileLines, block.search)}` };
}

/**
 * Apply edit blocks inside a workspace. All-or-nothing: if any block fails,
 * nothing is written.
 */
export function applyEditBlocks(ws: Workspace, blocks: EditBlock[], opts: ApplyOptions = {}): ApplyResult {
  const maxLines = opts.wholeFileMaxLines ?? DEFAULT_WHOLE_FILE_MAX_LINES;
  const errors: string[] = [];
  // Pending content per normalized rel path; null = file did not exist.
  const pending = new Map<string, string>();
  const order: string[] = [];

  for (const block of blocks) {
    const bad = checkPath(ws, block.path);
    if (bad) {
      errors.push(`${block.path}: ${bad}`);
      continue;
    }
    const rel = block.path.replace(/\\/g, '/').split('/').filter(p => p !== '' && p !== '.').join('/');
    const abs = path.join(ws.path, rel);

    let current: string | null;
    if (pending.has(rel)) {
      current = pending.get(rel) as string;
    } else if (fs.existsSync(abs)) {
      if (!fs.statSync(abs).isFile()) {
        errors.push(`${rel}: not a regular file`);
        continue;
      }
      current = fs.readFileSync(abs, 'utf8');
    } else {
      current = null;
    }

    if (block.whole_file) {
      if (current !== null && countLines(current) >= maxLines) {
        errors.push(`${rel}: whole-file output refused for a file of ${maxLines}+ lines; use SEARCH/REPLACE blocks`);
        continue;
      }
      if (!pending.has(rel)) order.push(rel);
      pending.set(rel, block.replace);
      continue;
    }

    if (block.search === '') {
      if (current !== null) {
        errors.push(`${rel}: SEARCH is empty but the file exists; give SEARCH text to edit it`);
        continue;
      }
      order.push(rel);
      pending.set(rel, block.replace);
      continue;
    }

    if (current === null) {
      errors.push(`${rel}: file does not exist; use an empty SEARCH to create it`);
      continue;
    }
    const res = applySearchReplace(rel, current, block);
    if ('error' in res) {
      errors.push(res.error);
      continue;
    }
    if (!pending.has(rel)) order.push(rel);
    pending.set(rel, res.text);
  }

  if (errors.length > 0) return { ok: false, files: [], errors };

  for (const rel of order) {
    const abs = path.join(ws.path, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, pending.get(rel) as string);
  }
  return { ok: true, files: order, errors: [] };
}
