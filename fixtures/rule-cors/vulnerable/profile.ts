import express from 'express';
import cors from 'cors';

const app = express();

// Bare cors() in an app that also has auth routes (see server.ts /api/login).
app.use(cors());

app.get('/api/profile', (req, res) => {
  res.json({ user: 'current-user' });
  void req;
});

app.listen(3001);
