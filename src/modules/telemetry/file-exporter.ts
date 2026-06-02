/**
 * Custom OTel SpanExporter (compatible with sdk-trace-base v2+).
 * Appends spans as NDJSON to ~/.locallama/telemetry.jsonl for persistent,
 * multi-run analysis.  Rotates at MAX_FILE_BYTES.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode } from '@opentelemetry/core';
import type { ExportResult } from '@opentelemetry/core';

export const TELEMETRY_DIR = path.join(os.homedir(), '.locallama');
export const TELEMETRY_FILE = path.join(TELEMETRY_DIR, 'telemetry.jsonl');
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB then rotate

export interface TelemetrySpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  attributes: Record<string, unknown>;
  status: 'OK' | 'ERROR' | 'UNSET';
  errorMessage?: string;
  events: Array<{
    name: string;
    timeMs: number;
    attributes?: Record<string, unknown>;
  }>;
}

function hrToMs([sec, nano]: [number, number]): number {
  return sec * 1000 + nano / 1_000_000;
}

export class FileSpanExporter implements SpanExporter {
  private stream: fs.WriteStream | null = null;
  private bytes = 0;

  constructor() {
    try {
      fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
    } catch {
      // ignore
    }
    try {
      this.bytes = fs.statSync(TELEMETRY_FILE).size;
    } catch {
      this.bytes = 0;
    }
    this.openStream();
  }

  private openStream(): void {
    try {
      this.stream = fs.createWriteStream(TELEMETRY_FILE, { flags: 'a' });
    } catch {
      this.stream = null;
    }
  }

  private rotate(): void {
    try {
      this.stream?.end();
      const rotated = TELEMETRY_FILE.replace('.jsonl', `.${Date.now()}.jsonl`);
      fs.renameSync(TELEMETRY_FILE, rotated);
    } catch {
      // ignore rotate errors
    }
    this.bytes = 0;
    this.openStream();
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (!this.stream) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    if (this.bytes > MAX_FILE_BYTES) this.rotate();

    try {
      for (const span of spans) {
        const ctx = span.spanContext();
        // v2: parentSpanId lives in parentSpanContext?.spanId
        const parentSpanId =
          (span as unknown as { parentSpanContext?: { spanId?: string } })
            .parentSpanContext?.spanId;

        const rec: TelemetrySpanRecord = {
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          ...(parentSpanId ? { parentSpanId } : {}),
          name: span.name,
          startTimeMs: hrToMs(span.startTime as [number, number]),
          endTimeMs: hrToMs(span.endTime as [number, number]),
          durationMs: hrToMs(span.duration as [number, number]),
          attributes: span.attributes as Record<string, unknown>,
          status: span.status.code === 2 ? 'ERROR' : span.status.code === 1 ? 'OK' : 'UNSET',
          ...(span.status.message ? { errorMessage: span.status.message } : {}),
          events: span.events.map((e) => ({
            name: e.name,
            timeMs: hrToMs(e.time as [number, number]),
            ...(e.attributes && Object.keys(e.attributes).length > 0
              ? { attributes: e.attributes as Record<string, unknown> }
              : {}),
          })),
        };
        const line = JSON.stringify(rec) + '\n';
        this.stream.write(line);
        this.bytes += line.length;
      }
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (err) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stream) {
        this.stream.end(resolve);
        this.stream = null;
      } else {
        resolve();
      }
    });
  }
}
