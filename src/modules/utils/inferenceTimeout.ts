export class InferenceTimeoutError extends Error {
  readonly name = 'InferenceTimeoutError' as const;

  constructor(
    public readonly providerId: string,
    public readonly timeoutMs: number,
    message?: string,
  ) {
    super(message ?? `Inference timed out after ${timeoutMs}ms for provider '${providerId}'`);
  }
}
