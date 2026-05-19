/**
 * Lightweight token estimator.
 *
 * Uses the well-known approximation of 1 token ≈ 4 characters for English /
 * code text.  This is intentionally simple so it can be swapped for a real
 * tokenizer (e.g. tiktoken) without touching call sites.
 */

/**
 * Estimate the number of tokens in `text`.
 * Returns 0 for empty / falsy input.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the total tokens for a chat-style prompt that consists of a system
 * prompt and a user content string.  Adds a small fixed overhead (~4 tokens)
 * for message structure delimiters.
 */
export function estimatePromptTokens(systemPrompt: string, userContent: string): number {
  const OVERHEAD = 4;
  return estimateTokens(systemPrompt) + estimateTokens(userContent) + OVERHEAD;
}
