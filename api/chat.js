// POST /api/chat  — one voice turn: audio/text in -> STT -> LLM -> TTS out.
// Stateless: the browser sends the running `history` with every request, so this
// works on Vercel serverless (no DB / no file system needed).
//
// Body (JSON): { audioBase64?, text?, langPref, persona, history: [{role,text}] }
import { runTurn } from './_sarvam.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { audioBase64, text, langPref, persona, history } = req.body || {};
    if (!audioBase64 && !text) {
      res.status(400).json({ error: 'audioBase64 or text required' });
      return;
    }
    const result = await runTurn({ audioBase64, text, langPref, persona, history });
    res.status(200).json(result);
  } catch (err) {
    console.error('[/api/chat]', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  }
}
