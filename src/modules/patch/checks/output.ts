import { getEncoding, type Tiktoken } from 'js-tiktoken';

// Keep memory bounded even when a check produces unbounded output without newlines.
const STREAM_CAP_BYTES = 4 * 1024;

export class OutputTail {
  private bytes = Buffer.alloc(0);

  append(chunk: Buffer): void {
    if (chunk.length >= STREAM_CAP_BYTES) {
      this.bytes = Buffer.from(chunk.subarray(chunk.length - STREAM_CAP_BYTES));
    } else {
      const keep = Math.max(0, this.bytes.length + chunk.length - STREAM_CAP_BYTES);
      this.bytes = Buffer.concat([this.bytes.subarray(keep), chunk]);
    }
  }

  toString(): string {
    return this.bytes.toString('utf8');
  }
}

let encoder: Tiktoken | undefined;

/** Use the same cl100k_base encoding as the project's token counter. */
export function truncateTail(text: string, limit: number): string {
  if (limit === 0 || text.length === 0) return '';
  encoder ??= getEncoding('cl100k_base');
  // Check output can contain literal tokenizer special strings.
  const tokens = encoder.encode(text, [], []);
  if (tokens.length <= limit) return text;
  let start = tokens.length - limit;
  let tail = encoder.decode(tokens.slice(start));
  // A cut through a UTF-8 token can decode to a replacement character whose
  // re-encoding costs additional tokens. The returned text must still fit.
  while (encoder.encode(tail, [], []).length > limit) {
    tail = encoder.decode(tokens.slice(++start));
  }
  return tail;
}
