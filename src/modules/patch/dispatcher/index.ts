import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import * as jobStore from '../../job-store/index.js';
import type { PersistedJob } from '../../job-store/index.js';
import { PatchWorker } from '../worker/index.js';
import { GitWorkspaceBackend } from '../workspace/index.js';
import type { PatchResultV1 } from '../types.js';

export { submitPatchTask, PatchRefusal } from './submit.js';
export type { PatchRefusalCode, PatchSubmitResult, SubmitDeps } from './submit.js';

/** What the dispatcher needs from a worker: PatchWorker satisfies it. */
export interface PatchRunner {
  run(jobId: string): Promise<unknown>;
  cancel(jobId: string): boolean;
}

/** Start-up cleanup seam: GitWorkspaceBackend satisfies it. */
export interface OrphanCleaner {
  cleanupOrphans(ownedJobIds: ReadonlySet<string>): Promise<void>;
}

export type DispatcherStore = Pick<typeof jobStore,
  'claimNextPatchJob' | 'recoverInProgressPatchJobs' | 'finishPatchJob' | 'getPatchState' | 'getAllJobs' | 'getJobsByStatus'>;

export interface PatchDispatcherOptions {
  store?: DispatcherStore;
  /** PATCH_MAX_CONCURRENT; read from config at each dispatch when omitted. */
  maxConcurrent?: number;
  /** One worker per Job, bound to its repository's backend. */
  createWorker?: (repoPath: string) => PatchRunner;
  createBackend?: (repoPath: string) => OrphanCleaner;
}

export interface RecoverySummary {
  requeued: number;
  repos: number;
}

const ACTIVE: PersistedJob['status'][] = ['queued', 'in_progress'];

function defaultBackend(repoPath: string): GitWorkspaceBackend {
  return new GitWorkspaceBackend(repoPath, { rootDir: config.rootDir, scratchDir: config.scratchDir });
}

function repoOf(requestJson: string): string | undefined {
  try {
    const repo = (JSON.parse(requestJson) as { repo_path?: unknown }).repo_path;
    return typeof repo === 'string' && repo ? repo : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Claims queued patch Jobs (oldest first, atomic claim in the store) and runs
 * one PatchWorker per Job, up to PATCH_MAX_CONCURRENT at once. Route Jobs are
 * never touched: the store's claim and recovery filter on kind = 'patch'.
 */
export class PatchDispatcher {
  private readonly store: DispatcherStore;
  private readonly createWorker: (repoPath: string) => PatchRunner;
  private readonly createBackend: (repoPath: string) => OrphanCleaner;
  private readonly running = new Map<string, { worker?: PatchRunner; done: Promise<void> }>();
  private pumping: Promise<void> | undefined;
  private again = false;
  /** Job ids between snapshot and their DB write: cleanup must not delete their base refs. */
  readonly submitting = new Set<string>();

  constructor(private readonly options: PatchDispatcherOptions = {}) {
    this.store = options.store ?? jobStore;
    this.createBackend = options.createBackend ?? defaultBackend;
    this.createWorker = options.createWorker ?? (repo => new PatchWorker({ backend: defaultBackend(repo) }));
  }

  private get limit(): number {
    const n = this.options.maxConcurrent ?? config.patchMaxConcurrent;
    return Number.isSafeInteger(n) && n >= 1 ? n : 1;
  }

  /** Recovery before dispatch: requeue in_progress patch Jobs, clean orphans, then dispatch. */
  async start(): Promise<RecoverySummary> {
    const summary = await this.recover();
    this.kick();
    return summary;
  }

  async recover(): Promise<RecoverySummary> {
    const requeued = await this.store.recoverInProgressPatchJobs();
    const repos = await this.knownRepos();
    for (const repo of repos) await this.cleanupRepo(repo);
    if (requeued > 0) logger.info(`[patch] Requeued ${requeued} interrupted patch job(s)`);
    return { requeued, repos: repos.length };
  }

  /** Remove this repository's scratch worktrees and base refs that no live patch Job owns. */
  async cleanupRepo(repoPath: string): Promise<void> {
    try {
      const live = await this.store.getJobsByStatus(ACTIVE);
      const owned = new Set<string>(this.submitting);
      for (const job of live) if (job.kind === 'patch') owned.add(job.id);
      await this.createBackend(repoPath).cleanupOrphans(owned);
    } catch (error) {
      logger.warn(`[patch] Workspace cleanup failed for ${repoPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async knownRepos(): Promise<string[]> {
    const repos = new Set<string>();
    for (const job of await this.store.getAllJobs()) {
      if (job.kind !== 'patch') continue;
      const state = await this.store.getPatchState(job.id);
      const repo = state ? repoOf(state.request_json) : undefined;
      if (repo) repos.add(repo);
    }
    return [...repos];
  }

  /** Run after start-up, each submit and each Job end. Safe to call any number of times. */
  kick(): void {
    if (this.pumping) { this.again = true; return; }
    this.pumping = this.pump().finally(() => {
      this.pumping = undefined;
      if (this.again) { this.again = false; this.kick(); }
    });
  }

  private async pump(): Promise<void> {
    try {
      while (this.running.size < this.limit) {
        const job = await this.store.claimNextPatchJob();
        if (!job) return;
        this.launch(job.id);
      }
    } catch (error) {
      logger.error('[patch] Dispatch failed:', error);
    }
  }

  private launch(jobId: string): void {
    const entry: { worker?: PatchRunner; done: Promise<void> } = { done: Promise.resolve() };
    this.running.set(jobId, entry);
    entry.done = (async () => {
      try {
        const state = await this.store.getPatchState(jobId);
        const repo = state ? repoOf(state.request_json) : undefined;
        if (!state || !repo) throw new Error(`Missing patch state for ${jobId}`);
        entry.worker = this.createWorker(repo);
        await entry.worker.run(jobId);
      } catch (error) {
        logger.error(`[patch] Worker failed for ${jobId}:`, error);
        await this.failInternal(jobId, error).catch(e => logger.error(`[patch] Terminal write failed for ${jobId}:`, e));
      } finally {
        this.running.delete(jobId);
        this.kick();
      }
    })();
  }

  private async failInternal(jobId: string, error: unknown): Promise<void> {
    const state = await this.store.getPatchState(jobId).catch(() => undefined);
    const result: PatchResultV1 = {
      schema: 'patch_result_v1', status: 'failed', reason: 'internal_error', diff: '', base: state?.base_commit ?? '',
      files_changed: [], checks: [], attempts: state?.attempts_used ?? 0, models: [], tokens: { local: 0, free: 0, paid: 0 },
      cost_usd: state?.paid_spent_usd ?? 0, elapsed_ms: 0,
      diagnosis: { last_errors: error instanceof Error ? error.message : String(error), best_diff: '', attempts: [] },
    };
    // Conditional: a cancel or a worker's own terminal write wins.
    await this.store.finishPatchJob(jobId, { status: 'failed', result: JSON.stringify(result), error: 'internal_error' });
  }

  /** Abort a running Job's worker after cancel_task has written the row. False when not running here. */
  cancel(jobId: string): boolean {
    const worker = this.running.get(jobId)?.worker;
    return worker ? worker.cancel(jobId) : false;
  }

  /** Resolves when no claim is in progress and no worker is running (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pumping || this.running.size > 0) {
      await this.pumping;
      await Promise.all([...this.running.values()].map(e => e.done));
    }
  }
}

let instance: PatchDispatcher | undefined;

/** The process-wide dispatcher used by the MCP server and cancel_task. */
export function getPatchDispatcher(): PatchDispatcher {
  instance ??= new PatchDispatcher();
  return instance;
}
