import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * How a command takes its targets:
 * - files: changed files of the language are appended
 * - package: whole project (go vet, clippy, tsc cannot take a file list; maintainer ruling 2026-11-01)
 * - each: one run per changed file (php -l takes a single file)
 */
export type LintScope = 'files' | 'package' | 'each';

export interface LintCommand {
  /** Suffix of the check name: `lint:<label>`. */
  label: string;
  scope: LintScope;
  args: (worktree: string) => string[];
  /** Arguments placed after the files (for example a trailing `--`). */
  tail?: (worktree: string) => string[];
  /** Tool prints findings but exits 0 (gofmt -l): non-empty stdout fails. */
  failOnStdout?: boolean;
}

export interface LintTool {
  /** Id used by `exclude` and reported in `lint_skipped`. */
  id: string;
  /** Executable name looked up on the search path. */
  bin: string;
  /** Applies only when one of these files exists in the worktree root (the repo's own config). */
  needsAny?: string[];
  /** Does not apply when one of these exists (javac only without a build tool). */
  unlessAny?: string[];
  commands: LintCommand[];
}

/** Alternatives are tried in order; the first usable tool runs. */
export interface LintStep { tools: LintTool[] }

export interface LintLanguage {
  name: string;
  match: (file: string) => boolean;
  steps: LintStep[];
}

const ext = (...list: string[]) => (file: string) => list.includes(path.extname(file).toLowerCase());
const files = (label: string, ...args: string[]): LintCommand => ({ label, scope: 'files', args: () => args });
const pkg = (label: string, ...args: string[]): LintCommand => ({ label, scope: 'package', args: () => args });
const one = (id: string, commands: LintCommand[], extra: Partial<LintTool> = {}): LintTool =>
  ({ id, bin: id, commands, ...extra });

const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];

export const LANGUAGES: LintLanguage[] = [
  {
    name: 'typescript/javascript',
    match: ext('.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'),
    steps: [
      { tools: [one('tsc', [pkg('tsc', '--noEmit', '-p', '.')], { needsAny: ['tsconfig.json'] })] },
      { tools: [
        one('eslint', [files('eslint', '--max-warnings=0')], { needsAny: ESLINT_CONFIGS }),
        one('biome', [files('biome', 'check')], { needsAny: ['biome.json', 'biome.jsonc'] }),
        one('oxlint', [files('oxlint')]),
      ] },
    ],
  },
  {
    name: 'python',
    match: ext('.py', '.pyi'),
    steps: [{ tools: [
      one('ruff', [files('ruff-check', 'check'), files('ruff-format', 'format', '--check')]),
      one('pyflakes', [files('pyflakes')]),
      // compile() in-process so no __pycache__ lands in the worktree diff.
      { id: 'python3', bin: 'python3', commands: [files('py-compile', '-c',
        'import sys\nfor f in sys.argv[1:]: compile(open(f, encoding="utf-8").read(), f, "exec")')] },
    ] }],
  },
  {
    name: 'go',
    match: ext('.go'),
    steps: [
      { tools: [one('gofmt', [{ ...files('gofmt', '-l'), failOnStdout: true }])] },
      { tools: [one('go', [pkg('go-vet', 'vet', './...')])] },
      { tools: [one('staticcheck', [pkg('staticcheck', './...')])] },
    ],
  },
  {
    name: 'rust',
    match: ext('.rs'),
    steps: [
      { tools: [{ id: 'cargo-fmt', bin: 'cargo', needsAny: ['Cargo.toml'], commands: [pkg('cargo-fmt', 'fmt', '--check')] }] },
      { tools: [{ id: 'cargo-clippy', bin: 'cargo', needsAny: ['Cargo.toml'],
        commands: [pkg('cargo-clippy', 'clippy', '--offline', '--', '-D', 'warnings')] }] },
    ],
  },
  {
    name: 'c/c++',
    match: ext('.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'),
    steps: [{ tools: [
      one('clang-tidy', [{
        label: 'clang-tidy', scope: 'files',
        args: wt => existsSync(path.join(wt, 'compile_commands.json')) ? ['-p', '.'] : [],
        tail: wt => existsSync(path.join(wt, 'compile_commands.json')) ? [] : ['--'],
      }], { needsAny: ['.clang-tidy'] }),
      one('gcc', [files('gcc-syntax', '-fsyntax-only', '-Wall', '-Wextra')]),
    ] }],
  },
  { name: 'shell', match: ext('.sh', '.bash', '.ksh'),
    steps: [{ tools: [one('shellcheck', [files('shellcheck', '--severity=style')])] }] },
  { name: 'ruby', match: ext('.rb', '.rake'), steps: [{ tools: [one('rubocop', [files('rubocop')])] }] },
  { name: 'php', match: ext('.php'),
    steps: [{ tools: [one('php', [{ label: 'php-lint', scope: 'each', args: () => ['-l'] }])] }] },
  { name: 'lua', match: ext('.lua'), steps: [{ tools: [one('luacheck', [files('luacheck')])] }] },
  { name: 'kotlin', match: ext('.kt', '.kts'), steps: [{ tools: [one('ktlint', [files('ktlint')])] }] },
  { name: 'swift', match: ext('.swift'),
    steps: [{ tools: [one('swiftlint', [files('swiftlint', 'lint', '--strict')])] }] },
  { name: 'c#', match: ext('.cs'),
    steps: [{ tools: [one('dotnet', [pkg('dotnet-format', 'format', '--verify-no-changes')])] }] },
  { name: 'java', match: ext('.java'),
    steps: [{ tools: [one('javac', [{
      label: 'javac', scope: 'files', args: () => ['-Xlint:all', '-proc:none', '-d', tmpdir()],
    }], { unlessAny: ['pom.xml', 'build.gradle', 'build.gradle.kts'] })] }] },
  { name: 'yaml', match: ext('.yml', '.yaml'), steps: [{ tools: [one('yamllint', [files('yamllint')])] }] },
  {
    name: 'dockerfile',
    match: file => /^(dockerfile(\..+)?|.+\.dockerfile)$/i.test(path.basename(file)),
    steps: [{ tools: [one('hadolint', [files('hadolint')])] }],
  },
  { name: 'markdown', match: ext('.md', '.markdown'),
    steps: [{ tools: [one('markdownlint', [files('markdownlint')])] }] },
];
