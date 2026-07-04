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

## Stack
- **Server** — Express + `node:sqlite` (built into Node 22+), Sarvam client
- **Client** — Vite + React, in-browser mic capture and WAV encoding (no ffmpeg)

## Run it

Two terminals (from `vaani-voice-agent/`):

```bash
# 1) backend
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
| LLM reply | canned per-language reply | Sarvam `sarvam-30b` |
| Voice out | browser `speechSynthesis` | Sarvam `bulbul:v2` neural voice |

The top-right badge shows which mode you're in. The badge/behavior switches
automatically based on whether `SARVAM_API_KEY` is present.

## How it works
- `client/src/audio.js` — captures raw PCM from the Web Audio graph (no MediaRecorder /
  webm round-trip), down-samples to 16 kHz mono and encodes a clean WAV (Sarvam STT
  rejects raw webm/opus; decoding webm back to PCM is unreliable in Chrome).
- `server/sarvam.js` — the three pipeline stages with a deterministic mock fallback.
- `server/db.js` — sessions + turns persisted in SQLite (`server/vaani.db`).

## Configure the agent
Click **⚙ Agent** to edit the system prompt/persona (default: an "AirWave" telecom
support agent). Click **＋ New call** to start a fresh session with the new persona.

## Extending toward VoxLoom
- **Telephony**: add a Twilio/Exotel media-stream adapter that feeds the same
  `/api/chat` pipeline (swap browser audio for the call's audio frames).
- **Streaming latency**: move STT/TTS to Sarvam's streaming/websocket endpoints for
  barge-in and lower turn latency.
- **More languages**: add codes to `LANGS` in `server/sarvam.js` (Sarvam supports 11+
  Indian languages).

## Notes
- Requires **Node 22+** (uses the native `node:sqlite` module). Tested on Node 24.
- Sarvam STT accepts up to ~30s of audio per turn.
