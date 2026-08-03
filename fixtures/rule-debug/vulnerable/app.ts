import express from 'express';

const app = express();

const config = { debug: true, port: 3000 };

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // "Temporary" dev shortcut the agent left in — auth is skipped unless NODE_ENV=production.
  if (process.env.NODE_ENV !== 'production') return next();
  const token = req.headers.authorization;
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

app.get('/admin', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// Verbose error middleware — ships stack traces to every client.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: err.message, stack: err.stack });
});

app.listen(config.port);
