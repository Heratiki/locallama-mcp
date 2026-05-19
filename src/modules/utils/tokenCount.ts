import { getEncoding, Tiktoken, TiktokenEncoding } from 'js-tiktoken';

const encoderCache = new Map<string, Tiktoken>();
const KNOWN_ENCODINGS = new Set(['cl100k_base', 'p50k_base', 'r50k_base', 'gpt2']);

function resolveEncodingName(model: string): TiktokenEncoding {
  if (KNOWN_ENCODINGS.has(model)) return model as TiktokenEncoding;
  if (model.toLowerCase().includes('gpt-4o')) return 'cl100k_base';
  return 'cl100k_base';
}

function getTokenEncoder(model: string): Tiktoken {
  const encodingName = resolveEncodingName(model || 'cl100k_base');
  const cached = encoderCache.get(encodingName);
  if (cached) return cached;

  try {
    const encoder = getEncoding(encodingName);
    encoderCache.set(encodingName, encoder);
    return encoder;
  } catch {
    const encoder = getEncoding('cl100k_base');
    encoderCache.set(encodingName, encoder);
    return encoder;
  }
}

/**
 * Estimate the number of tokens in `text`.
 * Returns 0 for empty / falsy input.
 */
export function countTokens(text: string, model: string = 'cl100k_base'): number {
  if (!text) return 0;
  return getTokenEncoder(model).encode(text).length;
}

export function estimateTokens(text: string, model: string = 'cl100k_base'): number {
  return countTokens(text, model);
}

/**
 * Estimate the total tokens for a chat-style prompt that consists of a system
 * prompt and a user content string.  Adds a small fixed overhead (~4 tokens)
 * for message structure delimiters.
 */
export function estimatePromptTokens(systemPrompt: string, userContent: string, model: string = 'cl100k_base'): number {
  const OVERHEAD = 4;
  return countTokens(systemPrompt, model) + countTokens(userContent, model) + OVERHEAD;
}
