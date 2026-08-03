import express from 'express';
import cors from 'cors';

const app = express();

// Any origin, with cookies — the classic vibe-coded CORS footgun.
app.use(cors({ origin: '*', credentials: true }));

app.post('/api/login', (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (email && password) {
    res.json({ token: 'session-token' });
  } else {
    res.status(401).json({ error: 'unauthorized' });
  }
});

app.use('/api/admin', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
  void req;
});

app.listen(3000);
