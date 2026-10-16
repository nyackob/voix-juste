// Notes, noms, conversions et transposition.
// Une note de partition = { m: numéro MIDI (null = silence), b: début en temps, d: durée en temps, l: syllabe }

const FR_SHARP = ['do', 'do♯', 'ré', 'ré♯', 'mi', 'fa', 'fa♯', 'sol', 'sol♯', 'la', 'la♯', 'si'];
const FR_FLAT = ['do', 'ré♭', 'ré', 'mi♭', 'mi', 'fa', 'sol♭', 'sol', 'la♭', 'la', 'si♭', 'si'];
const EN_SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const EN_FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

const cfg = { naming: 'fr', flats: false, a4: 440 };
export function configureMusic(o) { Object.assign(cfg, o); }
export function getA4() { return cfg.a4; }

export const midiToFreq = (m) => cfg.a4 * 2 ** ((m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / cfg.a4);

function table() {
  if (cfg.naming === 'en') return cfg.flats ? EN_FLAT : EN_SHARP;
  return cfg.flats ? FR_FLAT : FR_SHARP;
}
export function pitchClassName(m) { return table()[((Math.round(m) % 12) + 12) % 12]; }
export function noteName(m) {
  const r = Math.round(m);
  return pitchClassName(r) + (Math.floor(r / 12) - 1);
}
export const isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

const FR_STEPS = { do: 0, re: 2, 'ré': 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };
const EN_STEPS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACC = { '#': 1, '♯': 1, b: -1, '♭': -1, '': 0 };

// Accepte : do3, ré#3, re3#, sol♭2, lab2, la2b, C3, C#3, Db3, bb2 ...
export function parseNote(tok) {
  const s = tok.trim().toLowerCase();
  let m = s.match(/^(do|ré|re|mi|fa|sol|la|si)([#♯b♭]?)(-?\d)([#♯b♭]?)$/);
  let step;
  if (m) step = FR_STEPS[m[1]];
  else {
    m = s.match(/^([a-g])([#♯b♭]?)(-?\d)([#♯b♭]?)$/);
    if (!m) return null;
    step = EN_STEPS[m[1]];
  }
  const acc = ACC[m[2]] + ACC[m[4]];
  return (parseInt(m[3], 10) + 1) * 12 + step + acc;
}

// Notation texte : NOTE[:durée][/syllabe]  ;  silence : -[:durée]  ;  | ignoré
// La durée est en temps (noire = 1) et se répète tant qu'on ne la change pas.
export function parseText(text) {
  const notes = [];
  const errors = [];
  let b = 0, d = 1;
  const tokens = text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    if (tok === '|') continue;
    let [main, lyric] = splitOnce(tok, '/');
    let [pitch, dur] = splitOnce(main, ':');
    if (dur !== undefined) {
      const v = parseDur(dur);
      if (!(v > 0)) { errors.push(`Durée illisible : « ${tok} »`); continue; }
      d = v;
    }
    if (pitch === '-' || pitch === 'r' || pitch === '_' || pitch === 'x') { b += d; continue; }
    const mm = parseNote(pitch);
    if (mm === null) { errors.push(`Note inconnue : « ${pitch} »`); continue; }
    notes.push({ m: mm, b: round(b), d: round(d), l: lyric ? lyric.replace(/_/g, ' ') : '' });
    b += d;
  }
  return { notes, errors, length: round(b) };
}
function parseDur(s) {
  if (s.includes('/')) { const [a, c] = s.split('/'); return parseFloat(a) / parseFloat(c); }
  return parseFloat(s.replace(',', '.'));
}
function splitOnce(s, ch) { const i = s.indexOf(ch); return i < 0 ? [s, undefined] : [s.slice(0, i), s.slice(i + 1)]; }
const round = (x) => Math.round(x * 1000) / 1000;

const ASCII = (n) => n.replace('♯', '#').replace('♭', 'b');
export function toText(notes, beatsPerBar = 4) {
  const out = [];
  let b = 0, d = null, bar = 0;
  const sorted = [...notes].sort((x, y) => x.b - y.b);
  for (const n of sorted) {
    if (n.b > b + 1e-6) { // silence
      const rd = round(n.b - b);
      out.push(rd === d ? '-' : `-:${rd}`); d = rd; b = n.b;
    }
    const nb = Math.floor((n.b + 1e-6) / beatsPerBar);
    if (nb > bar && out.length) { out.push('|'); bar = nb; }
    let t = ASCII(noteNameFixed(n.m));
    if (n.d !== d) { t += ':' + n.d; d = n.d; }
    if (n.l) t += '/' + n.l.replace(/ /g, '_');
    out.push(t);
    b = n.b + n.d;
  }
  return out.join(' ');
}
// Toujours en notation française avec dièses pour le texte (stable, réimportable)
function noteNameFixed(m) { return FR_SHARP[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

export function scoreLength(score) {
  let end = 0;
  for (const n of score.notes) end = Math.max(end, n.b + n.d);
  return end;
}
export function scoreRange(notes) {
  let lo = Infinity, hi = -Infinity;
  for (const n of notes) if (n.m != null) { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); }
  return lo === Infinity ? null : [lo, hi];
}
export const transposeNotes = (notes, s) => notes.map((n) => ({ ...n, m: n.m == null ? null : n.m + s }));

// Coût d'une note pour la voix : 0 dans la zone confortable, puis de plus en plus cher.
function noteCost(m, p) {
  const lo = Math.min(p.chestLow, p.headLow), hi = Math.max(p.chestHigh, p.headHigh);
  if (m < lo) return 20 + 10 * (lo - m);
  if (m > hi) return 20 + 10 * (m - hi);
  let c = 0;
  if (m < p.comfortLow) c += 1.5 * (p.comfortLow - m);
  if (m > p.comfortHigh) c += 1.5 * (m - p.comfortHigh);
  if (m >= p.passageLow && m <= p.passageHigh) c += 3;
  return c;
}
export function evaluateShift(notes, s, p) {
  let cost = 0, total = 0, outside = 0, passage = 0;
  const lo = Math.min(p.chestLow, p.headLow), hi = Math.max(p.chestHigh, p.headHigh);
  for (const n of notes) {
    if (n.m == null) continue;
    const m = n.m + s;
    cost += noteCost(m, p) * n.d; total += n.d;
    if (m < lo || m > hi) outside++;
    else if (m >= p.passageLow && m <= p.passageHigh) passage++;
  }
  return { shift: s, cost: total ? cost / total : 0, outside, passage };
}
export function suggestShift(notes, p) {
  let best = null;
  for (let s = -24; s <= 24; s++) {
    const e = evaluateShift(notes, s, p);
    e.cost += Math.abs(s) * 0.01; // à égalité, on bouge le moins possible
    if (!best || e.cost < best.cost) best = e;
  }
  return best;
}
export function noteZone(m, p) {
  const lo = Math.min(p.chestLow, p.headLow), hi = Math.max(p.chestHigh, p.headHigh);
  if (m < lo || m > hi) return 'out';
  if (m >= p.passageLow && m <= p.passageHigh) return 'passage';
  if (m < p.comfortLow || m > p.comfortHigh) return 'edge';
  return 'ok';
}
export function shiftLabel(s) {
  if (s === 0) return 'ton original';
  const sign = s > 0 ? '+' : '−';
  const a = Math.abs(s);
  const oct = Math.floor(a / 12), st = a % 12;
  const parts = [];
  if (oct) parts.push(oct === 1 ? '1 octave' : `${oct} octaves`);
  if (st) parts.push(st === 1 ? '1 demi-ton' : `${st} demi-tons`);
  return sign + parts.join(' et ');
}
