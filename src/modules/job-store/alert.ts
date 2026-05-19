import { getDbOrNull as getDb } from './db.js';

let alertActive = false;

export async function refreshAlertState(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) { alertActive = false; return; }
    const row = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM jobs WHERE status IN ('failed', 'permanently_failed')`
    );
    alertActive = (row?.count ?? 0) > 0;
  } catch {
    alertActive = false;
  }
}

export function isAlertActive(): boolean {
  return alertActive;
}

export async function buildQueueAlert(): Promise<{ failed: number; permanently_failed: number } | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const row = await db.get<{ failed: number; permanently_failed: number }>(`
      SELECT
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'permanently_failed' THEN 1 ELSE 0 END) as permanently_failed
      FROM jobs
      WHERE status IN ('failed', 'permanently_failed')
    `);
    if (!row) return null;
    const failed = row.failed ?? 0;
    const permanently_failed = row.permanently_failed ?? 0;
    if (failed === 0 && permanently_failed === 0) return null;
    return { failed, permanently_failed };
  } catch {
    return null;
  }
}
