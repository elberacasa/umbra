// Same sink as src/app.ts, but this is a test — suppressed.
export function makeQuery(id: string): string {
  return `SELECT * FROM users WHERE id = '${id}'`;
}
