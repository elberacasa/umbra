import express from 'express';
import cors from 'cors';

const app = express();

const allowedOrigins = ['https://app.example.com', 'https://admin.example.com'];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.post('/api/login', (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  if (email && password) {
    res.json({ token: 'session-token' });
  } else {
    res.status(401).json({ error: 'unauthorized' });
  }
});

app.listen(3000);
