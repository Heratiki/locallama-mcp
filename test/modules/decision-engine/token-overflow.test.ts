import { describe, expect, it } from '@jest/globals';

const { assertPromptWithinContextWindow, ContextWindowError } = await import(
  '../../../dist/modules/utils/contextWindow.js'
);
const { countTokens } = await import('../../../dist/modules/utils/tokenCount.js');

describe('token overflow enforcement', () => {
  it('allows a short prompt below the model context window', () => {
    const prompt = 'Write a small TypeScript add function.';
    const estimatedTokens = countTokens(prompt);

    expect(() =>
      assertPromptWithinContextWindow(
        { id: 'test-model', contextWindow: estimatedTokens + 10 },
        prompt,
      ),
    ).not.toThrow();
  });

  it('allows a prompt exactly at the model context boundary', () => {
    const prompt = 'Return only the code for a debounce helper.';
    const estimatedTokens = countTokens(prompt);

    expect(
      assertPromptWithinContextWindow(
        { id: 'boundary-model', contextWindow: estimatedTokens },
        prompt,
      ),
    ).toBe(estimatedTokens);
  });

  it('throws context overflow with counts when a prompt exceeds the boundary', () => {
    const prompt = 'token '.repeat(200);
    const estimatedTokens = countTokens(prompt);

    expect(() =>
      assertPromptWithinContextWindow(
        { id: 'tiny-context-model', contextWindow: estimatedTokens - 1 },
        prompt,
      ),
    ).toThrow(ContextWindowError);

    try {
      assertPromptWithinContextWindow(
        { id: 'tiny-context-model', contextWindow: estimatedTokens - 1 },
        prompt,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ContextWindowError);
      expect((error as InstanceType<typeof ContextWindowError>).estimatedTokens).toBe(estimatedTokens);
      expect((error as InstanceType<typeof ContextWindowError>).modelContextWindow).toBe(estimatedTokens - 1);
    }
  });
});
