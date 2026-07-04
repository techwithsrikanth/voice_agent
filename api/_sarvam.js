// Sarvam AI client for the three pipeline stages: STT -> LLM -> TTS.
// Stateless + framework-agnostic: used by both the Vercel serverless functions
// (api/chat.js) and the local Express dev server (server/index.js).
// Falls back to a deterministic MOCK engine when SARVAM_API_KEY is not set.

const API = 'https://api.sarvam.ai';
const KEY = process.env.SARVAM_API_KEY?.trim();
export const MOCK = !KEY;

const STT_MODEL = process.env.SARVAM_STT_MODEL || 'saaras:v3';
const LLM_MODEL = process.env.SARVAM_LLM_MODEL || 'sarvam-30b';
const TTS_MODEL = process.env.SARVAM_TTS_MODEL || 'bulbul:v2';

// Supported languages for this MVP.
export const LANGS = {
  'ta-IN': { name: 'Tamil', speaker: 'anushka' },
  'hi-IN': { name: 'Hindi', speaker: 'anushka' },
  'en-IN': { name: 'English', speaker: 'anushka' },
};

const headers = () => ({ 'api-subscription-key': KEY });

// ---------------------------------------------------------------------------
// 1. Speech-to-Text
// audioBuffer: Buffer of a WAV file. Returns { transcript, language }.
// ---------------------------------------------------------------------------
export async function transcribe(audioBuffer, langHint = 'unknown') {
  if (MOCK) return mockTranscribe(langHint);

  const form = new FormData();
  form.append('model', STT_MODEL);
  form.append('mode', 'transcribe');
  if (langHint && langHint !== 'auto' && langHint !== 'unknown') {
    form.append('language_code', langHint);
  }
  form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');

  const res = await fetch(`${API}/speech-to-text`, {
    method: 'POST',
    headers: headers(),
    body: form,
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    transcript: (data.transcript || '').trim(),
    language: normalizeLang(data.language_code) || (langHint !== 'auto' ? langHint : 'en-IN'),
  };
}

// ---------------------------------------------------------------------------
// 2. LLM dialog (OpenAI-compatible chat completions)
// history: [{ role:'user'|'agent', text }]. Returns reply text.
// ---------------------------------------------------------------------------
export async function reply({ persona, history, userText, language }) {
  if (MOCK) return mockReply(userText, language);

  const langName = LANGS[language]?.name || 'the same language as the user';
  const script = {
    'ta-IN': 'Write ONLY in Tamil script (தமிழ்), never romanized.',
    'hi-IN': 'Write ONLY in Devanagari script (हिन्दी), never romanized.',
    'en-IN': 'Write in English.',
  }[language] || '';
  const system =
    `${persona || defaultPersona()}\n\n` +
    `You are a spoken voice agent on a phone-style call. Keep answers short, ` +
    `natural and conversational (1-3 sentences). ALWAYS respond in ${langName}. ` +
    `${script} ` +
    `Do not use markdown, emojis, or bullet points — this text is read aloud.`;

  const messages = [
    { role: 'system', content: system },
    ...(history || []).slice(-10).map((t) => ({
      role: t.role === 'agent' ? 'assistant' : 'user',
      content: t.text,
    })),
    { role: 'user', content: userText },
  ];

  // sarvam-30b is a reasoning model. We turn thinking off for fast, direct voice
  // replies. NOTE: do not set max_tokens — a residual reasoning trace is emitted
  // even with thinking off, and any cap can truncate it mid-trace, yielding empty
  // content. Even so, ~1 in 5 calls returns empty content, and for a given input
  // it can repeat, so we retry AND raise the temperature to break determinism.
  const temps = [0.5, 0.9, 1.1, 0.7];
  let lastErr;
  for (const temperature of temps) {
    const res = await fetch(`${API}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    if (!res.ok) {
      lastErr = new Error(`LLM ${res.status}: ${await res.text()}`);
      continue;
    }
    const data = await res.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (content) return content;
  }
  if (lastErr) throw lastErr;
  return ''; // all attempts empty -> runTurn falls back to a polite reprompt

}

// ---------------------------------------------------------------------------
// 3. Text-to-Speech. Returns base64 WAV string, or null in mock mode
//    (the browser then speaks it locally with the Web Speech API).
// ---------------------------------------------------------------------------
export async function synthesize(text, language) {
  if (MOCK) return null;

  const speaker = LANGS[language]?.speaker || 'anushka';
  const res = await fetch(`${API}/text-to-speech`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text.slice(0, 1500),
      target_language_code: language,
      speaker,
      model: TTS_MODEL,
      speech_sample_rate: 22050,
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.audios?.[0] || null;
}

// ---------------------------------------------------------------------------
// The one place the whole turn is orchestrated. Stateless: the caller passes
// the running `history`. Returns everything the client needs to render + play.
// ---------------------------------------------------------------------------
export async function runTurn({ audioBase64, text, langPref = 'auto', persona, history = [] }) {
  let transcript, language;
  if (text) {
    transcript = text.trim();
    language = langPref !== 'auto' ? langPref : 'en-IN';
  } else {
    const buffer = Buffer.from(audioBase64, 'base64');
    ({ transcript, language } = await transcribe(buffer, langPref));
  }
  if (!transcript) {
    const err = new Error('Could not hear anything. Please try again.');
    err.status = 422;
    throw err;
  }

  let replyText = await reply({
    persona: persona || defaultPersona(),
    history,
    userText: transcript,
    language,
  });
  // Guard: never send empty text to TTS (it 400s). Fall back to a polite prompt
  // in the caller's language.
  if (!replyText) replyText = EMPTY_FALLBACK[language] || EMPTY_FALLBACK['en-IN'];
  const audio = await synthesize(replyText, language);

  return {
    transcript,
    language,
    languageName: LANGS[language]?.name || language,
    reply: replyText,
    audio, // base64 WAV or null
    mock: MOCK,
  };
}

// ---------------------------------------------------------------------------
// Helpers + mock engine
// ---------------------------------------------------------------------------
export function defaultPersona() {
  return (
    'You are Vaani, a friendly customer-support voice agent for a mobile ' +
    'telecom company called AirWave. You help customers with recharges, ' +
    'plans, network issues and billing.'
  );
}

function normalizeLang(code) {
  if (!code || code === 'unknown') return null;
  if (LANGS[code]) return code;
  const short = code.slice(0, 2);
  return Object.keys(LANGS).find((l) => l.startsWith(short)) || null;
}

const MOCK_LINES = {
  'ta-IN': {
    stt: 'என் மொபைல் ரீசார்ஜ் பண்ண வேண்டும்.',
    reply: 'கண்டிப்பாக! உங்கள் மொபைல் நம்பரையும் நீங்கள் விரும்பும் திட்டத்தையும் சொல்லுங்கள், நான் ரீசார்ஜ் செய்கிறேன்.',
  },
  'hi-IN': {
    stt: 'मुझे अपना मोबाइल रिचार्ज करना है।',
    reply: 'बिलकुल! अपना मोबाइल नंबर और पसंदीदा प्लान बताइए, मैं अभी रिचार्ज कर देती हूँ।',
  },
  'en-IN': {
    stt: 'I want to recharge my mobile plan.',
    reply: 'Sure! Please tell me your mobile number and the plan you would like, and I will recharge it right away.',
  },
};

function mockTranscribe(langHint) {
  const language =
    langHint && langHint !== 'auto' && MOCK_LINES[langHint] ? langHint : 'en-IN';
  return { transcript: MOCK_LINES[language].stt, language };
}

function mockReply(_userText, language) {
  return (MOCK_LINES[language] || MOCK_LINES['en-IN']).reply;
}

const EMPTY_FALLBACK = {
  'ta-IN': 'மன்னிக்கவும், அதை மீண்டும் சொல்ல முடியுமா?',
  'hi-IN': 'माफ़ कीजिए, क्या आप इसे दोबारा बता सकते हैं?',
  'en-IN': 'Sorry, could you please say that again?',
};
