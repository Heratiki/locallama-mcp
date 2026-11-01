import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { CheckSpec, LintConfig, LintSkipped } from '../../types.js';
import { LANGUAGES, type LintTool } from './registry.js';

export interface PlanLintOptions {
  /** Worktree holding the attempt's edits; also the working directory of the checks. */
  worktree: string;
  /** Files changed by the attempt, relative to the worktree. */
  files: string[];
  lint: LintConfig;
  /** Defaults to process.env.PATH. */
  pathEnv?: string;
  /** Defaults to the user's home directory. */
  home?: string;
}

export interface LintPlan {
  specs: CheckSpec[];
  skipped: LintSkipped[];
}

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch { return false; }
}

/** Absolute path of a tool: repo node_modules/.bin, PATH, then the usual user bin dirs. */
function findBin(bin: string, worktree: string, pathEnv: string, home: string): string | undefined {
  const dirs = [
    path.join(worktree, 'node_modules', '.bin'),
    ...pathEnv.split(path.delimiter).filter(dir => path.isAbsolute(dir)),
    path.join(home, '.local', 'bin'), path.join(home, 'go', 'bin'), path.join(home, '.cargo', 'bin'),
  ];
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    if (isExecutable(candidate)) return candidate;
  }
  return undefined;
}

const anyExists = (worktree: string, names: string[]) => names.some(name => existsSync(path.join(worktree, name)));

/** Treat a file name that looks like an option as a path. */
const literal = (file: string) => file.startsWith('-') ? `./${file}` : file;

/**
 * Build the auto-lint checks for the languages of the changed files. A tool that is
 * missing, has no repo config where one is required, or is excluded lands in `skipped`.
 */
export async function planLint(options: PlanLintOptions): Promise<LintPlan> {
  const { worktree } = options;
  const exclude = new Set(typeof options.lint === 'object' ? options.lint.exclude ?? [] : []);
  const pathEnv = options.pathEnv ?? process.env.PATH ?? '';
  const home = options.home ?? homedir();
  const present = options.files.filter(file => existsSync(path.join(worktree, file)));
  const specs: CheckSpec[] = [];
  const skipped: LintSkipped[] = [];

  for (const language of LANGUAGES) {
    const files = present.filter(language.match).map(literal);
    if (files.length === 0) continue;
    for (const step of language.steps) {
      const reasons: string[] = [];
      let chosen: { tool: LintTool; abs: string } | undefined;
      for (const tool of step.tools) {
        if (exclude.has(tool.id)) { reasons.push('excluded by lint.exclude'); continue; }
        if (tool.unlessAny && anyExists(worktree, tool.unlessAny)) {
          reasons.push(`not used with ${tool.unlessAny.join(' or ')}`); continue;
        }
        if (tool.needsAny && !anyExists(worktree, tool.needsAny)) {
          reasons.push(`needs the repo's own config (${tool.needsAny.slice(0, 3).join(', ')}${tool.needsAny.length > 3 ? ', ...' : ''})`);
          continue;
        }
        const abs = findBin(tool.bin, worktree, pathEnv, home);
        if (!abs) { reasons.push(`${tool.bin} not found on PATH or in the usual bin directories`); continue; }
        chosen = { tool, abs };
        break;
      }
      if (!chosen) {
        skipped.push({
          tool: step.tools[0].id,
          reason: step.tools.length === 1 ? reasons[0] : step.tools.map((tool, i) => `${tool.id}: ${reasons[i]}`).join('; '),
        });
        continue;
      }
      for (const command of chosen.tool.commands) {
        const head = [chosen.abs, ...command.args(worktree)];
        const tail = command.tail?.(worktree) ?? [];
        const base = { name: `lint:${command.label}`, ...(command.failOnStdout ? { fail_on_stdout: true } : {}) };
        if (command.scope === 'package') specs.push({ ...base, argv: head });
        else if (command.scope === 'each') {
          for (const file of files) specs.push({ ...base, name: `${base.name}:${file}`, argv: [...head, file, ...tail] });
        } else specs.push({ ...base, argv: [...head, ...files, ...tail] });
      }
    }
  }
  return { specs, skipped };
}
