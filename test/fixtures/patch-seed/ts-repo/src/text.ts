export function slugify(text: string): string {
  return text.toLowerCase().replace(/ /g, '-');
}

export function truncate(text: string, limit: number): string {
  return text.slice(0, limit);
}

export function initials(name: string): string {
  return name[0] ?? '';
}
