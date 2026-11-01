import { expect, it } from '@jest/globals';
import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  WorkspaceBackend, Workspace, EditBlock, CheckSpec, CheckResult, PatchState,
  LadderEntry, PatchResultV1, AttemptOutcome, ChecksConfig,
} from '../../../src/modules/patch/types.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type ResultKeys = Assert<Equal<keyof PatchResultV1,
  'schema' | 'status' | 'reason' | 'diff' | 'base' | 'files_changed' | 'checks' |
  'attempts' | 'models' | 'tokens' | 'cost_usd' | 'elapsed_ms' | 'diagnosis'>>;
type Outcomes = Assert<Equal<AttemptOutcome,
  'apply_error' | 'check_failed' | 'validator_rejected' | 'timed_out' | 'call_error'>>;
type StateKeys = Assert<Equal<keyof PatchState,
  'job_id' | 'request_json' | 'base_commit' | 'checks_json' | 'ladder_json' |
  'settings_json' | 'deadline_at' | 'cursor_model' | 'attempts_used' |
  'paid_spent_usd' | 'paid_reserved_usd' | 'updated_at'>>;

type Statuses = Assert<Equal<PatchResultV1['status'], 'passed' | 'failed' | 'cancelled'>>;
type Reasons = Assert<Equal<PatchResultV1['reason'],
  'passed' | 'no_checks' | 'budget_attempts' | 'budget_time' | 'ladder_exhausted' |
  'paid_cap' | 'cancelled' | 'snapshot_failed' | 'internal_error'>>;
type Schema = Assert<Equal<PatchResultV1['schema'], 'patch_result_v1'>>;
type Tokens = Assert<Equal<PatchResultV1['tokens'], { local: number; free: number; paid: number }>>;
type Models = Assert<Equal<PatchResultV1['models'][number], {
  model_id: string; provider_id: string; cost_class: 'local' | 'free' | 'paid'; attempts: number;
}>>;
type Checks = Assert<Equal<PatchResultV1['checks'], CheckResult[]>>;

// Compile-only samples: these must stay usable by the downstream lanes.
function samples(backend: WorkspaceBackend, ws: Workspace, block: EditBlock) {
  const base: Promise<string> = backend.snapshot(ws.repoPath, [block.path], ws.jobId);
  const created: Promise<Workspace> = backend.create(ws.base, ws.jobId);
  const reset: Promise<void> = backend.reset(ws);
  const diff: Promise<string> = backend.diff(ws);
  const dispose: Promise<void> = backend.dispose(ws);
  const check: CheckSpec = { name: 'tsc', argv: ['npx', 'tsc'], timeout_ms: 10, append_changed_files: true };
  const result: CheckResult = { name: 'tsc', exit_code: null, timed_out: true, duration_ms: 10, tail: '' };
  const config: ChecksConfig = { checks: [check] };
  const paid: LadderEntry = { model_id: 'm', provider_id: 'p', cost_class: 'paid', prompt_price: 0.01, completion_price: 0.02 };
  // @ts-expect-error Paid models require known prices.
  const unknownPrice: LadderEntry = { model_id: 'm', provider_id: 'p', cost_class: 'paid' };
  // @ts-expect-error Shell command strings are not check argv arrays.
  const shell: CheckSpec = { name: 'bad', argv: 'npm test' };
  // @ts-expect-error Successful attempts are not failure outcomes.
  const success: AttemptOutcome = 'passed';
  return { base, created, reset, diff, dispose, result, config, paid, unknownPrice, shell, success };
}

it('type-checks the shared contracts and rejects invalid consumers', () => {
  const program = ts.createProgram([fileURLToPath(import.meta.url)], {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
    noEmit: true, skipLibCheck: true, esModuleInterop: true,
    types: ['node', 'jest'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => path.resolve('.'), getNewLine: () => '\n',
  })).toBe('');
});
