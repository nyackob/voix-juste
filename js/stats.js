// Bilan d'une prise : justesse, stabilité et attaque par note, puis points à travailler.
// frames : [{ b: position en temps, m: hauteur MIDI (null = pas de voix), k: numéro de passage (boucle) }]
// notes  : notes cibles déjà transposées ; bps : temps par seconde.
import { noteName } from './music.js';

const IN = 50;       // ±50 cents = note juste
const GOOD = 25;     // ±25 cents = bien centrée
const ATTACK_SKIP = 0.12; // s laissées à l'attaque avant de juger la justesse

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const std = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function analyseInstance(n, fr, bps) {
  const durS = n.d / bps;
  const expected = Math.max(1, durS * 100); // une trame toutes les 10 ms
  const voiced = fr.filter((f) => f.m !== null);
  if (voiced.length < Math.max(3, expected * 0.25)) return { sung: false };
  let octave = 0;
  const errs = voiced.map((f) => {
    let e = (f.m - n.m) * 100;
    if (Math.abs(e) > 600) { const k = Math.round(e / 1200); e -= 1200 * k; if (k) octave++; }
    return { t: (f.b - n.b) / bps, e };
  });
  // attaque : premier instant à partir duquel 5 trames de suite (50 ms) sont justes
  let attack = null, ai = -1;
  for (let i = 0; i + 4 < errs.length; i++) {
    let ok = true;
    for (let j = 0; j < 5; j++) if (Math.abs(errs[i + j].e) > IN) { ok = false; break; }
    if (ok) { attack = errs[i].t; ai = i; break; }
  }
  const judged = errs.filter((x) => x.t >= Math.min(ATTACK_SKIP, durS * 0.3));
  const inTune = judged.length ? judged.filter((x) => Math.abs(x.e) <= IN).length / judged.length : 0;
  const centered = judged.length ? judged.filter((x) => Math.abs(x.e) <= GOOD).length / judged.length : 0;
  const stable = (ai >= 0 ? errs.slice(ai) : errs.filter((x) => x.t >= durS * 0.3)).map((x) => x.e);
  return {
    sung: true,
    err: median(stable.length ? stable : errs.map((x) => x.e)),
    spread: std(stable),
    attack, inTune, centered,
    octave: octave > voiced.length / 2,
    coverage: Math.min(1, voiced.length / expected),
  };
}

export function analyse(notes, frames, bps) {
  const targets = notes.filter((n) => n.m != null);
  const iters = [...new Set(frames.filter((f) => f.k >= 0).map((f) => f.k))];
  if (!iters.length) iters.push(0);
  const rows = targets.map((n, idx) => {
    const inst = iters.map((k) => analyseInstance(n, frames.filter((f) => f.k === k && f.b >= n.b && f.b < n.b + n.d), bps));
    const sung = inst.filter((r) => r.sung);
    const reached = sung.filter((r) => r.attack !== null);
    return {
      idx, m: n.m, b: n.b, d: n.d, l: n.l || '',
      sung: sung.length > 0,
      err: sung.length ? mean(sung.map((r) => r.err)) : null,
      spread: sung.length ? mean(sung.map((r) => r.spread)) : null,
      attack: reached.length ? mean(reached.map((r) => r.attack)) : null,
      reached: sung.length ? reached.length / sung.length : 0,
      inTune: sung.length ? mean(sung.map((r) => r.inTune)) : 0,
      centered: sung.length ? mean(sung.map((r) => r.centered)) : 0,
      octave: sung.some((r) => r.octave),
      score: sung.length ? Math.round(100 * mean(inst.map((r) => (r.sung ? r.inTune : 0)))) : 0,
    };
  });
  const sungRows = rows.filter((r) => r.sung);
  const totalDur = rows.reduce((a, r) => a + r.d, 0) || 1;
  const summary = {
    score: Math.round(rows.reduce((a, r) => a + r.score * r.d, 0) / totalDur),
    notes: rows.length,
    sung: sungRows.length,
    missed: rows.filter((r) => r.sung && r.reached < 0.5).length,
    silent: rows.filter((r) => !r.sung).length,
    meanAbsErr: sungRows.length ? mean(sungRows.map((r) => Math.abs(r.err))) : null,
    bias: sungRows.length ? mean(sungRows.map((r) => r.err)) : null,
    spread: sungRows.length ? mean(sungRows.map((r) => r.spread)) : null,
    attack: mean(sungRows.filter((r) => r.attack !== null).map((r) => r.attack)),
    iterations: iters.length,
  };
  return { rows, summary, insights: insights(rows, summary) };
}

const c = (x) => `${x > 0 ? '+' : '−'}${Math.abs(Math.round(x))} cents`;

export function insights(rows, s) {
  const out = [];
  const sung = rows.filter((r) => r.sung);
  if (!sung.length) return [{ key: 'silent', kind: 'info', text: "Aucune voix détectée sur les notes. Vérifie le micro et le seuil de détection dans Profil." }];
  if (s.bias !== null && Math.abs(s.bias) >= 20) {
    out.push({ key: 'bias', kind: 'warn', text: `En moyenne tu chantes ${s.bias < 0 ? 'trop bas' : 'trop haut'} (${c(s.bias)}). ${s.bias < 0 ? "Pense à viser le haut de la note, surtout en fin de phrase." : "Relâche un peu, tu pousses au-dessus de la note."}` });
  }
  if (sung.length >= 6) {
    const sorted = [...sung].sort((a, b) => a.m - b.m);
    const half = Math.floor(sorted.length / 2);
    const low = mean(sorted.slice(0, half).map((r) => r.err)), high = mean(sorted.slice(half).map((r) => r.err));
    if (Math.abs(low - high) >= 25) {
      out.push({ key: 'lowhigh', kind: 'warn', text: `Tes notes graves sont ${low < high ? 'plus basses' : 'plus hautes'} que tes notes aiguës (${c(low)} contre ${c(high)}).` });
    }
  }
  // intervalles entre notes consécutives chantées
  let semiWide = 0, semiN = 0, toneNarrow = 0, toneN = 0, upShort = 0, upN = 0, downShort = 0, downN = 0;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i], b = rows[i + 1];
    if (!a.sung || !b.sung || a.octave || b.octave) continue;
    if (b.b - (a.b + a.d) > 1.01) continue; // pas consécutives
    const I = b.m - a.m;
    if (I === 0) continue;
    const sungI = I + (b.err - a.err) / 100;
    if (Math.abs(I) === 1) { semiN++; if (Math.abs(sungI) > 1.5) semiWide++; }
    if (Math.abs(I) === 2) { toneN++; if (Math.abs(sungI) < 1.5) toneNarrow++; }
    if (I > 0) { upN++; if (sungI < I - 0.5) upShort++; }
    if (I < 0) { downN++; if (-sungI < -I - 0.5) downShort++; }
  }
  if (semiWide) out.push({ key: 'semi', kind: 'warn', text: `${semiWide} demi-ton${semiWide > 1 ? 's' : ''} sur ${semiN} chanté${semiWide > 1 ? 's' : ''} presque comme un ton entier. Travaille l'exercice « Demi-ton ou ton ».` });
  if (toneNarrow) out.push({ key: 'tone', kind: 'warn', text: `${toneNarrow} ton${toneNarrow > 1 ? 's' : ''} sur ${toneN} chanté${toneNarrow > 1 ? 's' : ''} trop serré${toneNarrow > 1 ? 's' : ''}, presque comme un demi-ton.` });
  if (upN >= 3 && upShort / upN >= 0.4) out.push({ key: 'up', kind: 'warn', text: `Tes montées sont souvent trop courtes (${upShort} sur ${upN}) : tu n'atteins pas la note du dessus.` });
  if (downN >= 3 && downShort / downN >= 0.4) out.push({ key: 'down', kind: 'warn', text: `Tes descentes sont souvent trop courtes (${downShort} sur ${downN}) : tu restes au-dessus de la note.` });
  if (s.attack !== null && s.attack > 0.25) out.push({ key: 'attack', kind: 'warn', text: `Tu mets en moyenne ${Math.round(s.attack * 1000)} ms à te poser sur la note. Imagine la note avant de l'attaquer, et attaque-la directement plutôt que de glisser.` });
  if (s.spread !== null && s.spread > 30) out.push({ key: 'spread', kind: 'warn', text: `Les notes tenues bougent (±${Math.round(s.spread)} cents). Garde le souffle régulier jusqu'au bout de la note.` });
  const oct = rows.filter((r) => r.octave).length;
  if (oct) out.push({ key: 'octave', kind: 'info', text: `${oct} note${oct > 1 ? 's' : ''} chantée${oct > 1 ? 's' : ''} à l'octave. Elles sont jugées sur le nom de la note, mais tu peux transposer d'une octave.` });
  const worst = sung.filter((r) => r.score < 50).sort((a, b) => a.score - b.score).slice(0, 3);
  if (worst.length) out.push({ key: 'worst', kind: 'info', text: `Notes à reprendre : ${worst.map((r) => `${noteName(r.m)}${r.l ? ` (« ${r.l} »)` : ''}`).join(', ')}.` });
  if (!out.length) out.push({ key: 'none', kind: 'good', text: 'Rien de récurrent à signaler sur cette prise. Essaie sans guide ou un peu plus vite.' });
  return out;
}

// Note tenue la plus longue et stable dans une liste de hauteurs (test de tessiture, calage)
export function heldNote(midis, minFrames = 40) {
  const v = midis.filter((m) => m !== null);
  if (v.length < minFrames) return null;
  const med = median(v);
  const near = v.filter((m) => Math.abs(m - med) < 0.5);
  return near.length >= minFrames * 0.7 ? median(near) : null;
}
