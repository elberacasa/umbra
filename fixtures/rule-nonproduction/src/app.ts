export function getUser(db: { query: (s: string) => unknown }, id: string): unknown {
  return db.query(`SELECT * FROM users WHERE id = '${id}'`);
}
