export function median(values: number[]): number {
  return values[Math.floor(values.length / 2)] ?? 0;
}
