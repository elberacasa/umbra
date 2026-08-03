import express from 'express';
import cors from 'cors';

const app = express();

// Public read-only API, no auth anywhere — an open CORS policy is intentional.
app.use(cors());

app.get('/api/quote-of-the-day', (_req, res) => {
  res.json({ quote: 'Ship it.' });
});

app.listen(3002);
