import { db } from './db.js';

export async function seed() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD must be set before seeding');
  }
  await db.user.create({ data: { username: 'admin', password: adminPassword } });
}
