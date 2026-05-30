import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import EventEmitter from 'events';

// --- helpers ---------------------------------------------------------------

// --- helpers ---------------------------------------------------------------

/**
 * Build a minimal GGUF v3 binary buffer with the given key-value pairs.
 */
function buildGgufBuffer(
  kv: Array<{ key: string; value: string | number; type?: 'string' | 'uint32' | 'uint64' }>,
): Buffer {
  const parts: Buffer[] = [];

  // Magic
  parts.push(Buffer.from('GGUF', 'ascii'));

  // Version 3
  const version = Buffer.alloc(4);
  version.writeUInt32LE(3, 0);
  parts.push(version);

  // n_tensors = 0 (uint64)
  const nTensors = Buffer.alloc(8);
  nTensors.writeBigUInt64LE(0n, 0);
  parts.push(nTensors);

  // n_kv = kv.length (uint64)
  const nKv = Buffer.alloc(8);
  nKv.writeBigUInt64LE(BigInt(kv.length), 0);
  parts.push(nKv);

  for (const entry of kv) {
    const keyBuf = Buffer.from(entry.key, 'utf-8');

    // key_len (uint64)
    const keyLen = Buffer.alloc(8);
    keyLen.writeBigUInt64LE(BigInt(keyBuf.length), 0);
    parts.push(keyLen);
    parts.push(keyBuf);

    if (typeof entry.value === 'string') {
      // value type = STRING (8)
      const typeBuf = Buffer.alloc(4);
      typeBuf.writeUInt32LE(8, 0);
      parts.push(typeBuf);

      const valBuf = Buffer.from(entry.value, 'utf-8');
      const valLen = Buffer.alloc(8);
      valLen.writeBigUInt64LE(BigInt(valBuf.length), 0);
      parts.push(valLen);
      parts.push(valBuf);
    } else {
      const useU64 = entry.type === 'uint64';
      const typeBuf = Buffer.alloc(4);
      typeBuf.writeUInt32LE(useU64 ? 10 : 4, 0); // 10=UINT64, 4=UINT32
      parts.push(typeBuf);

      if (useU64) {
        const valBuf = Buffer.alloc(8);
        valBuf.writeBigUInt64LE(BigInt(entry.value), 0);
        parts.push(valBuf);
      } else {
        const valBuf = Buffer.alloc(4);
        valBuf.writeUInt32LE(entry.value as number, 0);
        parts.push(valBuf);
      }
    }
  }

  return Buffer.concat(parts);
}

// --- mocks ----------------------------------------------------------------

const loggerMock = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.unstable_mockModule('../../../dist/utils/logger.js', () => ({
  logger: loggerMock,
}));

let fsReadStreamData: Buffer = Buffer.alloc(0);

jest.unstable_mockModule('fs', () => {
  return {
    createReadStream: jest.fn().mockImplementation(() => {
      const ee = new EventEmitter();
      process.nextTick(() => {
        ee.emit('data', fsReadStreamData);
        ee.emit('end');
      });
      return ee;
    }),
  };
});

// --- imports -------------------------------------------------------------

const { readGgufMetadata } = await import('../../../dist/modules/llama-cpp/gguf.js');
const { createReadStream } = await import('fs');

// -------------------------------------------------------------------------

describe('readGgufMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fsReadStreamData = Buffer.alloc(0);
  });

  it('tracer bullet: parses architecture and name from a minimal GGUF', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.architecture', value: 'llama' },
      { key: 'general.name', value: 'Llama-3-8B' },
    ]);

    const meta = await readGgufMetadata('/fake/model.gguf');

    expect(meta.architecture).toBe('llama');
    expect(meta.name).toBe('Llama-3-8B');
    expect(meta.isReasoningModel).toBe(false);
    expect(meta.recommendedFlags).not.toContain('--reasoning-format');
  });

  it('detects reasoning model when chat template contains <think>', async () => {
    const chatTemplate = '{% if messages[0].role == "system" %}{%- set system_message = messages[0].content -%}{% endif %}{{- "<think>\n</think>\n" -}}{{ system_message }}';
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.architecture', value: 'qwen2' },
      { key: 'general.name', value: 'Qwen3-14B' },
      { key: 'tokenizer.chat_template', value: chatTemplate },
    ]);

    const meta = await readGgufMetadata('/fake/qwen3.gguf');

    expect(meta.isReasoningModel).toBe(true);
    expect(meta.recommendedFlags).toContain('--reasoning-format');
    expect(meta.recommendedFlags).toContain('none');
  });

  it('detects reasoning model from name pattern (Qwen3)', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.name', value: 'Qwen3-14B-Instruct' },
    ]);

    const meta = await readGgufMetadata('/fake/qwen3.gguf');

    expect(meta.isReasoningModel).toBe(true);
    expect(meta.recommendedFlags).toContain('--reasoning-format');
  });

  it('detects reasoning model from name pattern (DeepSeek-R1)', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.name', value: 'DeepSeek-R1-Distill-Qwen-7B' },
    ]);

    const meta = await readGgufMetadata('/fake/deepseek.gguf');

    expect(meta.isReasoningModel).toBe(true);
  });

  it('does not flag normal model as reasoning model', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.architecture', value: 'llama' },
      { key: 'general.name', value: 'Llama-3.1-8B-Instruct' },
      { key: 'tokenizer.chat_template', value: '{{ user_message }}' },
    ]);

    const meta = await readGgufMetadata('/fake/llama.gguf');

    expect(meta.isReasoningModel).toBe(false);
    expect(meta.recommendedFlags).not.toContain('--reasoning-format');
  });

  it('extracts context length and adds --ctx-size flag', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.architecture', value: 'llama' },
      { key: 'llama.context_length', value: 32768, type: 'uint32' },
    ]);

    const meta = await readGgufMetadata('/fake/model.gguf');

    expect(meta.contextLength).toBe(32768);
    expect(meta.recommendedFlags).toContain('--ctx-size');
    expect(meta.recommendedFlags).toContain('32768');
  });

  it('caps context size to maxCtx when provided', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'llama.context_length', value: 131072, type: 'uint32' },
    ]);

    const meta = await readGgufMetadata('/fake/model.gguf', 4096);

    expect(meta.contextLength).toBe(131072);
    const ctxIdx = meta.recommendedFlags.indexOf('--ctx-size');
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(meta.recommendedFlags[ctxIdx + 1]).toBe('4096');
  });

  it('handles architecture-specific context_length keys (qwen2.context_length)', async () => {
    fsReadStreamData = buildGgufBuffer([
      { key: 'general.architecture', value: 'qwen2' },
      { key: 'qwen2.context_length', value: 65536, type: 'uint32' },
    ]);

    const meta = await readGgufMetadata('/fake/qwen2.gguf');

    expect(meta.contextLength).toBe(65536);
  });

  it('returns null metadata on missing file', async () => {
    (createReadStream as jest.Mock).mockImplementationOnce(() => {
      const ee = new EventEmitter();
      process.nextTick(() => ee.emit('error', new Error('ENOENT: no such file or directory')));
      return ee;
    });

    const meta = await readGgufMetadata('/nonexistent/model.gguf');

    expect(meta.architecture).toBeNull();
    expect(meta.name).toBeNull();
    expect(meta.contextLength).toBeNull();
    expect(meta.isReasoningModel).toBe(false);
    expect(meta.recommendedFlags).toEqual([]);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('returns null metadata on invalid magic bytes', async () => {
    fsReadStreamData = Buffer.from('NOTGGUF this is not a valid gguf file at all', 'ascii');

    const meta = await readGgufMetadata('/fake/invalid.bin');

    expect(meta.architecture).toBeNull();
    expect(meta.isReasoningModel).toBe(false);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('returns null metadata on too-small file', async () => {
    fsReadStreamData = Buffer.from('GGU', 'ascii'); // only 3 bytes

    const meta = await readGgufMetadata('/fake/tiny.gguf');

    expect(meta.architecture).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it('returns partial metadata gracefully if buffer truncated mid-parse', async () => {
    // Build a valid buffer but truncate it mid-way through the second KV pair
    const full = buildGgufBuffer([
      { key: 'general.architecture', value: 'llama' },
      { key: 'general.name', value: 'Llama-3-8B' },
    ]);
    fsReadStreamData = full.slice(0, full.length - 5); // truncate last 5 bytes

    // Should not throw; may return partial metadata
    const meta = await readGgufMetadata('/fake/truncated.gguf');
    expect(meta).toBeDefined();
    expect(typeof meta.isReasoningModel).toBe('boolean');
  });
});
