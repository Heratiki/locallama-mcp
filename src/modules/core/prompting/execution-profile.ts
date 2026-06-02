import { getPromptingStrategyService } from './service.js';
import type { TaskExecutionOptions } from '../provider/types.js';

const FALLBACK_CODE_SYSTEM_PROMPT = [
  'You are an expert software engineer.',
  'Write in the language specified by the task; infer it from context if not stated, defaulting to the most appropriate language.',
  'Output the complete, working implementation first in a fenced code block with the language tag.',
  'Include correct type annotations and handle edge cases.',
  'Do not emit placeholder TODOs — implement fully.',
  'Add a brief explanation only when the approach is genuinely non-obvious.',
  'If a critical detail is missing, ask one concise clarifying question rather than guessing.',
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
