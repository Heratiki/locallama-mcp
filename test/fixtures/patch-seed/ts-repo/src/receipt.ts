import { formatCents } from './price.js';

export function receipt(label: string, cents: number): string {
  return `${label}: ${formatCents(cents)}`;
}
