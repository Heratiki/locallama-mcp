import { getResearchNotesIndex } from '../../cost-monitor/codeSearchEngine.js';

/** The research-store row fields reuse needs. */
export interface ReusableNote {
  id: number;
  repo_path: string;
  source: string;
  query: string;
  info: string | null;
  reason: string;
}

export interface ReuseLookup {
  /** Redacted, normalized error signature (the reason lines after the rule line). */
  signature: string;
  queries: string[];
  repoPath: string;
}

function terms(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9_]+/).filter(term => term.length > 1));
}

/**
 * Reuse (#155 ruling 5, criteria 12c-12h): search the BM25 index of helped
 * notes — a separate index, rebuilt from the research_notes table at first
 * use, so repo code search is never polluted. A good hit (at least two shared
 * distinctive terms) goes into the prompt and the SearXNG and local searches
 * are skipped. Shared-scope sources match from any repo; 'repo' notes only
 * from the same repo_path.
 */
export async function findReusedNote(notes: ReusableNote[], lookup: ReuseLookup): Promise<ReusableNote | undefined> {
  // Scope before ranking: foreign repo notes must not consume top-k slots.
  notes = notes.filter(note => note.source !== 'repo' || note.repo_path === lookup.repoPath);
  if (notes.length === 0) return undefined;
  const index = getResearchNotesIndex();
  await index.sync(notes.map(note => ({
    id: note.id,
    repoPath: note.repo_path,
    source: note.source,
    path: `research-note:${note.id}`,
    // The stored rule line is boilerplate; index signature + query + info.
    content: `${note.reason.split('\n').slice(1).join('\n')}\n${note.query}\n${note.info ?? ''}`,
  })));
  const hits = await index.search(`${lookup.signature} ${lookup.queries.join(' ')}`, 5);
  const lookupTerms = terms(`${lookup.signature} ${lookup.queries.join(' ')}`);
  for (const hit of hits) {
    const note = notes.find(candidate => candidate.id === hit.id);
    if (!note) continue;
    // Scope filter (12g/12h): 'repo' notes stay inside their repo_path.
    if (note.source === 'repo' && note.repo_path !== lookup.repoPath) continue;
    let shared = 0;
    const noteTerms = terms(`${note.reason}\n${note.query}\n${note.info ?? ''}`);
    for (const term of lookupTerms) if (noteTerms.has(term)) shared++;
    if (shared >= 2) return note;
  }
  return undefined;
}
