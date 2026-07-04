// Local dev server. On Vercel these routes are serverless functions under /api;
// locally we mount the exact same handlers on Express so `npm run dev` works
// without the Vercel CLI. Keep this file thin — all logic lives in ../api.
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import chat from '../api/chat.js';
import health from '../api/health.js';
import { MOCK } from '../api/_sarvam.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' })); // base64 audio can be a few hundred KB

app.get('/api/health', health);
app.post('/api/chat', chat);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(
    `\n  Vaani dev server on http://localhost:${PORT}  ` +
      (MOCK
        ? '\n  MODE: MOCK (no SARVAM_API_KEY) — canned STT/LLM, browser voice.\n'
        : '\n  MODE: LIVE (Sarvam AI connected).\n')
  );
});
