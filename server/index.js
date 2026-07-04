import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { randomUUID } from 'node:crypto';

import { ensureSession, addTurn, getTurns } from './db.js';
import {
  transcribe,
  reply,
  synthesize,
  defaultPersona,
  LANGS,
  MOCK,
} from './sarvam.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB / ~30s of WAV
});

// Health + capability probe (frontend uses `mock` to decide TTS strategy).
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mock: MOCK,
    languages: LANGS,
    defaultPersona: defaultPersona(),
  });
});

// Create / configure a conversation session.
app.post('/api/session', (req, res) => {
  const id = randomUUID();
  const { persona, langPref } = req.body || {};
  const session = ensureSession({
    id,
    persona: persona || defaultPersona(),
    langPref: langPref || 'auto',
  });
  res.json({ session });
});

app.get('/api/session/:id/turns', (req, res) => {
  res.json({ turns: getTurns(req.params.id) });
});

// Core voice turn: audio in -> STT -> LLM -> TTS -> reply out.
app.post('/api/chat', upload.single('audio'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const langPref = req.body.langPref || 'auto';
    const persona = req.body.persona || defaultPersona();
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (!req.file && !req.body.text)
      return res.status(400).json({ error: 'audio or text required' });

    ensureSession({ id: sessionId, persona, langPref });

    // 1. Speech-to-text (or accept typed text for testing).
    let transcript, language;
    if (req.body.text) {
      transcript = req.body.text.trim();
      language = langPref !== 'auto' ? langPref : 'en-IN';
    } else {
      ({ transcript, language } = await transcribe(req.file.buffer, langPref));
    }
    if (!transcript) return res.status(422).json({ error: 'Could not hear anything. Please try again.' });

    const userTurn = addTurn({ sessionId, role: 'user', text: transcript, language });

    // 2. LLM reply in the detected language.
    const history = getTurns(sessionId).slice(0, -1); // exclude the turn we just added
    const replyText = await reply({ persona, history, userText: transcript, language });
    addTurn({ sessionId, role: 'agent', text: replyText, language });

    // 3. Text-to-speech (null in mock mode -> browser speaks it).
    const audio = await synthesize(replyText, language);

    res.json({
      transcript,
      language,
      languageName: LANGS[language]?.name || language,
      reply: replyText,
      audio, // base64 WAV or null
      mock: MOCK,
      createdAt: userTurn.created_at,
    });
  } catch (err) {
    console.error('[/api/chat]', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(
    `\n  Vaani server on http://localhost:${PORT}  ` +
      (MOCK
        ? '\n  MODE: MOCK (no SARVAM_API_KEY) — canned STT/LLM, browser voice.\n'
        : '\n  MODE: LIVE (Sarvam AI connected).\n')
  );
});
