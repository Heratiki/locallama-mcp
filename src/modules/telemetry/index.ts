/**
 * Telemetry helpers consumed by the rest of the codebase.
 *
 * Usage:
 *   import { withSpan } from '../../telemetry/index.js';
 *
 *   const result = await withSpan('provider.execute_task', { 'model.id': modelId }, async (span) => {
 *     const res = await provider.executeTask(...);
 *     span.setAttributes({ 'llm.prompt_tokens': res.promptTokens ?? 0 });
 *     return res;
 *   });
 */
import { trace, SpanStatusCode, type Span, type Attributes } from '@opentelemetry/api';

const TRACER_NAME = 'locallama-mcp';

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Run `fn` inside a named span. Sets OK/ERROR status automatically.
 * If telemetry is not initialised the span is a no-op (zero overhead).
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

export { initTelemetry, shutdownTelemetry } from './sdk.js';
export type { TelemetrySpanRecord } from './file-exporter.js';
