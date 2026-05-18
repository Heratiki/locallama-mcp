/**
 * bm25.ts
 * Native TypeScript implementation of the Okapi BM25 ranking algorithm.
 *
 * Replaces the previous Python/retriv subprocess bridge. No external
 * dependencies — all indexing and scoring happens in-process.
 *
 * Public API is intentionally identical to the old BM25Searcher so all
 * callers (codeSearch.ts, codeSearchEngine.ts) require no changes.
 *
 * BM25 formula per document d for query term qi:
 *   score += IDF(qi) * tf(qi,d)*(k1+1) / (tf(qi,d) + k1*(1-b + b*|d|/avgdl))
 *   IDF(qi) = ln((N - df(qi) + 0.5) / (df(qi) + 0.5) + 1)
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Public interfaces (preserved from previous API for drop-in compatibility)
// ---------------------------------------------------------------------------

export interface BM25Options {
  k1?: number;
  b?: number;
  epsilon?: number;
}

export interface TextPreprocessingOptions {
  stemming?: boolean;
  removeStopwords?: boolean;
  lowercase?: boolean;
}

export interface DenseRetrieverOptions {
  modelName?: string;
  batchSize?: number;
  deviceId?: string;
}

export interface HybridRetrieverOptions {
  weightSparse?: number;
  weightDense?: number;
  denseOptions?: DenseRetrieverOptions;
  textOptions?: TextPreprocessingOptions;
}

export interface SearchResult {
  index: number;
  score: number;
  content: string;
  file_path?: string;
}

export interface IndexingResult {
  status: string;
  totalFiles: number;
  timeTaken: string;
  filePaths: string[];
}

export interface RetrieverInitOptions {
  retrieverType?: string;
  textPreprocessingOptions?: TextPreprocessingOptions;
  denseRetrieverOptions?: DenseRetrieverOptions;
  hybridRetrieverOptions?: HybridRetrieverOptions;
}

// ---------------------------------------------------------------------------
// File extensions recognised as text/code (binary files are skipped)
// ---------------------------------------------------------------------------
const CODE_EXTENSIONS = new Set([
  '.ts', '.js', '.mjs', '.cjs', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.cs', '.php', '.sh', '.bash', '.zsh', '.ps1',
  '.md', '.txt', '.yaml', '.yml', '.json', '.toml', '.ini', '.env',
  '.html', '.css', '.scss', '.sql',
]);

const MAX_FILE_BYTES = 1_000_000; // skip files larger than 1 MB

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

// ---------------------------------------------------------------------------
// Internal BM25 index
// ---------------------------------------------------------------------------
interface IndexedDocument {
  content: string;
  filePath?: string;
  tokens: string[];
  length: number;
}

class BM25Index {
  private docs: IndexedDocument[] = [];
  private df = new Map<string, number>(); // document frequency per term
  private avgdl = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(k1: number, b: number) {
    this.k1 = k1;
    this.b = b;
  }

  build(documents: { content: string; filePath?: string }[]): void {
    this.docs = [];
    this.df = new Map();

    for (const doc of documents) {
      const tokens = tokenize(doc.content);
      this.docs.push({ content: doc.content, filePath: doc.filePath, tokens, length: tokens.length });
    }

    this.avgdl = this.docs.length
      ? this.docs.reduce((s, d) => s + d.length, 0) / this.docs.length
      : 0;

    // Compute document frequencies
    for (const doc of this.docs) {
      const seen = new Set<string>();
      for (const t of doc.tokens) {
        if (!seen.has(t)) {
          this.df.set(t, (this.df.get(t) ?? 0) + 1);
          seen.add(t);
        }
      }
    }
  }

  search(query: string, topK: number): SearchResult[] {
    if (this.docs.length === 0) return [];

    const queryTerms = tokenize(query);
    const N = this.docs.length;
    const scores: number[] = new Array(N).fill(0);

    for (const qt of queryTerms) {
      const df = this.df.get(qt) ?? 0;
      if (df === 0) continue;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (let i = 0; i < N; i++) {
        const doc = this.docs[i];
        const tf = doc.tokens.filter((t) => t === qt).length;
        if (tf === 0) continue;
        const norm = doc.length / (this.avgdl || 1);
        scores[i] += idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * norm));
      }
    }

    return scores
      .map((score, index) => ({ index, score, content: this.docs[index].content, file_path: this.docs[index].filePath }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get size(): number { return this.docs.length; }
}

// ---------------------------------------------------------------------------
// Walk a directory tree and collect readable code files
// ---------------------------------------------------------------------------
async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'build', '.venv', 'venv', 'coverage'].includes(entry.name)) continue;
      results.push(...await collectFiles(full));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_EXTENSIONS.has(ext)) continue;
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size > MAX_FILE_BYTES) continue;
        results.push(full);
      } catch { /* skip unreadable */ }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// BM25Searcher — public API (drop-in replacement for the Python bridge)
// ---------------------------------------------------------------------------
export class BM25Searcher {
  private index: BM25Index;
  private initialized = false;
  private readonly options: Required<BM25Options>;

  constructor(options: BM25Options = {}) {
    this.options = {
      k1: typeof options.k1 === 'number' ? options.k1 : 1.5,
      b:  typeof options.b  === 'number' ? options.b  : 0.75,
      epsilon: typeof options.epsilon === 'number' ? options.epsilon : 0.25,
    };
    this.index = new BM25Index(this.options.k1, this.options.b);
    logger.info('BM25Searcher initialised (native TypeScript — no Python required)');
  }

  /**
   * Initialise the searcher.  With the native implementation this is a no-op;
   * the method is kept for API compatibility with callers that await it.
   */
  public async initialize(_retrieverOptions?: RetrieverInitOptions): Promise<void> {
    this.initialized = true;
    logger.debug('BM25Searcher ready (native)');
  }

  /**
   * Index an array of raw text strings.
   * Each string's position in the array is its `index` in search results.
   */
  public async indexDocuments(documents: string[]): Promise<IndexingResult> {
    const start = Date.now();
    this.index.build(documents.map((content) => ({ content })));
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    logger.info(`BM25: indexed ${documents.length} documents in ${elapsed}s`);
    return {
      status: 'success',
      totalFiles: documents.length,
      timeTaken: `${elapsed}s`,
      filePaths: [],
    };
  }

  /**
   * Recursively read code files from each directory, then build the index.
   */
  public async indexDirectories(directories: string[]): Promise<IndexingResult> {
    const start = Date.now();
    const allFiles: string[] = [];
    for (const dir of directories) {
      const files = await collectFiles(dir);
      allFiles.push(...files);
    }

    const docs: { content: string; filePath: string }[] = [];
    for (const filePath of allFiles) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        docs.push({ content, filePath });
      } catch { /* skip unreadable files */ }
    }

    this.index.build(docs);
    const elapsed = ((Date.now() - start) / 1000).toFixed(2);
    logger.info(`BM25: indexed ${docs.length} files from ${directories.length} director${directories.length === 1 ? 'y' : 'ies'} in ${elapsed}s`);
    return {
      status: 'success',
      totalFiles: docs.length,
      timeTaken: `${elapsed}s`,
      filePaths: allFiles,
    };
  }

  /** BM25 search — returns up to `topK` results sorted by descending score. */
  public async search(query: string, topK = 5): Promise<SearchResult[]> {
    if (!this.initialized) await this.initialize();
    logger.debug(`BM25: searching "${query}" (top ${topK})`);
    const results = this.index.search(query, topK);
    logger.info(`BM25: search "${query}" → ${results.length} result(s)`);
    return results;
  }

  /** No-op — kept for API compatibility (previous impl killed a Python process). */
  public dispose(): void {
    this.initialized = false;
    this.index = new BM25Index(this.options.k1, this.options.b);
    logger.debug('BM25Searcher disposed');
  }
}
