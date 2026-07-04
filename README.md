# Vaani — Multilingual Voice Agent (Tamil · Hindi · English)

A VoxLoom-style **conversational voice agent** you run in the browser. Speak, and the
agent transcribes → reasons with an LLM → replies out loud, in **Tamil, Hindi, or
English**, auto-detecting the language you used.

```
  🎤 mic  →  WAV (16k mono)  →  Sarvam STT  →  Sarvam LLM  →  Sarvam TTS  →  🔊 reply
```

Powered by [Sarvam AI](https://www.sarvam.ai) (India-focused speech + Indic LLM).
Works with **zero API keys** in a built-in **mock mode** so you can demo the full loop
immediately; add a key for real speech recognition and neural voices.

## Architecture (Vercel-native)
- **Client** — Vite + React static site. Captures the mic, encodes a clean 16 kHz WAV
  in-browser (no ffmpeg), and holds the conversation history in state.
- **API** — stateless serverless functions in `/api` (`chat.js`, `health.js`). No
  database: the browser sends the running history with each turn, so it runs on
  Vercel's serverless runtime with nothing to persist.
- **`api/_sarvam.js`** — the shared Sarvam client (STT → LLM → TTS) used by both the
  serverless functions and the local Express dev server.

```
vaani-voice-agent/
  api/            serverless functions (Vercel) — also mounted by the dev server
    chat.js       POST: one voice turn
    health.js     GET: capability probe
    _sarvam.js    Sarvam client + mock engine (shared, stateless)
  client/         Vite + React app
  server/         thin Express wrapper for local dev (reuses /api handlers)
  vercel.json     builds the client, wires the functions
```

## Deploy to Vercel
1. Push this repo to GitHub and import it in Vercel (already linked to
   `techwithsrikanth/voice_agent`).
2. **Set the environment variable** in Vercel → Project → Settings → Environment
   Variables:
   - `SARVAM_API_KEY = sk_...`  (Production + Preview)
   - The key is **not** in the repo — you must add it here or the app stays in mock mode.
3. Redeploy. `vercel.json` handles the rest:
   - builds `client/` → serves `client/dist` as the static site,
   - exposes `/api/*` as Node serverless functions (30s max duration).

> The earlier 404 was because Vercel didn't build the Vite client ("No framework
> detected") and an Express `app.listen()` can't run on serverless. `vercel.json` +
> the `/api` functions fix both.

## Run locally
Two terminals (from `vaani-voice-agent/`):

```bash
# 1) backend (dev-only Express wrapper around the /api handlers)
cd server
npm install
cp .env.example .env      # optional: paste your SARVAM_API_KEY
npm run dev               # http://localhost:3001

# 2) frontend
cd client
npm install
npm run dev               # http://localhost:5173  <-- open this
```

Open http://localhost:5173, pick a language (or Auto), tap the mic, and talk.
> Mic access needs `localhost` or HTTPS — `localhost` is fine.

## Mock vs Live

| | Mock (no key) | Live (SARVAM_API_KEY set) |
|---|---|---|
| Speech-to-text | canned demo sentence | Sarvam `saaras:v3` |
| LLM reply | canned per-language reply | Sarvam `sarvam-30b` (thinking off) |
| Voice out | browser `speechSynthesis` | Sarvam `bulbul:v2` neural voice |

The top-right badge shows which mode you're in — it switches automatically based on
whether `SARVAM_API_KEY` is present.

## Implementation notes
- `client/src/audio.js` — captures raw PCM from the Web Audio graph (no MediaRecorder /
  webm round-trip), down-samples to 16 kHz mono and encodes a clean WAV (Sarvam STT
  rejects raw webm/opus; decoding webm back to PCM is unreliable in Chrome).
- `api/_sarvam.js` — `sarvam-30b` is a reasoning model; we send
  `chat_template_kwargs.enable_thinking=false` and **no** `max_tokens` (a cap can
  truncate the residual reasoning trace and return empty content). Empty replies are
  still occasionally possible, so we retry with rising temperature and, as a last
  resort, speak a polite reprompt in the caller's language.

## Configure the agent
Click **⚙ Agent** to edit the system prompt/persona (default: an "AirWave" telecom
support agent). Click **＋ New call** to clear the conversation.

## Extending toward VoxLoom
- **Telephony**: add a Twilio/Exotel media-stream adapter that feeds the same
  `runTurn()` pipeline (swap browser audio for the call's audio frames).
- **Streaming latency**: move STT/TTS to Sarvam's streaming/websocket endpoints for
  barge-in and lower turn latency.
- **More languages**: add codes to `LANGS` in `api/_sarvam.js` (Sarvam supports 11+
  Indian languages).
- **Persistence/analytics**: add a serverless DB (e.g. Vercel Postgres / Upstash) if
  you want to store transcripts — the current design is intentionally stateless.

## Notes
- Requires **Node 18+** locally. Tested on Node 24.
- Sarvam STT accepts up to ~30s of audio per turn.
