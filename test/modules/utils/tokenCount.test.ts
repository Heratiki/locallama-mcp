import { describe, expect, it } from '@jest/globals';

// Tests import from dist/ (compiled) per project convention.
const { estimateTokens, estimatePromptTokens } = await import(
  '../../../dist/modules/utils/tokenCount.js'
);

describe('estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns a small positive number for a short string', () => {
    const result = estimateTokens('hello world');
    expect(result).toBeGreaterThan(0);
    // "hello world" is 11 chars → ceil(11/4) = 3
    expect(result).toBe(3);
  });

  it('rounds up (ceiling) for non-divisible lengths', () => {
    // 5 chars → ceil(5/4) = 2
    expect(estimateTokens('abcde')).toBe(2);
    // 4 chars → ceil(4/4) = 1
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('scales linearly with text length', () => {
    const short = estimateTokens('a'.repeat(100));
    const long = estimateTokens('a'.repeat(200));
    expect(long).toBe(short * 2);
  });
});

describe('estimatePromptTokens', () => {
  it('returns sum of both parts plus 4 overhead tokens', () => {
    const system = 'You are a helpful assistant.'; // 28 chars → ceil(28/4)=7
    const user = 'Write a function.';             // 17 chars → ceil(17/4)=5
    const expected = 7 + 5 + 4; // 16
    expect(estimatePromptTokens(system, user)).toBe(expected);
  });

  it('handles empty strings with only the overhead', () => {
    expect(estimatePromptTokens('', '')).toBe(4);
  });
});
