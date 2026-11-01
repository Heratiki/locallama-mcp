import * as jobStore from '../../job-store/index.js';
import { getProviderRegistry, type ProviderRegistry } from '../../core/provider/registry.js';
import { withSpan } from '../../telemetry/index.js';
import { runChecks, loadChecksConfig } from '../checks/index.js';
import { parseEditBlocks, applyEditBlocks } from '../edit-blocks/index.js';
import { buildPrompt } from '../prompt/index.js';
import { errorSignature, sameSignature, nextCursor, stopReason, pickValidator, hasBudgetNow } from '../ladder/index.js';
import { truncateTail } from '../checks/output.js';
import type {
  AttemptOutcome, CheckResult, CheckSpec, ChecksConfig, EditBlock, LadderEntry, PatchDiagnosis, Workspace, WorkspaceBackend,
} from '../types.js';
import type { PatchAttemptRow } from '../../job-store/index.js';
import {
  InferenceTimeout, WorkerStop, resolveWorkerSettings,
  type AttemptDetails, type CallUsage, type PatchRequest, type PatchValidation, type WorkerResult,
} from './contracts.js';
import { createWorkspaceSearch, readHints, type WorkspaceSearch } from './context.js';
import { PatchModelCalls } from './model-call.js';
import { validatePatch } from './validator.js';

export type { WorkerSettings, WorkerResult, PatchValidation, PatchRequest } from './contracts.js';

export type PatchWorkerStore = Pick<typeof jobStore,
  'getPatchState' | 'getPatchAttempts' | 'getJob' | 'recordAttemptStart' |
  'insertPatchAttempt' | 'finishPatchJob' | 'updatePatchSpend'>;

export interface PatchWorkerOptions {
  backend: WorkspaceBackend;
  registry?: Pick<ProviderRegistry, 'get' | 'executeWithConcurrencyLimit'>;
  store?: PatchWorkerStore;
  now?: () => number;
}

/** Submission owns snapshots; expose the matching telemetry seam for it. */
export function snapshotPatchWorkspace(backend: WorkspaceBackend, repo: string, hints: string[], jobId: string): Promise<string> {
  return withSpan('patch.snapshot', { 'job.id': jobId }, () => backend.snapshot(repo, hints, jobId));
}

function details(row: PatchAttemptRow): AttemptDetails {
  const value = JSON.parse(row.edit_blocks ?? '[]');
  return Array.isArray(value) ? { blocks: value, calls: [], diff: '', files: [] } : value;
}

function checksOf(row: PatchAttemptRow | undefined): CheckResult[] {
  return row ? JSON.parse(row.checks_json ?? '[]') as CheckResult[] : [];
}

function outcomeOf(row: PatchAttemptRow): AttemptOutcome {
  return row.outcome === 'passed' ? 'call_error' : row.outcome as AttemptOutcome ?? 'call_error';
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
const sameModel = (row: PatchAttemptRow, entry: LadderEntry): boolean =>
  row.model_id === entry.model_id && row.provider_id === entry.provider_id;

/** The dispatcher claims jobs before run(), and calls cancel() after cancelling their rows. */
export class PatchWorker {
  private readonly running = new Map<string, AbortController>();
  private readonly store: PatchWorkerStore;
  private readonly registry: NonNullable<PatchWorkerOptions['registry']>;
  private readonly now: () => number;

  constructor(private readonly options: PatchWorkerOptions) {
    this.store = options.store ?? jobStore;
    this.registry = options.registry ?? getProviderRegistry();
    this.now = options.now ?? Date.now;
  }

  /** Aborts models and the currently running check group; does not write the row. */
  cancel(jobId: string): boolean {
    const controller = this.running.get(jobId);
    if (!controller) return false;
    controller.abort(new WorkerStop('cancelled'));
    return true;
  }

  async run(jobId: string): Promise<WorkerResult> {
    if (this.running.has(jobId)) throw new Error(`Patch job already running: ${jobId}`);
    const controller = new AbortController();
    this.running.set(jobId, controller);
    try {
      return await withSpan('patch.task', { 'job.id': jobId }, async span => {
        const result = await this.runJob(jobId, controller);
        span.setAttributes({
          'patch.outcome': result.reason, 'patch.attempts': result.attempts,
          'patch.cost_usd': result.cost_usd, 'patch.elapsed_ms': result.elapsed_ms,
          'patch.tokens.local': result.tokens.local, 'patch.tokens.free': result.tokens.free,
          'patch.tokens.paid': result.tokens.paid,
        });
        return result;
      });
    } finally { this.running.delete(jobId); }
  }

  private async runJob(jobId: string, controller: AbortController): Promise<WorkerResult> {
    const store = this.store;
    const now = this.now;
    const state = await store.getPatchState(jobId);
    if (!state) throw new Error(`Missing patch state: ${jobId}`);
    const job = await store.getJob(jobId);
    if (!job || job.kind !== 'patch') throw new Error(`Not a patch job: ${jobId}`);
    if (['completed', 'failed', 'permanently_failed'].includes(job.status)) {
      if (job.result) return JSON.parse(job.result) as WorkerResult;
      throw new Error(`Patch job already terminal: ${jobId}`);
    }
    const startedAt = job.created_at;
    const rows = await store.getPatchAttempts(jobId);
    let ws: Workspace | undefined;
    let search: WorkspaceSearch | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let keepWorkspace = false;
    let errorTailTokens = 800;
    const result: WorkerResult = {
      schema: 'patch_result_v1', status: 'failed', reason: 'internal_error', diff: '', base: state.base_commit,
      files_changed: [], checks: [], attempts: state.attempts_used, models: [], tokens: { local: 0, free: 0, paid: 0 },
      cost_usd: state.paid_spent_usd, elapsed_ms: 0, diagnosis: null, validation: [],
    };
    let lastError = '';
    let bestDiff = '';
    let bestPassed = -1;
    const summaries: PatchDiagnosis['attempts'] = [];
    const usage: CallUsage[] = [];
    try {
      const request = JSON.parse(state.request_json) as PatchRequest;
      const settings = resolveWorkerSettings(state.settings_json);
      errorTailTokens = settings.patchErrorTailTokens;
      keepWorkspace = settings.patchKeepWorkspaceOnFail;
      const ladder = JSON.parse(state.ladder_json) as LadderEntry[];
      const persistedChecks = JSON.parse(state.checks_json) as CheckSpec[] | ChecksConfig;
      const specs = Array.isArray(persistedChecks) ? persistedChecks : persistedChecks.checks;
      const cap = request.paid_cap_usd ?? settings.patchPaidCapUsd;
      if (!Number.isFinite(cap) || cap < 0) throw new Error('Invalid paid cap');
      const allowed = (entry: LadderEntry): boolean => entry.cost_class !== 'paid' ||
        (request.allow_paid === true && !settings.openRouterFreeOnly);
      const calls = new PatchModelCalls({
        registry: this.registry, state, settings, capUsd: cap, signal: controller.signal, now: this.now,
        persistSpend: value => store.updatePatchSpend(jobId, { ...value, updated_at: this.now() }),
      });
      await calls.recoverReservation();
      const armDeadline = () => {
        const remaining = state.deadline_at - this.now();
        if (remaining <= 0) controller.abort(new WorkerStop('budget_time'));
        else deadlineTimer = setTimeout(armDeadline, Math.min(remaining, 2_147_483_647));
      };
      if (job.status === 'cancelled') controller.abort(new WorkerStop('cancelled'));
      armDeadline();
      const checkpoint = async () => {
        const current = await store.getJob(jobId);
        if (current?.status === 'cancelled') controller.abort(new WorkerStop('cancelled'));
        calls.checkStop();
      };

      // Reconstruct interrupted calls as consumed attempts. No synthetic model
      // call is made, and each missing attempt receives a durable diagnosis row.
      const present = new Set(rows.map(row => row.n));
      for (let n = 1; n <= state.attempts_used; n++) {
        if (present.has(n)) continue;
        const entry = ladder[state.cursor_model];
        const row: PatchAttemptRow = {
          job_id: jobId, n, model_id: entry?.model_id ?? null, provider_id: entry?.provider_id ?? null,
          cost_class: entry?.cost_class ?? null, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0,
          edit_blocks: '[]', outcome: 'call_error', apply_error: 'Interrupted model call during previous worker run',
          checks_json: '[]', duration_ms: 0, started_at: state.updated_at, ended_at: this.now(),
        };
        await store.insertPatchAttempt(row);
        rows.push(row);
      }
      rows.sort((a, b) => a.n - b.n);
      for (const row of rows) {
        const d = details(row);
        if (d.calls.length) usage.push(...d.calls);
        else if (row.model_id && row.provider_id && ['local', 'free', 'paid'].includes(row.cost_class ?? '')) {
          usage.push({ model_id: row.model_id, provider_id: row.provider_id, cost_class: row.cost_class as LadderEntry['cost_class'],
            prompt_tokens: row.prompt_tokens ?? 0, completion_tokens: row.completion_tokens ?? 0, cost_usd: row.cost_usd ?? 0 });
        }
        if (d.validation) result.validation.push(d.validation);
        const passed = checksOf(row).filter(c => c.exit_code === 0 && !c.timed_out).length;
        if (d.diff && passed > bestPassed) { bestPassed = passed; bestDiff = d.diff; }
        if (row.outcome !== 'passed') summaries.push({ model_id: row.model_id ?? 'unknown', provider_id: row.provider_id ?? 'unknown',
          outcome: outcomeOf(row), duration_ms: row.duration_ms ?? 0 });
      }
      const last = rows[rows.length - 1];
      let lastChecks = checksOf(last);
      result.checks = lastChecks;
      let lastBlocks: EditBlock[] = last ? details(last).blocks : [];
      lastError = last?.apply_error ?? '';
      let signature = errorSignature(lastChecks);
      if (!signature && lastError) signature = `${last?.outcome}\n${lastError.split('\n')[0]}`;
      let cursor = state.cursor_model;
      let onModel = ladder[cursor] ? rows.filter(r => sameModel(r, ladder[cursor])).length : 0;
      // A crash may occur after inserting the attempt but before saving the next
      // cursor. Recover both normal exhaustion and the repeated-error advance.
      if (onModel > 0 && ladder[cursor]) {
        const recent = rows.filter(r => sameModel(r, ladder[cursor]));
        const previous = recent[recent.length - 2];
        const previousSignature = previous ? errorSignature(checksOf(previous)) ??
          (previous.apply_error ? `${previous.outcome}\n${previous.apply_error.split('\n')[0]}` : null) : null;
        const advance = nextCursor(cursor, onModel, settings.patchAttemptsPerModel, sameSignature(previousSignature, signature));
        cursor = advance.cursor;
        onModel = advance.attemptsOnModel;
      }
      const persistCursor = () => store.recordAttemptStart(jobId, {
        cursor_model: cursor, attempts_used: state.attempts_used, updated_at: this.now(),
      });
      await persistCursor();

      // Even an expired/cancelled job needs a handle to dispose its base ref and
      // any old worktree: the shared backend exposes disposal only via Workspace.
      ws = await withSpan('patch.worktree.create', { 'job.id': jobId }, () => this.options.backend.create(state.base_commit, jobId));
      await checkpoint();
      if (specs.length === 0) { result.reason = 'no_checks'; return await terminal(); }
      // If the process died between the durable passing attempt and terminal
      // write, its proven diff can complete without another inference/check run.
      if (last?.outcome === 'passed' && lastChecks.length === specs.length && lastChecks.every(c => c.exit_code === 0 && !c.timed_out)) {
        const saved = details(last);
        result.status = 'passed'; result.reason = 'passed'; result.diff = saved.diff; result.files_changed = saved.files;
        return await terminal();
      }
      await this.options.backend.reset(ws);
      await checkpoint();
      const hints = await readHints(ws, request.file_hints ?? []);
      search = await createWorkspaceSearch(ws);
      await checkpoint();
      const snapshotConfig = Array.isArray(persistedChecks) ? await loadChecksConfig(ws.path) : persistedChecks;
      const envAllow = snapshotConfig?.env_allow ?? [];

      while (true) {
        await checkpoint();
        const stop = stopReason({ attemptsUsed: state.attempts_used, maxAttempts: settings.patchMaxAttempts,
          now: this.now(), deadlineAt: state.deadline_at, cursorModel: cursor, ladderLength: ladder.length, cancelled: false });
        if (stop) { result.reason = stop; break; }
        const entry = ladder[cursor];
        const provider = this.registry.get(entry.provider_id);
        if (!allowed(entry) || (entry.cost_class === 'free' && provider && !hasBudgetNow(provider))) {
          cursor++;
          onModel = 0;
          await persistCursor();
          continue;
        }
        let began = false;
        const attemptStarted = this.now();
        const usageOffset = calls.usage.length;
        let attemptChecks: CheckResult[] = [];
        let blocks: EditBlock[] = [];
        let diff = '';
        let files: string[] = [];
        let validation: PatchValidation | undefined;
        let error = '';
        let outcome: AttemptOutcome | 'passed' = 'call_error';
        let stopped: WorkerStop | undefined;
        try {
          await withSpan('patch.attempt', { 'job.id': jobId, 'patch.attempt': state.attempts_used + 1, 'model.id': entry.model_id }, async span => {
            // A missing provider or a context guard failure is still an attempt;
            // a rejected paid reservation is not. Start is written by execute()
            // immediately before its registry call, after guard and reservation.
            const start = async () => {
              if (began) return;
              state.attempts_used++;
              onModel++;
              await persistCursor();
              began = true;
            };
            try {
              const window = await calls.contextWindow(entry);
              await checkpoint();
              const prompt = await buildPrompt({
                goal: request.goal, attempt: state.attempts_used + 1, hintedFiles: hints,
                lastChecks, lastBlocks, lastErrorText: lastError, search: search!.search,
                modelContextWindow: window, contextTokens: settings.patchContextTokens,
                maxOutputTokens: settings.patchMaxOutputTokens, errorTailTokens: settings.patchErrorTailTokens,
              });
              await checkpoint();
              const response = await calls.execute(entry, prompt.system, prompt.prompt, start);
              await checkpoint();
              const parsed = parseEditBlocks(response.content);
              blocks = parsed.blocks;
              if (parsed.errors.length || blocks.length === 0) {
                outcome = 'apply_error';
                error = parsed.errors.join('\n') || 'No edit blocks in model output';
                return;
              }
              await this.options.backend.reset(ws!);
              await checkpoint();
              const applied = applyEditBlocks(ws!, blocks, { wholeFileMaxLines: settings.patchWholeFileMaxLines });
              if (!applied.ok) { outcome = 'apply_error'; error = applied.errors.join('\n'); return; }
              files = applied.files;
              // The runner stops at first failure. Invoke once per check so the
              // worker can wrap each command in its own telemetry span.
              for (const spec of specs) {
                await checkpoint();
                const checked = await withSpan('patch.check', { 'job.id': jobId, 'check.name': spec.name }, () => runChecks([spec], {
                  worktree: ws!.path, changedFiles: files, envAllow, timeoutMs: settings.patchCheckTimeoutMs,
                  errorTailTokens: settings.patchErrorTailTokens, signal: controller.signal,
                }));
                attemptChecks.push(...checked);
                await checkpoint();
                if (checked.length !== 1 || checked[0].exit_code !== 0 || checked[0].timed_out) break;
              }
              diff = await withSpan('patch.diff', { 'job.id': jobId }, () => this.options.backend.diff(ws!));
              await checkpoint();
              const passed = attemptChecks.filter(c => c.exit_code === 0 && !c.timed_out).length;
              if (passed > bestPassed) { bestPassed = passed; bestDiff = diff; }
              if (passed !== specs.length) {
                outcome = attemptChecks.some(c => c.timed_out) ? 'timed_out' : 'check_failed';
                error = attemptChecks.filter(c => c.exit_code !== 0 || c.timed_out).map(c => `${c.name}\n${c.tail}`).join('\n');
                return;
              }
              if (request.validate === true) {
                const judge = pickValidator(ladder, cursor);
                validation = allowed(judge)
                  ? await validatePatch(calls, judge, request.goal, diff)
                  : { model_id: judge.model_id, provider_id: judge.provider_id, passed: null, skipped: true, reason: 'Paid validator disabled' };
                result.validation.push(validation);
                await checkpoint();
                if (validation.passed === false && !validation.skipped) {
                  outcome = 'validator_rejected'; error = validation.reason; return;
                }
              }
              outcome = 'passed';
            } catch (error) {
              if (!(error instanceof WorkerStop)) await start();
              throw error;
            } finally { span.setAttribute('patch.outcome', outcome); }
          });
        } catch (caught) {
          error = message(caught);
          if (caught instanceof WorkerStop) stopped = caught;
          outcome = caught instanceof InferenceTimeout ? 'timed_out' : 'call_error';
        }
        const recordedOutcome = outcome as AttemptOutcome | 'passed';
        const duration = Math.max(0, this.now() - attemptStarted);
        if (began) {
          const attemptUsage = calls.usage.slice(usageOffset);
          const meta: AttemptDetails = { blocks, calls: attemptUsage, diff, files, ...(validation ? { validation } : {}) };
          const row: PatchAttemptRow = {
            job_id: jobId, n: state.attempts_used, model_id: entry.model_id, provider_id: entry.provider_id,
            cost_class: entry.cost_class, prompt_tokens: attemptUsage.reduce((s, u) => s + u.prompt_tokens, 0),
            completion_tokens: attemptUsage.reduce((s, u) => s + u.completion_tokens, 0),
            cost_usd: attemptUsage.reduce((s, u) => s + u.cost_usd, 0), edit_blocks: JSON.stringify(meta), outcome: recordedOutcome,
            apply_error: error ? truncateTail(error, settings.patchErrorTailTokens) : null,
            checks_json: JSON.stringify(attemptChecks), duration_ms: duration, started_at: attemptStarted, ended_at: this.now(),
          };
          await store.insertPatchAttempt(row);
          usage.push(...attemptUsage);
          if (recordedOutcome !== 'passed') summaries.push({ model_id: entry.model_id, provider_id: entry.provider_id,
            outcome: recordedOutcome, duration_ms: duration });
          rows.push(row);
        }
        lastChecks = attemptChecks;
        lastBlocks = blocks;
        lastError = error;
        result.checks = attemptChecks;
        if (stopped) { result.reason = stopped.reason; break; }
        if (recordedOutcome === 'passed') {
          result.status = 'passed'; result.reason = 'passed'; result.diff = diff; result.files_changed = files;
          break;
        }
        const currentSignature = errorSignature(attemptChecks) ?? (error ? `${recordedOutcome}\n${error.split('\n')[0]}` : null);
        const next = nextCursor(cursor, onModel, settings.patchAttemptsPerModel, sameSignature(signature, currentSignature));
        cursor = next.cursor;
        onModel = next.attemptsOnModel;
        signature = currentSignature;
        await persistCursor();
      }
      return await terminal();
    } catch (error) {
      result.reason = error instanceof WorkerStop ? error.reason : 'internal_error';
      lastError = message(error);
      return await terminal();
    } finally {
      clearTimeout(deadlineTimer);
      search?.dispose();
      // runChecks resolves only after its complete process group is gone. No
      // fire-and-forget checks or cleanup can race worktree removal here.
      if (ws && (result.status === 'passed' || !keepWorkspace)) await this.options.backend.dispose(ws);
    }

    async function terminal(): Promise<WorkerResult> {
      if (controller.signal.aborted) {
        result.reason = controller.signal.reason instanceof WorkerStop ? controller.signal.reason.reason : 'cancelled';
      }
      if (result.reason !== 'passed') {
        result.status = result.reason === 'cancelled' ? 'cancelled' : 'failed';
        result.diff = '';
        result.files_changed = [];
      }
      result.attempts = state!.attempts_used;
      result.cost_usd = state!.paid_spent_usd;
      result.elapsed_ms = Math.max(0, now() - startedAt);
      result.tokens = { local: 0, free: 0, paid: 0 };
      const models = new Map<string, WorkerResult['models'][number]>();
      for (const u of usage) {
        result.tokens[u.cost_class] += u.prompt_tokens + u.completion_tokens;
      }
      // Model attempt counts describe grind attempts (including guard failures
      // and interrupted calls). Judge calls contribute usage and validation,
      // but do not consume another generation attempt.
      for (const row of rows) {
        if (!row.model_id || !row.provider_id || !['local', 'free', 'paid'].includes(row.cost_class ?? '')) continue;
        const key = `${row.provider_id}\0${row.model_id}`;
        const m = models.get(key) ?? { model_id: row.model_id, provider_id: row.provider_id,
          cost_class: row.cost_class as LadderEntry['cost_class'], attempts: 0 };
        m.attempts++;
        models.set(key, m);
      }
      result.models = [...models.values()];
      result.diagnosis = result.status === 'passed' ? null : {
        last_errors: truncateTail(lastError, errorTailTokens), best_diff: bestDiff, attempts: summaries,
      };
      const written = await store.finishPatchJob(jobId, {
        status: result.status === 'passed' ? 'completed' : result.status,
        result: JSON.stringify(result), error: result.status === 'passed' ? null : result.reason, completed_at: now(),
      });
      if (!written) {
        const current = await store.getJob(jobId);
        if (current?.status === 'cancelled') {
          result.status = 'cancelled'; result.reason = 'cancelled'; result.diff = ''; result.files_changed = [];
          result.diagnosis ??= { last_errors: 'cancelled', best_diff: bestDiff, attempts: summaries };
        } else if (current?.result) return JSON.parse(current.result) as WorkerResult;
      }
      return result;
    }
  }
}
