import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as os from 'node:os';
import * as path from 'node:path';

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({
  config: { rootDir: os.tmpdir() },
}));
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { findReusedNote } = await import('../../../../dist/modules/patch/research/notes.js');
const db = await import('../../../../dist/modules/job-store/db.js');
const store = await import('../../../../dist/modules/job-store/research-store.js');

let dbPath = '';

/** Stored reason shape: rule line, then the redacted error signature lines. */
const reason = (signature: string) => `same_check:unit\n${signature}`;
const note = (over: Record<string, unknown> = {}) => ({
  job_id: 'job-old', attempt_n: 1, created_at: 1, repo_path: '/repos/app',
  reason: reason('unit\nexpected value TWO'), query: 'TS2339 expected value TWO',
  source: 'deps', info: 'Import the module before using it.', ...over,
});

async function insertHelped(over: Record<string, unknown> = {}): Promise<number> {
  const id = await store.insertResearchNote(note(over));
  await store.markResearchNotesHelped(String(over.job_id ?? 'job-old'), Number(over.attempt_n ?? 1), 1);
  return id;
}

const lookup = (signature: string, repoPath: string, queries: string[] = ['expected']) =>
  ({ signature, queries, repoPath });

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `research-notes-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
});
afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
});

describe('research note reuse (#155 criteria 12c, 12d, 12f, 12g, 12h)', () => {
  beforeEach(async () => { await db.initJobStore(); });

  it('a second task with the same error signature reuses the helped note through BM25', async () => {
    await insertHelped();
    // Fresh index in this process: it must rebuild from the table at first use.
    const helped = await store.getHelpedResearchNotes();
    const reused = await findReusedNote(helped, lookup('unit\nexpected value TWO', '/repos/other', ['TS2339', 'expected']));
    expect(reused).toBeDefined();
    expect(reused!.info).toBe('Import the module before using it.');
    expect(reused!.source).toBe('deps');
  });

  it('helped = 0 and NULL notes are never reused (#155 criterion 12d)', async () => {
    await store.insertResearchNote(note({ source: 'deps', helped: 0 }));
    await store.insertResearchNote(note({ source: 'searxng' })); // stays NULL (pending)
    const helped = await store.getHelpedResearchNotes();
    expect(helped).toHaveLength(0);
    expect(await findReusedNote(helped, lookup('unit\nexpected value TWO', '/repos/app'))).toBeUndefined();
  });

  it('an unrelated error signature does not reuse the note', async () => {
    await insertHelped();
    const helped = await store.getHelpedResearchNotes();
    expect(await findReusedNote(helped, lookup('lint\nunused variable zzzz', '/repos/app', ['zzzz']))).toBeUndefined();
  });

  it('shared-scope notes are reused from another repo (#155 criterion 12g)', async () => {
    for (const source of ['searxng', 'deps', 'pydoc', 'go doc', 'man']) {
      await insertHelped({ source, reason: reason(`unit\nexpected value ${source}`) });
    }
    const helped = await store.getHelpedResearchNotes();
    for (const source of ['searxng', 'deps', 'pydoc', 'go doc', 'man']) {
      const reused = await findReusedNote(helped, lookup(`unit\nexpected value ${source}`, '/repos/other-repo', ['expected']));
      expect(reused).toBeDefined();
      expect(reused!.source).toBe(source);
    }
  });

  it('repo-scope notes are reused only for the same repo_path (#155 criterion 12h)', async () => {
    await insertHelped({ source: 'repo', repo_path: '/repos/app', reason: reason('unit\nunique-flavor error'), query: 'unique-flavor' });
    const helped = await store.getHelpedResearchNotes();
    expect(await findReusedNote(helped, lookup('unit\nunique-flavor error', '/repos/app', ['unique-flavor']))).toBeDefined();
    expect(await findReusedNote(helped, lookup('unit\nunique-flavor error', '/repos/other', ['unique-flavor']))).toBeUndefined();
  });

  it('the index is rebuilt from the table after a restart (#155 criterion 12f)', async () => {
    await insertHelped({ source: 'searxng', reason: reason('unit\nrestart-flavor error'), query: 'restart-flavor' });
    await db.closeJobStore();
    await db.initJobStore();
    const helped = await store.getHelpedResearchNotes();
    const reused = await findReusedNote(helped, lookup('unit\nrestart-flavor error', '/repos/app', ['restart-flavor']));
    expect(reused).toBeDefined();
    expect(reused!.info).toBe('Import the module before using it.');
  });
});

it('S9 eviction and same-length replacement refresh the BM25 index', async () => {
  const { ResearchNotesIndex } = await import('../../../../dist/modules/cost-monitor/codeSearchEngine.js');
  const index = new ResearchNotesIndex();
  const item = (id: number, content: string) => ({ id, content, repoPath: '/repos/app', source: 'deps', path: `research-note:${id}` });
  await index.sync([item(1, 'obsolete')]);
  expect((await index.search('obsolete')).map(hit => hit.id)).toEqual([1]);
  // id + content.length collides (1 + 8 === 2 + 7).
  await index.sync([item(2, 'current')]);
  expect(await index.search('obsolete')).toEqual([]);
  expect((await index.search('current')).map(hit => hit.id)).toEqual([2]);
  // Same id and length, different content must also invalidate the index.
  await index.sync([item(2, 'updated')]);
  expect(await index.search('current')).toEqual([]);
  expect((await index.search('updated')).map(hit => hit.id)).toEqual([2]);
});

it('S10 ineligible repo notes cannot crowd eligible notes out of top-k', async () => {
  const foreign = Array.from({ length: 6 }, (_, i) => ({
    id: i + 100, repo_path: '/repos/foreign', source: 'repo',
    reason: reason('crowded widget failure'), query: 'crowded widget', info: 'crowded widget',
  }));
  const eligible = { id: 200, repo_path: '/repos/app', source: 'repo',
    reason: reason('crowded widget'), query: 'crowded widget', info: 'helpful docs ' + 'padding '.repeat(200) };
  const found = await findReusedNote([...foreign, eligible], lookup('crowded widget', '/repos/app', ['crowded', 'widget']));
  expect(found?.id).toBe(200);
});

it('S9 SQLite eviction and replacement are reflected in BM25 reuse', async () => {
  await db.initJobStore();
  const oldId = await insertHelped({ reason: reason('obsolete flavor'), query: 'flavor', info: 'guide', created_at: 1 });
  expect((await findReusedNote(await store.getHelpedResearchNotes(), lookup('obsolete flavor', '/repos/app', ['flavor'])))?.id).toBe(oldId);
  const newId = await insertHelped({ reason: reason('current flavor'), query: 'flavor', info: 'guide', created_at: 2 });
  expect(await store.enforceResearchNotesCap(1)).toEqual([oldId]);
  const rows = await store.getHelpedResearchNotes();
  expect(rows.map(row => row.id)).toEqual([newId]);
  expect((await findReusedNote(rows, lookup('current flavor', '/repos/app', ['flavor'])))?.id).toBe(newId);
  const { getResearchNotesIndex } = await import('../../../../dist/modules/cost-monitor/codeSearchEngine.js');
  expect(await getResearchNotesIndex().search('obsolete')).toEqual([]);
});
