import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as os from 'node:os';
import * as path from 'node:path';

jest.unstable_mockModule('../../../dist/config/index.js', () => ({
  config: { rootDir: os.tmpdir() },
}));
jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const db = await import('../../../dist/modules/job-store/db.js');
const store = await import('../../../dist/modules/job-store/research-store.js');

let dbPath = '';

const note = (over: Record<string, unknown> = {}) => ({
  job_id: 'job-1', attempt_n: 2, created_at: 100, repo_path: '/repos/app',
  reason: 'same_check:unit\nunit\nboom', query: 'TS2339 boom', source: 'repo',
  info: 'helpful text', ...over,
});

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `research-store-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env.JOB_DB_PATH = dbPath;
});
afterEach(async () => {
  await db.closeJobStore();
  delete process.env.JOB_DB_PATH;
});

describe('research_notes persistence (#155 criteria 12a, 12b, 12i, 12f)', () => {
  beforeEach(async () => { await db.initJobStore(); });

  it('creates the research_notes table next to patch_attempts', async () => {
    const tables = await db.getDbForPatchStore().all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('patch_attempts', 'research_notes')");
    expect(tables.map(t => t.name).sort()).toEqual(['patch_attempts', 'research_notes']);
  });

  it('inserts one row per query/source with helped NULL while pending (#155 criteria 12a, 12b)', async () => {
    const first = await store.insertResearchNote(note());
    await store.insertResearchNote(note({ query: 'boom fix', source: 'searxng' }));
    const rows = await store.getResearchNotesForJob('job-1');
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === first)).toMatchObject({
      job_id: 'job-1', attempt_n: 2, repo_path: '/repos/app', helped: null,
      reason: 'same_check:unit\nunit\nboom', query: 'TS2339 boom', source: 'repo', info: 'helpful text',
    });
    expect(rows.every(r => r.helped === null)).toBe(true);
  });

  it('helped becomes 1 when the using attempt passes all checks (#155 criterion 12b)', async () => {
    const id = await store.insertResearchNote(note());
    await store.markResearchNotesHelped('job-1', 2, 1);
    const row = (await store.getResearchNotesForJob('job-1')).find(r => r.id === id)!;
    expect(row.helped).toBe(1);
    expect((await store.getHelpedResearchNotes()).map(r => r.id)).toEqual([id]);
  });

  it('helped becomes 0 when the task ends without the attempt passing (#155 criterion 12b)', async () => {
    await store.insertResearchNote(note());
    await store.insertResearchNote(note({ attempt_n: 3 }));
    // Attempt 2 passed: its note is helped. The task then ended, so attempt 3's
    // still-pending note resolves to 0.
    await store.markResearchNotesHelped('job-1', 2, 1);
    await store.failPendingResearchNotes('job-1');
    const rows = await store.getResearchNotesForJob('job-1');
    expect(rows.find(r => r.attempt_n === 2)!.helped).toBe(1);
    expect(rows.find(r => r.attempt_n === 3)!.helped).toBe(0);
    // Only the passed attempt's note stays helped; the pending one resolved to 0.
    expect(await store.getHelpedResearchNotes()).toHaveLength(1);
  });

  it('failPendingResearchNotes resolves NULL rows to 0 on budget out, failure or cancel', async () => {
    await store.insertResearchNote(note());
    await store.failPendingResearchNotes('job-1');
    expect((await store.getResearchNotesForJob('job-1'))[0].helped).toBe(0);
  });

  it('marks only the pending rows of the given attempt', async () => {
    await store.insertResearchNote(note({ attempt_n: 2 }));
    await store.insertResearchNote(note({ attempt_n: 3, source: 'deps' }));
    await store.markResearchNotesHelped('job-1', 3, 1);
    const rows = await store.getResearchNotesForJob('job-1');
    expect(rows.find(r => r.attempt_n === 2)!.helped).toBeNull();
    expect(rows.find(r => r.attempt_n === 3)!.helped).toBe(1);
  });

  it('caps notes per scope, evicting the oldest first: note 501 evicts note 1 (#155 criterion 12i)', async () => {
    let firstId = -1;
    for (let i = 0; i < 501; i++) {
      const id = await store.insertResearchNote(note({ created_at: 1000 + i, query: `q${i}`, source: 'deps', job_id: `job-${i}` }));
      if (i === 0) firstId = id;
    }
    const evicted = await store.enforceResearchNotesCap(500);
    expect(evicted).toEqual([firstId]);
    const rows = await db.getDbForPatchStore().all<{ id: number }>('SELECT id FROM research_notes');
    expect(rows).toHaveLength(500);
    expect(rows.some(r => r.id === firstId)).toBe(false);
  });

  it('keeps the shared scope and each repo scope separate under the cap', async () => {
    for (let i = 0; i < 501; i++) {
      await store.insertResearchNote(note({ created_at: 2000 + i, query: `r${i}`, source: 'repo', repo_path: '/repos/a', job_id: `ja-${i}` }));
    }
    await store.insertResearchNote(note({ query: 'shared-1', source: 'pydoc', job_id: 'jx' }));
    const evicted = await store.enforceResearchNotesCap(500);
    expect(evicted).toHaveLength(1);
    const remaining = await db.getDbForPatchStore().all<{ repo_path: string; source: string }>('SELECT repo_path, source FROM research_notes');
    expect(remaining.filter(r => r.source === 'repo')).toHaveLength(500);
    expect(remaining.filter(r => r.source === 'pydoc')).toHaveLength(1);
  });

  it('notes persist across restarts (SQLite) (#155 criterion 12f)', async () => {
    await store.insertResearchNote(note({ helped: 1 }));
    await store.markResearchNotesHelped('job-1', 2, 1);
    await db.closeJobStore();
    await db.initJobStore();
    const rows = await store.getResearchNotesForJob('job-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].helped).toBe(1);
  });
});
