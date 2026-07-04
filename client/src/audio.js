// Mic capture -> 16 kHz mono WAV.
//
// We capture RAW PCM straight from the Web Audio graph (createMediaStreamSource
// -> ScriptProcessor) instead of using MediaRecorder. MediaRecorder emits
// webm/opus, and decoding that back with decodeAudioData is unreliable in Chrome
// ("Unable to decode audio data"). Capturing PCM directly avoids the codec round
// trip entirely, then we down-sample to 16 kHz mono and encode a clean WAV.

const TARGET_RATE = 16000;

export class Recorder {
  constructor() {
    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.processor = null;
    this.buffers = [];
    this.inputRate = 44100;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.inputRate = this.ctx.sampleRate;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.buffers = [];
    this.processor.onaudioprocess = (e) => {
      // copy: the underlying buffer is reused across callbacks
      this.buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.ctx.destination); // required for the node to run
  }

  // Stops recording and resolves with a WAV Blob (16 kHz mono).
  async stop() {
    if (!this.processor) throw new Error('not recording');
    this.processor.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());

    const pcm = flatten(this.buffers);
    const inputRate = this.inputRate;
    if (this.ctx.state !== 'closed') await this.ctx.close();
    this.processor = null;

    if (pcm.length === 0) throw new Error('No audio captured — is the mic muted?');
    const resampled = resample(pcm, inputRate, TARGET_RATE);
    return encodeWav(resampled, TARGET_RATE);
  }
}

function flatten(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// Simple linear-interpolation resampler (good enough for speech ASR).
function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.round(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = idx - lo;
    out[i] = samples[lo] * (1 - frac) + samples[hi] * frac;
  }
  return out;
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Float32 [-1,1] -> Int16 PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

// Blob -> base64 string (no data: prefix), for sending audio as JSON.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Play a base64 WAV returned by the server.
export function playBase64Wav(b64) {
  return new Promise((resolve) => {
    const audio = new Audio(`data:audio/wav;base64,${b64}`);
    audio.onended = resolve;
    audio.onerror = resolve;
    audio.play().catch(resolve);
  });
}

// Mock-mode fallback: speak text with the browser's built-in TTS.
const VOICE_LANG = { 'ta-IN': 'ta-IN', 'hi-IN': 'hi-IN', 'en-IN': 'en-IN' };
export function speakLocally(text, language) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG[language] || 'en-IN';
    const match = speechSynthesis.getVoices().find((v) => v.lang === u.lang);
    if (match) u.voice = match;
    u.onend = resolve;
    u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
