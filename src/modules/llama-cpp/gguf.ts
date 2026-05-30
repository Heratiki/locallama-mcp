import { createReadStream } from 'fs';
import { logger } from '../../utils/logger.js';

export interface GgufMetadata {
  architecture: string | null;
  name: string | null;
  chatTemplate: string | null;
  contextLength: number | null;
  isReasoningModel: boolean;
  recommendedFlags: string[];
}

const GGUF_MAGIC = 'GGUF';

const REASONING_NAME_PATTERNS = [/qwen3/i, /deepseek-r\d/i, /phi-4-reasoning/i];

// GGUF value type constants
const T_UINT8 = 0, T_INT8 = 1, T_UINT16 = 2, T_INT16 = 3;
const T_UINT32 = 4, T_INT32 = 5, T_FLOAT32 = 6, T_BOOL = 7;
const T_STRING = 8, T_ARRAY = 9, T_UINT64 = 10, T_INT64 = 11, T_FLOAT64 = 12;

function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function readU64(buf: Buffer, offset: number): number {
  return Number(buf.readBigUInt64LE(offset));
}

/**
 * Returns the number of bytes occupied by a value of the given type starting at buf[offset].
 * For composite types (STRING, ARRAY) this reads length fields from the buffer.
 */
function valueSize(type: number, buf: Buffer, offset: number): number {
  switch (type) {
    case T_UINT8: case T_INT8: case T_BOOL: return 1;
    case T_UINT16: case T_INT16: return 2;
    case T_UINT32: case T_INT32: case T_FLOAT32: return 4;
    case T_UINT64: case T_INT64: case T_FLOAT64: return 8;
    case T_STRING: {
      const len = readU64(buf, offset);
      return 8 + len;
    }
    case T_ARRAY: {
      const elemType = readU32(buf, offset);
      const count = readU64(buf, offset + 4);
      let total = 12; // 4 (elem_type) + 8 (count)
      let elemOff = offset + 12;
      for (let i = 0; i < count; i++) {
        const s = valueSize(elemType, buf, elemOff);
        total += s;
        elemOff += s;
      }
      return total;
    }
    default:
      throw new Error(`Unknown GGUF value type: ${type}`);
  }
}

/** Extract a string or numeric value; returns null for unsupported types. */
function extractValue(type: number, buf: Buffer, offset: number): string | number | null {
  switch (type) {
    case T_UINT32: case T_INT32: return readU32(buf, offset);
    case T_UINT64: case T_INT64: return readU64(buf, offset);
    case T_STRING: {
      const len = readU64(buf, offset);
      return buf.slice(offset + 8, offset + 8 + len).toString('utf-8');
    }
    default: return null;
  }
}

function buildFlags(
  chatTemplate: string | null,
  name: string | null,
  contextLength: number | null,
  maxCtx: number | null,
): { isReasoningModel: boolean; recommendedFlags: string[] } {
  const isReasoningModel =
    (chatTemplate !== null && chatTemplate.includes('<think>')) ||
    (name !== null && REASONING_NAME_PATTERNS.some((r) => r.test(name)));

  const flags: string[] = [];
  if (isReasoningModel) flags.push('--reasoning-format', 'none');
  if (contextLength !== null) {
    const ctx = maxCtx !== null ? Math.min(contextLength, maxCtx) : contextLength;
    flags.push('--ctx-size', String(ctx));
  }
  return { isReasoningModel, recommendedFlags: flags };
}

async function readFirstBytes(filePath: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytesRead = 0;
    const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
    const finish = () => resolve(Buffer.concat(chunks));
    stream.on('data', (chunk: Buffer | string) => {
      const chunkBuf: Buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) { stream.destroy(); return; }
      const slice = chunkBuf.length <= remaining ? chunkBuf : chunkBuf.slice(0, remaining);
      chunks.push(slice);
      bytesRead += slice.length;
      if (bytesRead >= maxBytes) stream.destroy();
    });
    stream.on('end', finish);
    stream.on('close', finish);
    stream.on('error', reject);
  });
}

const NULL_RESULT: GgufMetadata = {
  architecture: null, name: null, chatTemplate: null, contextLength: null,
  isReasoningModel: false, recommendedFlags: [],
};

/**
 * Read GGUF file header and extract model metadata without loading the model.
 * Returns a result with all-null fields on any read or parse failure.
 *
 * @param maxCtx - Optional cap for --ctx-size flag (LLAMA_CPP_MAX_CTX)
 */
export async function readGgufMetadata(
  modelPath: string,
  maxCtx: number | null = null,
): Promise<GgufMetadata> {
  try {
    const buf = await readFirstBytes(modelPath, 4 * 1024 * 1024);

    if (buf.length < 24) {
      logger.warn(`GGUF file too small to parse header: ${modelPath}`);
      return { ...NULL_RESULT };
    }

    const magic = buf.slice(0, 4).toString('ascii');
    if (magic !== GGUF_MAGIC) {
      logger.warn(`Not a GGUF file (bad magic "${magic}"): ${modelPath}`);
      return { ...NULL_RESULT };
    }

    const version = readU32(buf, 4);
    if (version < 2) {
      logger.warn(`Unsupported GGUF version ${version} (need ≥ 2): ${modelPath}`);
      return { ...NULL_RESULT };
    }

    // Version 2+: n_tensors @ 8 (uint64), n_kv @ 16 (uint64)
    const nKv = readU64(buf, 16);
    let pos = 24;

    let architecture: string | null = null;
    let name: string | null = null;
    let chatTemplate: string | null = null;
    let contextLength: number | null = null;

    for (let i = 0; i < nKv && pos < buf.length; i++) {
      try {
        if (pos + 8 > buf.length) break;
        const keyLen = readU64(buf, pos);
        pos += 8;
        if (pos + keyLen > buf.length) break;
        const key = buf.slice(pos, pos + keyLen).toString('utf-8');
        pos += keyLen;

        if (pos + 4 > buf.length) break;
        const valType = readU32(buf, pos);
        pos += 4;

        const isTarget =
          key === 'general.architecture' ||
          key === 'general.name' ||
          key === 'tokenizer.chat_template' ||
          key.endsWith('.context_length');

        const size = valueSize(valType, buf, pos);

        if (isTarget) {
          const val = extractValue(valType, buf, pos);
          if (val !== null) {
            if (key === 'general.architecture') architecture = String(val);
            else if (key === 'general.name') name = String(val);
            else if (key === 'tokenizer.chat_template') chatTemplate = String(val);
            else if (key.endsWith('.context_length') && typeof val === 'number') contextLength = val;
          }
        }

        pos += size;
      } catch {
        // Buffer boundary hit mid-parse — stop with what we have
        break;
      }
    }

    const { isReasoningModel, recommendedFlags } = buildFlags(chatTemplate, name, contextLength, maxCtx);
    return { architecture, name, chatTemplate, contextLength, isReasoningModel, recommendedFlags };
  } catch (err) {
    logger.warn(
      `Failed to read GGUF metadata from ${modelPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ...NULL_RESULT };
  }
}
