import { useEffect, useRef, useState } from 'react';
import { Recorder, playBase64Wav, speakLocally, blobToBase64 } from './audio.js';

const LANG_OPTIONS = [
  { code: 'auto', label: 'Auto-detect', flag: '🌐' },
  { code: 'ta-IN', label: 'தமிழ் · Tamil', flag: '🇮🇳' },
  { code: 'hi-IN', label: 'हिन्दी · Hindi', flag: '🇮🇳' },
  { code: 'en-IN', label: 'English', flag: '🇮🇳' },
];

export default function App() {
  const [health, setHealth] = useState(null);
  const [messages, setMessages] = useState([]);
  const [langPref, setLangPref] = useState('auto');
  const [persona, setPersona] = useState('');
  const [status, setStatus] = useState('idle'); // idle | recording | thinking | speaking
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [typed, setTyped] = useState('');

  const recorderRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h) => {
        setHealth(h);
        setPersona(h.defaultPersona || '');
      })
      .catch(() => setError('Cannot reach the server. Is it running on :3001?'));
    // warm up voice list for mock TTS
    if ('speechSynthesis' in window) speechSynthesis.getVoices();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  async function toggleRecord() {
    setError(null);
    if (status === 'recording') {
      // stop + send
      try {
        const wav = await recorderRef.current.stop();
        await sendTurn({ audio: wav });
      } catch (err) {
        setError(err.message);
        setStatus('idle');
      }
      return;
    }
    if (status !== 'idle') return;
    try {
      recorderRef.current = new Recorder();
      await recorderRef.current.start();
      setStatus('recording');
    } catch (err) {
      setError('Microphone access denied or unavailable.');
    }
  }

  async function sendTyped() {
    if (!typed.trim()) return;
    const text = typed.trim();
    setTyped('');
    await sendTurn({ text });
  }

  async function sendTurn({ audio, text }) {
    setStatus('thinking');
    try {
      // Stateless API: the client carries the running conversation history.
      const history = messages.map((m) => ({ role: m.role, text: m.text }));
      const body = { langPref, persona, history };
      if (audio) body.audioBase64 = await blobToBase64(audio);
      if (text) body.text = text;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      setMessages((m) => [
        ...m,
        { role: 'user', text: data.transcript, language: data.languageName },
        { role: 'agent', text: data.reply, language: data.languageName },
      ]);

      // Speak the reply.
      setStatus('speaking');
      if (data.audio) await playBase64Wav(data.audio);
      else await speakLocally(data.reply, data.language);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus('idle');
    }
  }

  const busy = status === 'thinking' || status === 'speaking';
  const statusLabel = {
    idle: 'Tap to talk',
    recording: 'Listening… tap to send',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }[status];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🪷</span>
          <div>
            <h1>Vaani</h1>
            <p>Multilingual voice agent · Tamil · Hindi · English</p>
          </div>
        </div>
        <div className="topbar-right">
          {health && (
            <span className={`mode ${health.mock ? 'mock' : 'live'}`}>
              {health.mock ? 'MOCK MODE' : 'LIVE · Sarvam AI'}
            </span>
          )}
          <button className="ghost" onClick={() => setShowSettings((s) => !s)}>
            ⚙ Agent
          </button>
        </div>
      </header>

      {showSettings && (
        <div className="settings">
          <label>Agent persona / system prompt</label>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={4}
            placeholder="Describe the voice agent's role…"
          />
          <p className="hint">
            Changes apply to the next new conversation. Click “New call” to restart.
          </p>
        </div>
      )}

      <div className="controls">
        <div className="langpicker">
          {LANG_OPTIONS.map((o) => (
            <button
              key={o.code}
              className={langPref === o.code ? 'chip active' : 'chip'}
              onClick={() => setLangPref(o.code)}
            >
              {o.flag} {o.label}
            </button>
          ))}
        </div>
        <button
          className="ghost small"
          onClick={() => {
            setMessages([]);
            setError(null);
          }}
        >
          ＋ New call
        </button>
      </div>

      <main className="transcript" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            <div className="empty-icon">🎙️</div>
            <p>
              Press the mic and speak in <b>Tamil</b>, <b>Hindi</b> or <b>English</b>.
              The agent hears you, understands, and replies out loud in your language.
            </p>
            {health?.mock && (
              <p className="empty-note">
                Running in mock mode (no API key) — the agent uses a canned demo reply
                and your browser’s voice. Add a <code>SARVAM_API_KEY</code> for real
                speech recognition and neural voices.
              </p>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            <div className="bubble-meta">
              {m.role === 'user' ? 'You' : 'Vaani'} · {m.language}
            </div>
            <div className="bubble-text">{m.text}</div>
          </div>
        ))}
        {status === 'thinking' && (
          <div className="bubble agent pending">
            <div className="typing"><span /><span /><span /></div>
          </div>
        )}
      </main>

      {error && <div className="error">{error}</div>}

      <footer className="micbar">
        <form
          className="typebar"
          onSubmit={(e) => {
            e.preventDefault();
            sendTyped();
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="…or type a message to test"
            disabled={busy}
          />
          <button type="submit" className="ghost small" disabled={busy || !typed.trim()}>
            Send
          </button>
        </form>

        <button
          className={`mic ${status}`}
          onClick={toggleRecord}
          disabled={busy}
          title={statusLabel}
        >
          {status === 'recording' ? '⏹' : busy ? '…' : '🎤'}
        </button>
        <div className="status">{statusLabel}</div>
      </footer>
    </div>
  );
}
