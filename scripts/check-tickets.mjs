#!/usr/bin/env node
/**
 * check-tickets.mjs
 *
 * Purpose: Lint the header of every docs/tickets/T-NNN-slug.md against the
 * Status enum in docs/agents/ticket-format.md. The single `Status:` line
 * before the first `## ` heading must be one of open, in-progress, landed,
 * closed, wontfix, superseded, and carry the evidence its meaning needs:
 * in-progress needs a `Lane:` header; landed needs a lane branch or a 7+ hex
 * sha plus a YYYY-MM-DD date; closed / wontfix / superseded need a reason or
 * the superseding T-NNN / ADR-NNN. Output is `path:line: CODE message`;
 * exit 1 on any error.
 *
 * Usage:
 *   node scripts/check-tickets.mjs              # self-test, then lint docs/tickets
 *   node scripts/check-tickets.mjs <dir>        # lint another directory
 *   node scripts/check-tickets.mjs --self-test  # self-test only
 *
 * NOTE: Plain Node ESM (16+), no dependency. Ported from a project linter by
 * /bootstrap-orchestration. The built-in self-test runs before every lint, so
 * a broken checker fails loudly instead of passing bad tickets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

export const STATUS_VALUES = ['open', 'in-progress', 'landed', 'closed', 'wontfix', 'superseded'];

const FILE_RE = /^T-(\d{3,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const H1_RE = /^# T-(\d{3,}):/;
const LANE_RE = /\b(?:lane[-/][A-Za-z0-9._-]+|worktree-agent-[A-Za-z0-9]+)/;
const SHA_RE = /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;
const REF_RE = /\b(?:T|ADR)-\d{3,}\b/;
const KEY_LINE_RE = /^[A-Z][A-Za-z ]{0,30}:/;

function wordCount(text) {
  return text.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

/** Analyse one ticket. Returns [{ line, code, message }] (1-based lines). */
export function analyzeTicket(fileName, text) {
  const errors = [];
  const add = (line, code, message) => errors.push({ line, code, message });
  const lines = text.split('\n');

  let headerEnd = lines.findIndex((l) => l.startsWith('## '));
  if (headerEnd < 0) headerEnd = lines.length;

  const fm = FILE_RE.exec(fileName);
  const h1Idx = lines.findIndex((l) => l.startsWith('# '));
  const hm = h1Idx >= 0 ? H1_RE.exec(lines[h1Idx]) : null;
  if (!fm) {
    add(1, 'NAME-MISMATCH', `file name "${fileName}" is not T-NNN-slug.md`);
  } else if (!hm) {
    add(h1Idx >= 0 ? h1Idx + 1 : 1, 'NAME-MISMATCH', `H1 must start "# T-${fm[1]}:"`);
  } else if (Number(hm[1]) !== Number(fm[1])) {
    add(h1Idx + 1, 'NAME-MISMATCH', `H1 says T-${hm[1]} but the file is T-${fm[1]}`);
  }

  const statusIdx = [];
  for (let i = 0; i < headerEnd; i++) {
    if (lines[i].startsWith('Status:')) statusIdx.push(i);
  }
  if (statusIdx.length === 0) {
    add(1, 'NO-STATUS', 'no "Status:" line before the first "## " heading');
    return errors;
  }
  if (statusIdx.length > 1) {
    add(statusIdx[1] + 1, 'TWO-STATUS', `a second "Status:" line (first is line ${statusIdx[0] + 1})`);
  }

  const first = statusIdx[0];
  const lineNo = first + 1;
  const after = lines[first].slice('Status:'.length).trim();
  const vm = /^([a-z][a-z-]*)(?=$|[\s(.,;:])/.exec(after);
  const value = vm ? vm[1] : '';
  if (!STATUS_VALUES.includes(value)) {
    add(lineNo, 'BAD-STATUS', `"${after.split(/\s/)[0] || ''}" is not one of ${STATUS_VALUES.join(', ')}`);
    return errors;
  }

  const block = [after.slice(value.length)];
  for (let i = first + 1; i < headerEnd; i++) {
    if (lines[i].trim() === '' || KEY_LINE_RE.test(lines[i])) break;
    block.push(lines[i]);
  }
  const detail = block.join('\n');

  switch (value) {
    case 'in-progress':
      if (!lines.slice(0, headerEnd).some((l) => /^Lane:\s*\S/.test(l))) {
        add(lineNo, 'NO-LANE', 'in-progress needs a "Lane: <branch>" header before the first "## "');
      }
      break;
    case 'landed':
      if (!LANE_RE.test(detail) && !SHA_RE.test(detail)) {
        add(lineNo, 'LANDED-NO-REF', 'landed needs the lane branch or a 7+ hex commit sha in the detail');
      }
      if (!DATE_RE.test(detail)) add(lineNo, 'LANDED-NO-DATE', 'landed needs a YYYY-MM-DD date in the detail');
      break;
    case 'closed':
      if (wordCount(detail) < 3) add(lineNo, 'NO-REASON', 'closed needs the reason, or what closed it, in the detail');
      break;
    case 'wontfix':
    case 'superseded': {
      const ok = value === 'superseded' ? REF_RE.test(detail) : REF_RE.test(detail) || wordCount(detail) >= 3;
      if (!ok) {
        add(lineNo, 'NO-REASON', value === 'superseded'
          ? 'superseded must name the superseding T-NNN or ADR-NNN in the detail'
          : 'wontfix must give the reason (or a T-NNN / ADR-NNN) in the detail');
      }
      break;
    }
    default:
      break;
  }
  return errors;
}

/** One fixture per error code plus a passing fixture per Status value. */
export function selfTest() {
  const t = (status, extra = '') => `# T-001: x\n\n${status}\n${extra}\n## Body\n`;
  const cases = [
    ['T-001-x.md', t('Status: open'), []],
    ['T-001-x.md', t('Status: in-progress', 'Lane: lane/t001'), []],
    ['T-001-x.md', t('Status: landed (lane/t001, 2026-10-02)'), []],
    ['T-001-x.md', t('Status: landed (abc1234, 2026-10-02)'), []],
    ['T-001-x.md', t('Status: closed (folded into another ticket)'), []],
    ['T-001-x.md', t('Status: wontfix (not worth the cost)'), []],
    ['T-001-x.md', t('Status: superseded by T-002'), []],
    ['T-001-x.md', t('Status: Open'), ['BAD-STATUS']],
    ['T-001-x.md', t('Status: **open**'), ['BAD-STATUS']],
    ['T-001-x.md', t('Owner: me'), ['NO-STATUS']],
    ['T-001-x.md', t('Status: open', 'Status: landed (lane/t001, 2026-10-02)'), ['TWO-STATUS']],
    ['T-001-x.md', t('Status: in-progress'), ['NO-LANE']],
    ['T-001-x.md', t('Status: landed (2026-10-02)'), ['LANDED-NO-REF']],
    ['T-001-x.md', t('Status: landed (lane/t001)'), ['LANDED-NO-DATE']],
    ['T-001-x.md', t('Status: closed'), ['NO-REASON']],
    ['T-001-x.md', t('Status: superseded (newer plan)'), ['NO-REASON']],
    ['T-1-x.md', t('Status: open'), ['NAME-MISMATCH']],
    ['T-002-x.md', t('Status: open'), ['NAME-MISMATCH']],
  ];
  let fail = 0;
  for (const [name, text, want] of cases) {
    const got = analyzeTicket(name, text).map((e) => e.code);
    if (got.join(',') !== want.join(',')) {
      fail += 1;
      console.log(`self-test FAIL: ${name} ${JSON.stringify(text.split('\n')[2])} want [${want}] got [${got}]`);
    }
  }
  return fail;
}

function main() {
  const args = process.argv.slice(2);
  const failed = selfTest();
  if (failed > 0) {
    console.log(`check-tickets self-test: ${failed} case(s) failed`);
    process.exit(1);
  }
  if (args[0] === '--self-test') {
    console.log('OK: check-tickets self-test');
    return;
  }
  const dir = args[0] ? path.resolve(args[0]) : path.join(ROOT, 'docs', 'tickets');
  if (!fs.existsSync(dir)) {
    console.log(`no tickets directory: ${dir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  let bad = 0;
  for (const f of files) {
    const rel = path.relative(process.cwd(), path.join(dir, f));
    for (const e of analyzeTicket(f, fs.readFileSync(path.join(dir, f), 'utf8'))) {
      console.log(`${rel}:${e.line}: ${e.code} ${e.message}`);
      bad += 1;
    }
  }
  if (bad > 0) {
    console.log(`\n${bad} error(s) in ${files.length} tickets`);
    process.exit(1);
  }
  console.log(`OK: tickets (${files.length} files)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
