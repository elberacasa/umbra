export const infrastructure = {
  databaseUrl: 'postgres://postgres:postgres@db.internal:5432/app',
  cacheUrl: 'redis://default:changeme@cache.internal:6379',
  // rotated per environment, fine:
  queueUrl: process.env.QUEUE_URL,
};
