import express from 'express';

const app = express();

const config = { debug: process.env.DEBUG === 'true', port: 3000 };

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization;
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

if (process.env.NODE_ENV !== 'production') {
  // Extra request logging in development only — no security control involved.
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

app.get('/admin', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port);
