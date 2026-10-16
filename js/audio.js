// Micro, suivi de hauteur, enregistrement WAV et synthèse du guide sonore.
import { PitchTracker } from './pitch.js';
import { midiToFreq, getA4 } from './music.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.listeners = new Set();
    this.levelDb = -100;
    this.recording = null;
    this.opts = { fmin: 60, fmax: 1000, gateDb: -45, latencyMs: 0 };
  }

  get running() { return !!this.stream; }

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.synth = new Synth(this.ctx);
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.ctx;
  }

  async start() {
    await this.ensureContext();
    if (this.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ce navigateur ne donne pas accès au micro ici. Ouvre l'app depuis http://localhost ou une adresse https.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const ctx = this.ctx;
    this.source = ctx.createMediaStreamSource(this.stream);
    this.makeTracker();
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      this.node.port.onmessage = (e) => this.onChunk(e.data.data, e.data.frame);
    } else { // vieux Safari
      this.node = ctx.createScriptProcessor(1024, 1, 1);
      let frame = 0;
      this.node.onaudioprocess = (e) => {
        const d = new Float32Array(e.inputBuffer.getChannelData(0));
        const f = Math.round(e.playbackTime * ctx.sampleRate) - 1024;
        this.onChunk(d, frame > f ? frame : f); frame = f + 1024;
      };
    }
    this.source.connect(this.node);
    this.node.connect(sink);
  }

  makeTracker() {
    if (!this.ctx) return;
    this.tracker = new PitchTracker(this.ctx.sampleRate, { fmin: this.opts.fmin, fmax: this.opts.fmax, gateDb: this.opts.gateDb });
    this.tracker.a4 = getA4();
  }
  configure(o) {
    Object.assign(this.opts, o);
    if (this.tracker) this.makeTracker();
  }

  stop() {
    if (!this.stream) return;
    this.stream.getTracks().forEach((t) => t.stop());
    try { this.source.disconnect(); this.node.disconnect(); } catch (e) { /* déjà coupé */ }
    this.stream = null;
  }

  onChunk(data, frame) {
    const sr = this.ctx.sampleRate;
    let e = 0;
    for (let i = 0; i < data.length; i++) e += data[i] * data[i];
    const db = 10 * Math.log10(e / data.length + 1e-12);
    this.levelDb = Math.max(db, this.levelDb - 1.5);
    if (this.recording) {
      if (this.recording.startFrame === null) this.recording.startFrame = frame;
      this.recording.chunks.push(data);
    }
    const frames = this.tracker.push(data, frame);
    const lat = (this.opts.latencyMs || 0) / 1000;
    for (const f of frames) {
      const ev = { time: f.frame / sr - lat, midi: f.midi, f0: f.f0, db: f.db, clarity: f.clarity };
      for (const fn of this.listeners) fn(ev);
    }
  }
  onPitch(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  startRecording() { this.recording = { chunks: [], startFrame: null }; }
  stopRecording() {
    const r = this.recording;
    this.recording = null;
    if (!r || r.startFrame === null) return null;
    const sr = this.ctx.sampleRate;
    const total = r.chunks.reduce((a, c) => a + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of r.chunks) { all.set(c, o); o += c.length; }
    const factor = sr >= 44100 ? 2 : 1;
    const out = factor === 2 ? halve(all) : all;
    return { blob: encodeWav(out, sr / factor), startTime: r.startFrame / sr, duration: total / sr };
  }
}

function halve(x) {
  const n = Math.floor(x.length / 2);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = x[2 * i - 1] ?? x[0], b = x[2 * i], c = x[2 * i + 1] ?? b;
    y[i] = (a + 2 * b + c) / 4;
  }
  return y;
}

function encodeWav(x, sr) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gain = peak > 0 && peak < 0.25 ? Math.min(4, 0.5 / peak) : 1; // remonte un peu les prises trop faibles
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + x.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) {
    const s = Math.max(-1, Math.min(1, x[i] * gain));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Son de guide : 8 harmoniques en 1/h^1.1, audible même sur un petit haut-parleur pour les notes graves.
export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.connect(ctx.destination);
    const n = 9, real = new Float32Array(n), imag = new Float32Array(n);
    for (let h = 1; h < n; h++) imag[h] = 1 / h ** 1.1;
    this.wave = ctx.createPeriodicWave(real, imag);
    this.active = new Set();
  }
  note(midi, when, dur, vol = 0.3) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);
    osc.frequency.value = midiToFreq(midi);
    const g = ctx.createGain();
    const att = 0.03, rel = Math.min(0.08, dur / 3);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + att);
    g.gain.setValueAtTime(vol, Math.max(when + att, when + dur - rel));
    g.gain.linearRampToValueAtTime(0, when + dur);
    osc.connect(g).connect(this.out);
    osc.start(when);
    osc.stop(when + dur + 0.05);
    this.active.add(osc);
    osc.onended = () => this.active.delete(osc);
  }
  click(when, accent = false, vol = 0.4) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = accent ? 1600 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(g).connect(this.out);
    osc.start(when);
    osc.stop(when + 0.06);
    this.active.add(osc);
    osc.onended = () => this.active.delete(osc);
  }
  stopAll() {
    for (const o of this.active) { try { o.stop(); } catch (e) { /* déjà fini */ } }
    this.active.clear();
  }
}
