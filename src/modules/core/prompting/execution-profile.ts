import { getPromptingStrategyService } from './service.js';
import type { TaskExecutionOptions } from '../provider/types.js';

const FALLBACK_CODE_SYSTEM_PROMPT = [
  'You are a senior software engineer and coding assistant.',
  'Produce correct, idiomatic, production-quality code.',
  'Prefer the simplest solution that satisfies the task.',
  'When asked for code, output the code first and avoid unnecessary prose.',
  'Use modern language conventions and include only minimal explanatory comments when they add clarity.',
  'If important details are missing, ask one concise clarifying question instead of guessing.',
].join(' ');

const CODE_TASK_KEYWORDS = [
  'code',
  'coding',
  'function',
  'class',
  'method',
  'implement',
  'refactor',
  'debug',
  'bug',
  'typescript',
  'javascript',
  'python',
  'sql',
  'api',
  'endpoint',
  'algorithm',
  'unit test',
  'tests',
  'regex',
  'schema',
  'interface',
  'module',
  'optimize',
  'parse',
  'sort',
  'serialize',
  'deserialize',
];

export function isCodingTask(task: string): boolean {
  const text = task.toLowerCase();
  return CODE_TASK_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function buildCodeTaskExecutionOptions(
  task: string,
  providerId?: string,
): TaskExecutionOptions {
  if (!isCodingTask(task)) {
    return {};
  }

  const strategy = getPromptingStrategyService().getStrategy('coding');
  const systemPrompt = strategy?.systemPrompt ?? FALLBACK_CODE_SYSTEM_PROMPT;

  const temperature = providerId === 'openrouter' ? 0.2 : 0.1;
  const estimatedMaxTokens = Math.ceil(task.length * 2.5);
  const maxTokens = Math.max(1024, Math.min(4096, estimatedMaxTokens));

  return {
    stream: false,
    systemPrompt,
    temperature,
    maxTokens,
  };
}
