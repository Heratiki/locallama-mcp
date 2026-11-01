import type { EditBlock } from '../types.js';

export interface ParseResult {
  blocks: EditBlock[];
  /** Short, model-facing parse problems. */
  errors: string[];
}

const SEARCH_RE = /^<{5,9}\s*SEARCH\s*$/;
const DIVIDER_RE = /^={5,9}\s*$/;
const REPLACE_RE = /^>{5,9}\s*REPLACE\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

/** Same strip the coordinator and output validator use. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '');
}

/** Turn a line into a path candidate, or null when it is not path-like. */
function cleanPath(line: string | undefined): string | null {
  if (line === undefined) return null;
  const p = line.trim().replace(/^#+\s*/, '').replace(/[*`'"]/g, '').replace(/:$/, '').trim();
  if (!p || p.length > 200 || /\s/.test(p)) return null;
  if (SEARCH_RE.test(p) || DIVIDER_RE.test(p) || REPLACE_RE.test(p)) return null;
  return p;
}

/** The nearest earlier non-empty line that is not a fence line. */
function pathBefore(lines: string[], idx: number): string | null {
  for (let j = idx - 1; j >= 0; j--) {
    const l = lines[j];
    if (l.trim() === '') continue;
    if (FENCE_RE.test(l)) continue;
    return cleanPath(l);
  }
  return null;
}

const toText = (ls: string[]): string => (ls.length ? ls.join('\n') + '\n' : '');

/**
 * Parse model output into edit blocks. Never throws: bad output yields errors
 * and whatever blocks could be recovered.
 */
export function parseEditBlocks(raw: string): ParseResult {
  const lines = stripThink(raw).split(/\r?\n/);
  const blocks: EditBlock[] = [];
  const errors: string[] = [];
  let wrapped = false; // inside a fence that wraps search/replace blocks

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (SEARCH_RE.test(line.trim())) {
      const p = pathBefore(lines, i);
      let j = i + 1;
      const search: string[] = [];
      while (j < lines.length && !DIVIDER_RE.test(lines[j].trim()) &&
        !REPLACE_RE.test(lines[j].trim()) && !SEARCH_RE.test(lines[j].trim())) {
        search.push(lines[j]);
        j++;
      }
      if (j >= lines.length || !DIVIDER_RE.test(lines[j].trim())) {
        errors.push(`${p ?? '(no path)'}: block is missing the ======= divider`);
        i = j;
        continue;
      }
      j++;
      const replace: string[] = [];
      while (j < lines.length && !REPLACE_RE.test(lines[j].trim()) &&
        !SEARCH_RE.test(lines[j].trim())) {
        replace.push(lines[j]);
        j++;
      }
      if (j >= lines.length || !REPLACE_RE.test(lines[j].trim())) {
        errors.push(`${p ?? '(no path)'}: block is missing the >>>>>>> REPLACE end marker`);
        i = j;
        continue;
      }
      if (!p) {
        errors.push('block has no file path on the line before <<<<<<< SEARCH');
      } else {
        blocks.push({ path: p, search: toText(search), replace: toText(replace) });
      }
      i = j + 1;
      continue;
    }

    if (FENCE_RE.test(line)) {
      if (wrapped) {
        wrapped = false;
        i++;
        continue;
      }
      // Find the closing fence.
      let j = i + 1;
      while (j < lines.length && !FENCE_RE.test(lines[j])) j++;
      const closed = j < lines.length;
      const bodyEnd = closed ? j : lines.length;
      const body = lines.slice(i + 1, bodyEnd);
      if (body.some(l => SEARCH_RE.test(l.trim()))) {
        wrapped = true; // let the main loop parse the blocks inside
        i++;
        continue;
      }
      const p = pathBefore(lines, i);
      if (p) {
        if (!closed) {
          errors.push(`${p}: whole-file code fence is never closed`);
        } else {
          blocks.push({ path: p, search: '', replace: toText(body), whole_file: true });
        }
      }
      i = closed ? j + 1 : lines.length;
      continue;
    }

    i++;
  }

  return { blocks, errors };
}
