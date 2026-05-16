import { describe, expect, it, beforeEach } from '@jest/globals';

// hints.ts has no logger dependency; import directly.
const hintsModule = await import('../../../../dist/modules/core/client/hints.js');
const { setClientHints, getClientHints } = hintsModule;

describe('client hints', () => {
  // Reset to unknown before every test so state doesn't bleed between cases.
  beforeEach(() => {
    setClientHints(undefined);
  });

  describe('getClientHints — defaults', () => {
    it('returns unknown clientName when no client has connected', () => {
      expect(getClientHints().clientName).toBe('unknown');
    });

    it('returns the default preferredMaxOutputTokens', () => {
      expect(getClientHints().preferredMaxOutputTokens).toBe(4096);
    });

    it('returns coarse subtaskGranularity by default', () => {
      expect(getClientHints().subtaskGranularity).toBe('coarse');
    });

    it('does not prefer plain text by default', () => {
      expect(getClientHints().preferPlainText).toBe(false);
    });
  });

  describe('setClientHints — known clients', () => {
    it('applies claude-code overrides', () => {
      setClientHints('claude-code');
      const hints = getClientHints();
      expect(hints.clientName).toBe('claude-code');
      expect(hints.preferredMaxOutputTokens).toBe(8192);
      expect(hints.subtaskGranularity).toBe('fine');
      expect(hints.preferPlainText).toBe(false);
    });

    it('applies codex-cli overrides', () => {
      setClientHints('codex-cli');
      const hints = getClientHints();
      expect(hints.clientName).toBe('codex-cli');
      expect(hints.preferredMaxOutputTokens).toBe(4096);
      expect(hints.subtaskGranularity).toBe('coarse');
      expect(hints.preferPlainText).toBe(false);
    });

    it('applies github-copilot-chat overrides', () => {
      setClientHints('github-copilot-chat');
      const hints = getClientHints();
      expect(hints.clientName).toBe('github-copilot-chat');
      expect(hints.preferredMaxOutputTokens).toBe(2048);
      expect(hints.subtaskGranularity).toBe('coarse');
      expect(hints.preferPlainText).toBe(true);
    });

    it('applies cline overrides', () => {
      setClientHints('cline');
      const hints = getClientHints();
      expect(hints.clientName).toBe('cline');
      expect(hints.preferredMaxOutputTokens).toBe(8192);
      expect(hints.subtaskGranularity).toBe('fine');
      expect(hints.preferPlainText).toBe(false);
    });

    it('applies roo-code overrides', () => {
      setClientHints('roo-code');
      const hints = getClientHints();
      expect(hints.clientName).toBe('roo-code');
      expect(hints.preferredMaxOutputTokens).toBe(8192);
      expect(hints.subtaskGranularity).toBe('fine');
      expect(hints.preferPlainText).toBe(false);
    });
  });

  describe('setClientHints — normalisation', () => {
    it('lower-cases the client name', () => {
      setClientHints('Claude-Code');
      expect(getClientHints().clientName).toBe('claude-code');
      expect(getClientHints().preferredMaxOutputTokens).toBe(8192);
    });

    it('trims whitespace from the client name', () => {
      setClientHints('  cline  ');
      expect(getClientHints().clientName).toBe('cline');
      expect(getClientHints().subtaskGranularity).toBe('fine');
    });

    it('uses defaults for an unknown client name', () => {
      setClientHints('my-custom-agent');
      const hints = getClientHints();
      expect(hints.clientName).toBe('my-custom-agent');
      expect(hints.preferredMaxOutputTokens).toBe(4096);
      expect(hints.subtaskGranularity).toBe('coarse');
      expect(hints.preferPlainText).toBe(false);
    });

    it('treats undefined as unknown', () => {
      setClientHints(undefined);
      expect(getClientHints().clientName).toBe('unknown');
    });

    it('treats empty string as empty clientName with default overrides', () => {
      setClientHints('');
      const hints = getClientHints();
      expect(hints.clientName).toBe('');
      expect(hints.preferredMaxOutputTokens).toBe(4096);
      expect(hints.subtaskGranularity).toBe('coarse');
    });
  });

  describe('setClientHints — replaces previous state', () => {
    it('overwrites a prior client', () => {
      setClientHints('claude-code');
      setClientHints('github-copilot-chat');
      expect(getClientHints().clientName).toBe('github-copilot-chat');
      expect(getClientHints().preferredMaxOutputTokens).toBe(2048);
    });

    it('reset to defaults when called with undefined', () => {
      setClientHints('cline');
      setClientHints(undefined);
      expect(getClientHints().clientName).toBe('unknown');
      expect(getClientHints().preferredMaxOutputTokens).toBe(4096);
    });
  });
});
