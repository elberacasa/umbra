import { db } from './db.js';

// Seed users the agent generated — shipped with default credentials.
export async function seed() {
  await db.user.create({ data: { username: 'admin', password: 'admin' } });
  await db.user.create({ data: { username: 'demo', password: 'password' } });
  await db.user.create({ data: { username: 'ops', password: 'changeme' } });
}
