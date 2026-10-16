// Détection de hauteur YIN (de Cheveigné et Kawahara, 2002), réglée pour les voix graves.
//
// 1. Fonction de différence    d(τ) = Σ_j (x_j − x_{j+τ})²
// 2. Normalisation cumulée      d'(τ) = d(τ) · τ / Σ_{k=1..τ} d(k)
// 3. Premier creux sous le seuil, puis descente jusqu'au minimum local
// 4. Interpolation parabolique autour du creux pour une précision sous l'échantillon
//
// La fenêtre d'intégration fait une période de la fréquence la plus grave (60 Hz par défaut),
// c'est ce qui permet de suivre un fa2 ou un mi2 là où beaucoup d'applis décrochent.

export class YIN {
  constructor(sampleRate, { fmin = 60, fmax = 1000, threshold = 0.12 } = {}) {
    this.sr = sampleRate;
    this.threshold = threshold;
    this.tauMin = Math.max(2, Math.floor(sampleRate / fmax));
    this.tauMax = Math.ceil(sampleRate / fmin);
    this.W = this.tauMax;
    this.size = this.W + this.tauMax + 2;
    this.d = new Float32Array(this.tauMax + 2);
  }

  // x : tableau d'échantillons ; on analyse les `size` derniers à partir de `off`.
  detect(x, off = x.length - this.size) {
    const { W, tauMax, tauMin, d } = this;
    let energy = 0;
    for (let j = 0; j < W + tauMax; j++) { const v = x[off + j]; energy += v * v; }
    const rms = Math.sqrt(energy / (W + tauMax));
    if (rms < 1e-5) return { f0: null, clarity: 0, rms };

    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      const o2 = off + tau;
      for (let j = 0; j < W; j++) { const diff = x[off + j] - x[o2 + j]; s += diff * diff; }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }

    // creux candidats : minima locaux de d' (on garde aussi leur profondeur)
    const cands = [];
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < 0.5 && d[t] <= d[t - 1] && d[t] < d[t + 1]) cands.push({ tau: this.refine(t), d: d[t] });
    }
    if (!cands.length) return { f0: null, clarity: 0, rms, cands };
    // règle YIN : le premier creux sous le seuil, sinon le plus profond s'il reste assez net
    let pick = cands.find((c) => c.d < this.threshold);
    if (!pick) {
      pick = cands.reduce((a, b) => (b.d < a.d ? b : a));
      if (pick.d > 0.3) return { f0: null, clarity: 1 - pick.d, rms, cands };
    }
    return { f0: this.sr / pick.tau, clarity: 1 - pick.d, rms, cands };
  }

  refine(t) { // interpolation parabolique autour du creux
    const d = this.d;
    if (t < 1 || t > this.tauMax) return t;
    const a = d[t - 1], b = d[t], c = d[t + 1];
    const den = a - 2 * b + c;
    return den !== 0 ? t + (a - c) / (2 * den) : t;
  }
}

// Sous-échantillonnage par 2 (filtre [1 2 1]/4) pour diviser le calcul par 4.
class Decimator {
  constructor() { this.prev = 0; this.odd = false; this.carry = 0; }
  process(input) {
    const out = new Float32Array(Math.ceil(input.length / 2) + 1);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      if (!this.odd) { this.carry = v; }
      else { out[n++] = (this.prev + 2 * this.carry + v) / 4; this.prev = v; }
      this.odd = !this.odd;
    }
    return out.subarray(0, n);
  }
}

// Suivi continu : on pousse des blocs audio, on récupère des trames {frame, f0, midi, clarity, db}.
// `frame` est l'indice (à la fréquence native) du centre de la fenêtre analysée.
//
// Trois protections contre les sauts :
//  - continuité : si un autre creux YIN presque aussi net est proche de la note qu'on suivait, on le préfère
//    pendant au plus 80 ms (c'est ce qui évite de sauter sur une harmonique de la voix) ;
//  - hystérésis : un saut de plus de 3 demi-tons n'est accepté que s'il dure 40 ms ;
//  - seuil adaptatif : le seuil de détection suit le bruit de fond de la pièce (+12 dB).
export class PitchTracker {
  constructor(sampleRate, { fmin = 60, fmax = 1000, threshold = 0.12, gateDb = -65, hopMs = 10 } = {}) {
    this.native = sampleRate;
    this.factor = sampleRate >= 32000 ? 2 : 1;
    this.sr = sampleRate / this.factor;
    this.yin = new YIN(this.sr, { fmin, fmax, threshold });
    this.gateDb = gateDb;
    this.noise = -60;
    this.hop = Math.round((this.sr * hopMs) / 1000);
    this.buf = new Float32Array(this.yin.size + 8192);
    this.len = 0;
    this.sinceHop = 0;
    this.decim = this.factor === 2 ? new Decimator() : null;
    this.totalOut = 0;
    this.firstFrame = null;
    this.hist = [];
    this.a4 = 440;
    this.track = null;   // hauteur suivie (MIDI)
    this.trackAge = 99;  // trames depuis la dernière trame acceptée
    this.pending = [];
    this.overrideRun = 0;
  }
  push(chunk, startFrame) {
    if (this.firstFrame === null) this.firstFrame = startFrame;
    const data = this.decim ? this.decim.process(chunk) : chunk;
    const out = [];
    for (let i = 0; i < data.length; i++) {
      if (this.len === this.buf.length) {
        const keep = this.yin.size;
        this.buf.copyWithin(0, this.len - keep, this.len);
        this.len = keep;
      }
      this.buf[this.len++] = data[i];
      this.totalOut++;
      if (++this.sinceHop >= this.hop && this.len >= this.yin.size) {
        this.sinceHop = 0;
        out.push(this.analyse());
      }
    }
    return out;
  }
  toMidi(f) { return 69 + 12 * Math.log2(f / this.a4); }
  analyse() {
    const r = this.yin.detect(this.buf, this.len - this.yin.size);
    const db = 20 * Math.log10(r.rms + 1e-12);
    // bruit de fond : descend vite, remonte lentement (≈ 1 dB par seconde)
    if (db < this.noise) this.noise = db; else this.noise = Math.min(db, this.noise + 0.01);
    const gate = Math.max(this.gateDb, this.noise + 12);
    let raw = null;
    if (r.f0 && db > gate) {
      raw = this.toMidi(r.f0);
      const recent = this.track !== null && this.trackAge < 15;
      if (recent && Math.abs(raw - this.track) > 2.5 && r.cands) {
        const pickD = 1 - r.clarity;
        let best = null;
        for (const c of r.cands) {
          if (c.d > pickD + 0.15) continue;
          const m = this.toMidi(this.yin.sr / c.tau);
          if (Math.abs(m - this.track) <= 2 && (!best || Math.abs(m - this.track) < Math.abs(best - this.track))) best = m;
        }
        // on ne force la continuité que brièvement (80 ms) : au-delà, c'est un vrai changement de note
        // et le compteur ne repart à zéro que quand le détecteur retombe de lui-même sur la note suivie
        if (best !== null && this.overrideRun < 8) { raw = best; this.overrideRun++; }
      } else if (!recent || Math.abs(raw - this.track) <= 2.5) this.overrideRun = 0;
    }
    const midi = this.gateFrame(raw);
    this.hist.push(midi);
    if (this.hist.length > 3) this.hist.shift();
    let smooth = midi;
    if (midi !== null && this.hist.length === 3 && this.hist.every((v) => v !== null)) smooth = [...this.hist].sort((a, b) => a - b)[1];
    const centerOut = this.totalOut - this.yin.size / 2;
    const frame = this.firstFrame + centerOut * this.factor;
    return { frame, f0: smooth === null ? null : this.a4 * 2 ** ((smooth - 69) / 12), midi: smooth, clarity: r.clarity, db };
  }
  gateFrame(m) {
    this.trackAge++;
    if (m === null) { this.pending = []; return null; }
    if (this.track !== null && this.trackAge < 15 && Math.abs(m - this.track) <= 3) {
      this.track = m; this.trackAge = 0; this.pending = []; return m;
    }
    // saut ou début de note : on attend 4 trames cohérentes (40 ms)
    this.pending.push(m);
    if (this.pending.length > 4) this.pending.shift();
    if (this.pending.length === 4) {
      const lo = Math.min(...this.pending), hi = Math.max(...this.pending);
      if (hi - lo < 1) { this.track = m; this.trackAge = 0; this.pending = []; return m; }
    }
    return null;
  }
}
