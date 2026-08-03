export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function formatStuff(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
