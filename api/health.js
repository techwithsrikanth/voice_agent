// GET /api/health — capability probe. The client uses `mock` to decide whether
// to play server audio or fall back to the browser's speech synthesis.
import { MOCK, LANGS, defaultPersona } from './_sarvam.js';

export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    mock: MOCK,
    languages: LANGS,
    defaultPersona: defaultPersona(),
  });
}
