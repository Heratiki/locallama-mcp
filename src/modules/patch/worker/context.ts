import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { CodeSearchEngine } from '../../cost-monitor/codeSearch.js';
import type { Workspace } from '../types.js';
import type { HintedFile, SearchHit } from '../prompt/index.js';

function safeRelative(ws: Workspace, name: string): boolean {
  const parts = name.replace(/\\/g, '/').split('/');
  return !!name && !path.isAbsolute(name) && !/^[a-z]:/i.test(name) &&
    !parts.some(p => p === '..' || p === '.git') &&
    !ws.links.some(link => name === link || name.startsWith(`${link}/`));
}

/** Read hints only from the immutable base in the worktree, refusing link escapes. */
export async function readHints(ws: Workspace, hints: string[]): Promise<HintedFile[]> {
  const files: HintedFile[] = [];
  for (const name of hints) {
    if (!safeRelative(ws, name)) throw new Error(`Unsafe file hint: ${name}`);
    try {
      const filename = await realpath(path.join(ws.path, name));
      const rel = path.relative(ws.path, filename);
      if (!safeRelative(ws, rel)) throw new Error(`File hint escapes workspace: ${name}`);
      files.push({ path: name, content: await readFile(filename, 'utf8') });
    } catch (error) {
      // A hint may name a file the model should create.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return files;
}

export interface WorkspaceSearch {
  search(query: string, topK: number): Promise<SearchHit[]>;
  dispose(): void;
}

export async function createWorkspaceSearch(ws: Workspace): Promise<WorkspaceSearch> {
  const engine = new CodeSearchEngine(ws.path, { excludePatterns: [
    '**/node_modules/**', '**/.git/**', '**/.venv/**', '**/dist/**', '**/build/**',
    '**/*.min.js', '**/*.bundle.js', '**/package-lock.json', '**/yarn.lock',
    ...ws.links.flatMap(link => [link, `${link}/**`]),
  ] });
  try {
    await engine.indexWorkspace();
    return {
      search: async (query, topK) => (await engine.search(query, topK))
        .map(hit => ({ path: path.relative(ws.path, hit.path), content: hit.content }))
        .filter(hit => safeRelative(ws, hit.path)),
      dispose: () => engine.dispose(),
    };
  } catch {
    // Hints and goal still work if indexing fails; search is optional context.
    engine.dispose();
    return { search: async () => [], dispose: () => {} };
  }
}
