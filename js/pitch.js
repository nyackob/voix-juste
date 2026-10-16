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
  constructor(sampleRate, { fmin = 60, fmax = 1000, threshold = 0.15 } = {}) {
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

    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < this.threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t; break;
      }
    }
    if (tau < 0) { // pas de creux sous le seuil : minimum global, accepté s'il reste assez net
      let best = tauMin;
      for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
      if (d[best] > 0.3) return { f0: null, clarity: 1 - d[best], rms };
      tau = best;
    }

    let better = tau;
    if (tau > 1 && tau < tauMax + 1) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den !== 0) better = tau + (a - c) / (2 * den);
    }
    return { f0: this.sr / better, clarity: 1 - d[tau], rms };
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
export class PitchTracker {
  constructor(sampleRate, { fmin = 60, fmax = 1000, threshold = 0.15, gateDb = -50, hopMs = 10 } = {}) {
    this.native = sampleRate;
    this.factor = sampleRate >= 32000 ? 2 : 1;
    this.sr = sampleRate / this.factor;
    this.yin = new YIN(this.sr, { fmin, fmax, threshold });
    this.gateDb = gateDb;
    this.hop = Math.round((this.sr * hopMs) / 1000);
    this.buf = new Float32Array(this.yin.size + 8192);
    this.len = 0;
    this.sinceHop = 0;
    this.decim = this.factor === 2 ? new Decimator() : null;
    this.totalOut = 0; // nombre d'échantillons décimés reçus
    this.firstFrame = null;
    this.hist = [];
    this.a4 = 440;
  }
  push(chunk, startFrame) {
    if (this.firstFrame === null) this.firstFrame = startFrame;
    const data = this.decim ? this.decim.process(chunk) : chunk;
    const out = [];
    for (let i = 0; i < data.length; i++) {
      if (this.len === this.buf.length) { // on garde seulement la fin du tampon
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
  analyse() {
    const r = this.yin.detect(this.buf, this.len - this.yin.size);
    const db = 20 * Math.log10(r.rms + 1e-12);
    let midi = null;
    if (r.f0 && db > this.gateDb) midi = 69 + 12 * Math.log2(r.f0 / this.a4);
    // médiane sur 3 trames voisées pour supprimer les sauts isolés
    this.hist.push(midi);
    if (this.hist.length > 3) this.hist.shift();
    let smooth = midi;
    if (midi !== null && this.hist.length === 3 && this.hist.every((v) => v !== null)) {
      smooth = [...this.hist].sort((a, b) => a - b)[1];
    }
    const centerOut = this.totalOut - this.yin.size / 2;
    const frame = this.firstFrame + centerOut * this.factor;
    return { frame, f0: midi === null ? null : r.f0, midi: smooth, clarity: r.clarity, db };
  }
}
