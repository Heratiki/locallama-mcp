import { describe, expect, it } from '@jest/globals';

// Tests import from dist/ (compiled) per project convention.
const { countTokens, estimateTokens, estimatePromptTokens } = await import(
  '../../../dist/modules/utils/tokenCount.js'
);

describe('countTokens / estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(countTokens('')).toBe(0);
    expect(estimateTokens('')).toBe(0);
  });

  it('uses tiktoken counts for a short string', () => {
    const result = estimateTokens('hello world');
    expect(result).toBeGreaterThan(0);
    expect(result).toBe(countTokens('hello world'));
    expect(result).toBe(2);
  });

  it('handles common code-like tokens through the tokenizer', () => {
    const text = 'const add = (a, b) => a + b;';
    expect(estimateTokens(text)).toBe(countTokens(text));
    expect(estimateTokens(text)).toBeGreaterThan(5);
  });

  it('increases as text length grows', () => {
    const short = estimateTokens('a'.repeat(100));
    const long = estimateTokens('a'.repeat(200));
    expect(long).toBeGreaterThan(short);
  });
});

describe('estimatePromptTokens', () => {
  it('returns tokenizer counts for both parts plus 4 overhead tokens', () => {
    const system = 'You are a helpful assistant.';
    const user = 'Write a function.';
    const expected = countTokens(system) + countTokens(user) + 4;
    expect(estimatePromptTokens(system, user)).toBe(expected);
  });

  it('handles empty strings with only the overhead', () => {
    expect(estimatePromptTokens('', '')).toBe(4);
  });
});
