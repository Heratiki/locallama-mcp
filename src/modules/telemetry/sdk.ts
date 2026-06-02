/**
 * OTel SDK initialisation (compatible with @opentelemetry/sdk-trace-node v2+).
 *
 * Always writes to ~/.locallama/telemetry.jsonl via FileSpanExporter.
 * Optionally forwards to any OTLP-compatible backend (Jaeger, Tempo, etc.)
 * when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { FileSpanExporter } from './file-exporter.js';

let provider: NodeTracerProvider | undefined;

export function initTelemetry(serviceVersion: string): void {
  if (provider) return;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'locallama-mcp',
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });

  const spanProcessors = [new BatchSpanProcessor(new FileSpanExporter())];

  const otlpBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpBase) {
    const url = otlpBase.endsWith('/v1/traces') ? otlpBase : `${otlpBase}/v1/traces`;
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url })));
  }

  provider = new NodeTracerProvider({ resource, spanProcessors });
  provider.register();
}

export async function shutdownTelemetry(): Promise<void> {
  if (provider) {
    await provider.shutdown();
    provider = undefined;
  }
}
