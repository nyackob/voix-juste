// Portée défilante (piano-roll) : notes cibles en barres, voix tracée par-dessus.
import { noteName, isBlack, noteZone, pitchClassName } from './music.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class Roll {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.gutter = 52;
    this.playFrac = 0.3;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(200, r.width); this.h = Math.max(150, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.colors = null;
    if (this.last) this.draw(this.last);
  }
  palette() {
    if (!this.colors) {
      this.colors = {
        bg: css('--roll-bg'), row: css('--roll-row'), line: css('--roll-line'), text: css('--muted'), ink: css('--ink'),
        note: css('--note'), noteNow: css('--note-now'), notePast: css('--note-past'),
        good: css('--good'), warn: css('--warn'), bad: css('--bad'), voice: css('--voice'), play: css('--accent'),
        chest: css('--chest'), head: css('--head'), passage: css('--passage'),
      };
    }
    return this.colors;
  }
  invalidateColors() { this.colors = null; }

  // s = { notes, beat, pxPerBeat, yMin, yMax, frames, profile, beatsPerBar, showBars, start, end, playX (0..1), replay }
  draw(s) {
    this.last = s;
    const g = this.g, C = this.palette();
    const W = this.w, H = this.h, gx = this.gutter;
    const rows = s.yMax - s.yMin + 1;
    const rh = H / rows;
    const yOf = (m) => H - (m - s.yMin + 0.5) * rh;
    const px = gx + (W - gx) * (s.playX ?? this.playFrac);
    const xOf = (b) => px + (b - s.beat) * s.pxPerBeat;
    const bMin = s.beat - (px - gx) / s.pxPerBeat, bMax = s.beat + (W - px) / s.pxPerBeat;

    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    // lignes de notes
    for (let m = s.yMin; m <= s.yMax; m++) {
      const y = yOf(m) - rh / 2;
      if (isBlack(m)) { g.fillStyle = C.row; g.fillRect(gx, y, W - gx, rh); }
      if (m % 12 === 0) { g.fillStyle = C.line; g.fillRect(gx, y + rh - 1, W - gx, 1); }
    }
    // zone de passage
    if (s.profile) {
      const p = s.profile;
      const y1 = yOf(Math.min(p.passageHigh, s.yMax)) - rh / 2, y2 = yOf(Math.max(p.passageLow, s.yMin)) + rh / 2;
      if (y2 > y1) { g.fillStyle = C.passage; g.fillRect(gx, y1, W - gx, y2 - y1); }
    }
    // mesures
    if (s.showBars && s.beatsPerBar) {
      g.fillStyle = C.line;
      const first = Math.ceil(bMin / s.beatsPerBar) * s.beatsPerBar;
      g.font = '11px ' + css('--font-ui');
      g.textBaseline = 'top';
      for (let b = first; b <= bMax; b += s.beatsPerBar) {
        const x = Math.round(xOf(b));
        if (x < gx) continue;
        g.fillRect(x, 0, 1, H);
        g.fillStyle = C.text; g.fillText(String(Math.round(b / s.beatsPerBar) + 1), x + 3, 3); g.fillStyle = C.line;
      }
    }
    // zone de travail (boucle)
    if (s.start != null && s.end != null) {
      g.fillStyle = C.passage;
      const xa = xOf(s.start), xb = xOf(s.end);
      if (xa > gx) g.fillRect(gx, 0, Math.min(xa, W) - gx, H);
      if (xb < W) g.fillRect(Math.max(gx, xb), 0, W - Math.max(gx, xb), H);
    }
    // notes cibles
    g.textBaseline = 'top';
    g.font = '12px ' + css('--font-ui');
    for (const n of s.notes || []) {
      if (n.m == null || n.b + n.d < bMin || n.b > bMax) continue;
      const x1 = Math.max(gx, xOf(n.b)), x2 = xOf(n.b + n.d) - 2;
      if (x2 <= gx) continue;
      const y = yOf(n.m);
      const now = s.beat >= n.b && s.beat < n.b + n.d;
      const past = n.b + n.d <= s.beat;
      g.fillStyle = now ? C.noteNow : past ? C.notePast : C.note;
      roundRect(g, x1, y - rh * 0.42, Math.max(2, x2 - x1), rh * 0.84, Math.min(5, rh / 3));
      g.fill();
      if (s.profile) {
        const z = noteZone(n.m, s.profile);
        if (z === 'out' || z === 'passage') {
          g.strokeStyle = z === 'out' ? C.bad : C.warn; g.lineWidth = 2;
          roundRect(g, x1, y - rh * 0.42, Math.max(2, x2 - x1), rh * 0.84, Math.min(5, rh / 3)); g.stroke();
        }
      }
      if (n.l && x2 - x1 > 6) { g.fillStyle = C.ink; g.fillText(n.l, x1 + 2, y + rh * 0.48); }
    }
    // trace de la voix
    const fr = s.frames || [];
    g.lineWidth = 3; g.lineCap = 'round';
    let prev = null;
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i];
      if (f.b < bMin - 1 || f.b > bMax) { prev = null; continue; }
      if (f.m === null) { prev = null; continue; }
      const x = xOf(f.b), y = yOf(f.m);
      if (prev && f.b - prev.b < 0.25 && x >= gx) {
        g.strokeStyle = f.c == null ? C.voice : Math.abs(f.c) <= 25 ? C.good : Math.abs(f.c) <= 50 ? C.warn : C.bad;
        g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(x, y); g.stroke();
      }
      prev = { x, y, b: f.b };
    }
    // flèche si la voix sort du cadre
    const lastF = fr.length ? fr[fr.length - 1] : null;
    if (lastF && lastF.m !== null && Math.abs(lastF.b - s.beat) < 0.3) {
      if (lastF.m > s.yMax + 0.5 || lastF.m < s.yMin - 0.5) {
        const up = lastF.m > s.yMax;
        g.fillStyle = C.voice; g.font = '600 13px ' + css('--font-ui');
        g.textBaseline = up ? 'top' : 'bottom';
        g.fillText(`${up ? '▲' : '▼'} ${noteName(lastF.m)}`, px + 6, up ? 4 : H - 4);
      } else {
        g.fillStyle = C.ink;
        g.beginPath(); g.arc(xOf(lastF.b), yOf(lastF.m), 5, 0, Math.PI * 2); g.fill();
      }
    }
    // tête de lecture
    g.fillStyle = C.play; g.fillRect(Math.round(px) - 1, 0, 2, H);
    // gouttière : noms des notes et zones de voix
    g.fillStyle = C.bg; g.fillRect(0, 0, gx, H);
    g.fillStyle = C.line; g.fillRect(gx - 1, 0, 1, H);
    if (s.profile) {
      const p = s.profile;
      const band = (lo, hi, col, x) => {
        const a = Math.max(lo, s.yMin), b = Math.min(hi, s.yMax);
        if (b < a) return;
        g.fillStyle = col; g.fillRect(x, yOf(b) - rh / 2, 4, (b - a + 1) * rh);
      };
      band(p.chestLow, p.chestHigh, C.chest, gx - 12);
      band(p.headLow, p.headHigh, C.head, gx - 7);
    }
    g.textBaseline = 'middle';
    const fs = Math.max(9, Math.min(12, rh * 0.8));
    g.font = `${fs}px ` + css('--font-ui');
    const step = rh < 9 ? 2 : 1;
    for (let m = s.yMin; m <= s.yMax; m++) {
      if (isBlack(m)) continue;
      if (step === 2 && ![0, 4, 7, 9].includes(((m % 12) + 12) % 12)) continue;
      g.fillStyle = m % 12 === 0 ? C.ink : C.text;
      g.fillText(m % 12 === 0 || rh >= 11 ? noteName(m) : pitchClassName(m), 5, yOf(m));
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

// Petit aperçu statique d'une partition (éditeur, import)
export function drawPreview(canvas, notes, profile) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height;
  g.fillStyle = css('--roll-bg'); g.fillRect(0, 0, W, H);
  const ms = notes.filter((n) => n.m != null);
  if (!ms.length) return;
  const lo = Math.min(...ms.map((n) => n.m)) - 2, hi = Math.max(...ms.map((n) => n.m)) + 2;
  const end = Math.max(...notes.map((n) => n.b + n.d));
  const rh = H / (hi - lo + 1), sx = (W - 8) / end;
  for (const n of ms) {
    const z = profile ? noteZone(n.m, profile) : 'ok';
    g.fillStyle = z === 'out' ? css('--bad') : z === 'passage' ? css('--warn') : css('--note-now');
    g.fillRect(4 + n.b * sx, H - (n.m - lo + 1) * rh, Math.max(2, n.d * sx - 1.5), Math.max(2, rh * 0.85));
  }
}
