import { homedir } from 'node:os';
import { findBin } from '../checks/lint/index.js';
import type { ResearchSourceAdapter, SourceText } from './sources.js';
import { runTool, ToolMissingError } from './sources.js';

/**
 * Offline explain adapter (#163): error codes in the failing check output map
 * to an offline explain command (argv only, no shell) or a URL hint.
 */
export interface ExplainCommand {
  argv?: string[];
  /** Hint only; nothing is fetched. */
  hint?: string;
}

const MAX_COMMANDS = 3;
const EXPLAIN_CHARS = 1200;

/** Detect error codes in the failing output and map them to explain commands. */
export function explainCommands(errorText: string): ExplainCommand[] {
  const out: ExplainCommand[] = [];
  const seen = new Set<string>();
  const add = (key: string, command: ExplainCommand): void => {
    if (seen.has(key) || out.length >= MAX_COMMANDS) return;
    seen.add(key);
    out.push(command);
  };
  for (const match of errorText.matchAll(/error\[(E\d{4})\]/g)) add(`rustc ${match[1]}`, { argv: ['rustc', '--explain', match[1]] });
  for (const match of errorText.matchAll(/clippy::([a-z][a-z0-9_]{1,63})\b/g)) {
    add(`clippy ${match[1]}`, { argv: ['cargo', 'clippy', '--explain', match[1]] });
  }
  for (const match of errorText.matchAll(/:\d+:\d+: ([A-Z]{1,4}\d{3,4})\b/g)) {
    if (/^S[AC]/.test(match[1])) continue;
    add(`ruff ${match[1]}`, { argv: ['ruff', 'rule', match[1]] });
  }
  for (const match of errorText.matchAll(/\b((?:SA|ST)\d{4}|S1\d{3}|U1000)\b/g)) {
    add(`staticcheck ${match[1]}`, { argv: ['staticcheck', '-explain', match[1]] });
  }
  for (const match of errorText.matchAll(/\b(SC\d{4})\b/g)) {
    add(`shellcheck ${match[1]}`, { hint: `https://www.shellcheck.net/wiki/${match[1]}` });
  }
  return out;
}

export const explainAdapter: ResearchSourceAdapter = {
  source: 'explain',
  async run(_query, ctx): Promise<SourceText> {
    const commands = explainCommands(ctx.errorText ?? '');
    if (commands.length === 0) return { text: '', skipped: 'no_error_code' };
    const parts: string[] = [];
    let missing = false;
    for (const command of commands) {
      if (command.hint) { parts.push(`See ${command.hint}`); continue; }
      const argv = command.argv!;
      const abs = findBin(argv[0], ctx.workspacePath, process.env.PATH ?? '', process.env.HOME || homedir());
      if (!abs) { missing = true; continue; }
      let result;
      try {
        result = await runTool([abs, ...argv.slice(1)], { cwd: ctx.workspacePath, timeoutMs: ctx.timeoutMs });
      } catch (error) {
        if (error instanceof ToolMissingError) { missing = true; continue; }
        throw error;
      }
      if (result.timedOut) return { text: '', timedOut: true };
      if (result.ok && result.output) parts.push(`${argv.join(' ')}:\n${result.output.slice(0, EXPLAIN_CHARS)}`);
    }
    if (parts.length === 0) return { text: '', skipped: missing ? 'tool_missing' : 'no_output' };
    return { text: parts.join('\n') };
  },
};
