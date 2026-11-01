import { getDbForPatchStore } from './db.js';

/** research_notes row (#155 ruling 5). helped: 1, 0, or NULL while pending. */
export interface ResearchNoteRow {
  id: number;
  job_id: string;
  attempt_n: number;
  created_at: number;
  repo_path: string;
  reason: string;
  query: string;
  source: string;
  info: string | null;
  helped: 1 | 0 | null;
}

export type ResearchNoteInsert = Omit<ResearchNoteRow, 'id' | 'helped'> & { helped?: 1 | 0 | null };

/** Sources shared across repos; 'repo' is the only repo-scoped source (12g/12h). */
export const SHARED_RESEARCH_SOURCES = ['searxng', 'deps', 'pydoc', 'go doc', 'man'] as const;

export async function insertResearchNote(note: ResearchNoteInsert): Promise<number> {
  const result = await getDbForPatchStore().run(
    `INSERT INTO research_notes (job_id, attempt_n, created_at, repo_path, reason, query, source, info, helped)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [note.job_id, note.attempt_n, note.created_at, note.repo_path, note.reason, note.query, note.source,
      note.info ?? null, note.helped ?? null],
  );
  return Number(result.lastID);
}

export async function getResearchNotesForJob(jobId: string): Promise<ResearchNoteRow[]> {
  return getDbForPatchStore().all<ResearchNoteRow[]>(
    'SELECT * FROM research_notes WHERE job_id = ? ORDER BY id ASC',
    [jobId],
  );
}

export async function getResearchNotesForAttempt(jobId: string, attemptN: number): Promise<ResearchNoteRow[]> {
  return getDbForPatchStore().all<ResearchNoteRow[]>(
    'SELECT * FROM research_notes WHERE job_id = ? AND attempt_n = ? ORDER BY id ASC',
    [jobId, attemptN],
  );
}

/** The BM25 reuse pool: only helped = 1 notes are ever reused (12c/12d). */
export async function getHelpedResearchNotes(): Promise<ResearchNoteRow[]> {
  return getDbForPatchStore().all<ResearchNoteRow[]>(
    'SELECT * FROM research_notes WHERE helped = 1 ORDER BY id ASC',
  );
}

/**
 * Resolve the pending notes one attempt used: 1 when that attempt passed all
 * checks, 0 otherwise. Only NULL rows change (12b).
 */
export async function markResearchNotesHelped(jobId: string, attemptN: number, helped: 1 | 0): Promise<number> {
  const result = await getDbForPatchStore().run(
    'UPDATE research_notes SET helped = ? WHERE job_id = ? AND attempt_n = ? AND helped IS NULL',
    [helped, jobId, attemptN],
  );
  return result.changes ?? 0;
}

/**
 * Terminal resolution (12b): every still-pending note of the job becomes 0 —
 * the task ended (budget out, failed, cancelled) without the using attempt
 * passing.
 */
export async function failPendingResearchNotes(jobId: string): Promise<number> {
  const result = await getDbForPatchStore().run(
    'UPDATE research_notes SET helped = 0 WHERE job_id = ? AND helped IS NULL',
    [jobId],
  );
  return result.changes ?? 0;
}

async function evictOldest(where: string, params: unknown[], max: number): Promise<number[]> {
  const db = getDbForPatchStore();
  const count = await db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM research_notes WHERE ${where}`, params);
  const overflow = (count?.total ?? 0) - max;
  if (overflow <= 0) return [];
  const oldest = await db.all<{ id: number }[]>(
    `SELECT id FROM research_notes WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT ?`,
    [...params, overflow],
  );
  if (oldest.length === 0) return [];
  await db.run(
    `DELETE FROM research_notes WHERE id IN (${oldest.map(() => '?').join(',')})`,
    oldest.map(row => row.id),
  );
  return oldest.map(row => row.id);
}

/**
 * Notes cap (#155 criterion 12i): PATCH_RESEARCH_NOTES_MAX per scope — one
 * shared scope for SHARED_RESEARCH_SOURCES and one per repo_path for 'repo'
 * notes. Oldest removed first, from the table (the BM25 index rebuilds from
 * the table at its next use). Returns the evicted ids.
 */
export async function enforceResearchNotesCap(notesMax: number): Promise<number[]> {
  const shared = await evictOldest(
    `source IN (${SHARED_RESEARCH_SOURCES.map(() => '?').join(',')})`,
    [...SHARED_RESEARCH_SOURCES],
    notesMax,
  );
  const db = getDbForPatchStore();
  const groups = await db.all<{ repo_path: string; total: number }[]>(
    `SELECT repo_path, COUNT(*) AS total FROM research_notes WHERE source = 'repo' GROUP BY repo_path`,
  );
  const evicted: number[] = [...shared];
  for (const group of groups) {
    if (group.total > notesMax) {
      evicted.push(...await evictOldest('source = ? AND repo_path = ?', ['repo', group.repo_path], notesMax));
    }
  }
  return evicted;
}
