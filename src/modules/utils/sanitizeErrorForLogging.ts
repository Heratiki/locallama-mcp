const REDACTED = '[REDACTED]';

const CREDENTIAL_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
  'x-auth-token',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeString(value: string): string {
  return value.replace(
    /(authorization|proxy-authorization|x-api-key|api-key|cookie|set-cookie|x-auth-token)\s*:\s*[^\r\n]+/gi,
    (_match, headerName) => `${headerName}: ${REDACTED}`,
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  const sanitizedEntries = Object.entries(value).map(([key, entryValue]) => {
    if (CREDENTIAL_HEADER_NAMES.has(key.toLowerCase())) {
      return [key, REDACTED] as const;
    }

    return [key, sanitizeValue(entryValue, seen)] as const;
  });

  seen.delete(value);
  return Object.fromEntries(sanitizedEntries);
}

export function sanitizeErrorForLogging(error: unknown, message?: string): Error {
  const fallback = error instanceof Error ? error : new Error(String(error));
  const sanitized = new Error(message ?? fallback.message);
  sanitized.name = fallback.name;

  if (fallback.stack) {
    sanitized.stack = fallback.stack;
  }

  const enumerableProps = sanitizeValue(fallback as unknown as Record<string, unknown>, new WeakSet<object>());
  if (isPlainObject(enumerableProps)) {
    Object.assign(sanitized as unknown as Record<string, unknown>, enumerableProps);
  }

  return sanitized;
}