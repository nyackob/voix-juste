import * as db from './db.js';
import { AudioEngine } from './audio.js';
import { Roll, drawPreview } from './roll.js';
import { builtinScores } from './library.js';
import { importFile } from './importers.js';
import { analyse, heldNote } from './stats.js';
import {
  configureMusic, noteName, parseText, toText, scoreLength, scoreRange, transposeNotes,
  suggestShift, evaluateShift, shiftLabel, noteZone, isBlack, midiToFreq,
} from './music.js';

// ---------- état ----------
const DEFAULT_PROFILE = { chestLow: 41, chestHigh: 62, headLow: 53, headHigh: 72, passageLow: 63, passageHigh: 65, comfortLow: 45, comfortHigh: 60 };
const DEFAULT_SETTINGS = { naming: 'fr', flats: false, a4: 440, fmin: 60, gateDb: -60, latencyMs: 0, v: 2 };
const S = {
  scores: [], profile: { ...DEFAULT_PROFILE }, settings: { ...DEFAULT_SETTINGS }, prefs: {},
  current: null, mode: 'free', tab: 'library', tagFilter: null,
  transpose: 0, tempoPct: 100, guide: 'start', guideVol: 0.5, metro: false, loop: false, rec: false, zoom: 1,
  fromBar: 1, toBar: 1,
};
const engine = new AudioEngine();
const $ = (id) => document.getElementById(id);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};
const fmtCents = (c) => (c == null ? '–' : `${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(Math.round(c))} c`);
const fmtDate = (t) => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDur = (s) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')}`);
const pillClass = (score) => (score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad');
let toastTimer = null;
function toast(msg, ms = 3800) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function download(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function twoStep(btn, label, fn) { // confirmation intégrée : un 2e clic confirme
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) { fn(); return; }
    btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = label;
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; }, 2500);
  });
}

// ---------- démarrage ----------
async function boot() {
  S.profile = { ...DEFAULT_PROFILE, ...(await db.kvGet('profile', {})) };
  S.settings = { ...DEFAULT_SETTINGS, ...(await db.kvGet('settings', {})) };
  if (S.settings.v !== 2) { S.settings.gateDb = -60; S.settings.v = 2; await db.kvSet('settings', S.settings); } // le seuil est maintenant adaptatif
  engine.onStall = () => {
    const wasRunning = !!run;
    if (run) stopRun();
    if (rangeTest) stopRangeTest();
    toast(wasRunning ? "Le micro s'est coupé (souvent quand une autre app ou un appel prend le son). Relance la prise." : "Le micro s'est coupé. Il se rouvrira à la prochaine prise.", 6000);
  };
  S.prefs = await db.kvGet('prefs', {});
  applySettings();
  await loadScores();
  db.persist();
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  initLibrary(); initEditor(); initPractice(); initTakes(); initProfile(); initProgress();
  renderLibrary();
  setMode(null);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { roll.invalidateColors(); rpRoll.invalidateColors(); drawIdle(); });
}
async function loadScores() {
  const user = await db.all('scores');
  S.scores = [...builtinScores(), ...user.sort((a, b) => (b.updated || 0) - (a.updated || 0))];
}
function applySettings() {
  configureMusic({ naming: S.settings.naming, flats: !!S.settings.flats, a4: S.settings.a4 });
  engine.configure({ fmin: S.settings.fmin, gateDb: S.settings.gateDb, latencyMs: S.settings.latencyMs });
}
function showTab(tab) {
  if (run && tab !== 'practice') stopRun();
  if (rangeTest && tab !== 'profile') stopRangeTest();
  S.tab = tab;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + tab));
  if (tab === 'library') renderLibrary();
  if (tab === 'practice') { roll.resize(); drawIdle(); }
  if (tab === 'takes') renderTakes();
  if (tab === 'progress') renderProgress();
  if (tab === 'profile') renderProfile();
  if (tab !== 'takes') closeReplay();
}
function showView(id) { // vues hors onglets (éditeur)
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === id));
}

// ---------- bibliothèque ----------
function initLibrary() {
  $('lib-search').addEventListener('input', renderLibrary);
  $('lib-new').addEventListener('click', () => openEditor(null));
  $('lib-free').addEventListener('click', () => { setMode(null); showTab('practice'); });
  $('lib-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) openImport(f);
  });
}
function scoreMeta(s) {
  const r = scoreRange(s.notes);
  const pref = S.prefs[s.id];
  const t = pref && pref.transpose ? ` · ${shiftLabel(pref.transpose)}` : '';
  return r ? `${noteName(r[0])} – ${noteName(r[1])} · ${s.notes.length} notes · ${s.tempo} à la noire${t}` : 'Vide';
}
function renderLibrary() {
  const q = $('lib-search').value.trim().toLowerCase();
  const tags = [...new Set(S.scores.flatMap((s) => s.tags || []))];
  const tagBox = $('lib-tags'); tagBox.replaceChildren();
  tagBox.append(h('button', { class: 'chip' + (S.tagFilter ? '' : ' on'), onclick: () => { S.tagFilter = null; renderLibrary(); } }, 'Tout'));
  for (const t of tags) tagBox.append(h('button', { class: 'chip' + (S.tagFilter === t ? ' on' : ''), onclick: () => { S.tagFilter = t; renderLibrary(); } }, t));
  const list = $('lib-list'); list.replaceChildren();
  const shown = S.scores.filter((s) => (!S.tagFilter || (s.tags || []).includes(S.tagFilter)) &&
    (!q || s.title.toLowerCase().includes(q) || (s.tags || []).some((t) => t.toLowerCase().includes(q))));
  if (!shown.length) list.append(h('p', { class: 'muted' }, 'Aucune partition ne correspond.'));
  for (const s of shown) {
    const cv = h('canvas');
    const del = h('button', { class: 'ghost small danger' }, 'Supprimer');
    const card = h('div', { class: 'card' },
      h('h3', {}, s.title),
      h('div', { class: 'tags' }, (s.builtin ? ['fournie'] : []).concat(s.tags || []).map((t) => h('span', { class: 'tag' }, t))),
      cv,
      h('div', { class: 'meta' }, scoreMeta(s)),
      h('div', { class: 'acts' },
        h('button', { class: 'primary small', onclick: () => { setMode(s); showTab('practice'); } }, 'Pratiquer'),
        s.builtin ? h('button', { class: 'ghost small', onclick: () => duplicate(s) }, 'Copier pour modifier')
          : h('button', { class: 'ghost small', onclick: () => openEditor(s) }, 'Modifier'),
        s.builtin ? null : del));
    if (!s.builtin) twoStep(del, 'Confirmer', async () => { await db.del('scores', s.id); await loadScores(); renderLibrary(); toast('Partition supprimée.'); });
    list.append(card);
    requestAnimationFrame(() => drawPreview(cv, transposeNotes(s.notes, (S.prefs[s.id] || {}).transpose || 0), S.profile));
  }
}
async function duplicate(s) {
  const copy = { ...s, id: db.uid(), title: s.title + ' (copie)', builtin: false, updated: Date.now(), tags: (s.tags || []).filter((t) => t !== 'domaine public') };
  delete copy.order;
  await db.put('scores', copy); await loadScores(); openEditor(copy);
}

// ---------- import ----------
let imp = null;
async function openImport(file) {
  try { imp = await importFile(file); }
  catch (e) { toast(e.message || String(e), 6000); return; }
  if (!imp.parts.length) { toast('Aucune note trouvée dans ce fichier.'); return; }
  $('imp-title').value = imp.title;
  const sel = $('imp-part'); sel.replaceChildren();
  imp.parts.forEach((p, i) => sel.append(h('option', { value: i }, `${p.name} (${p.notes.length} notes${p.info ? ', ' + p.info : ''})`)));
  // la partie avec des paroles est souvent la voix
  const vocal = imp.parts.findIndex((p) => p.notes.some((n) => n.l));
  sel.value = String(vocal >= 0 ? vocal : 0);
  $('imp-oct').value = '0';
  const dlg = $('imp-dlg');
  dlg.returnValue = '';
  dlg.showModal();
  updateImportPreview();
}
function importNotes() {
  const p = imp.parts[+$('imp-part').value];
  return transposeNotes(p.notes, +$('imp-oct').value);
}
function updateImportPreview() {
  const notes = importNotes();
  const r = scoreRange(notes);
  const p = imp.parts[+$('imp-part').value];
  $('imp-info').textContent = `${notes.length} notes, de ${noteName(r[0])} à ${noteName(r[1])}, tempo ${imp.tempo}, ${imp.beatsPerBar} temps par mesure.` +
    (p.clefOct ? " La clé de cette partie est octaviée : si l'étendue te paraît une octave trop haute, choisis −1 octave." : '');
  drawPreview($('imp-preview'), notes, S.profile);
}
async function saveImport() {
  const notes = importNotes();
  const s = { id: db.uid(), title: $('imp-title').value.trim() || 'Sans titre', tags: ['importée'], tempo: imp.tempo, beatsPerBar: imp.beatsPerBar, notes, updated: Date.now() };
  await db.put('scores', s); await loadScores(); renderLibrary();
  toast(`« ${s.title} » ajoutée.`);
}

// ---------- éditeur ----------
let ed = { score: null, dur: 1, lastDur: null };
const DURS = [[0.25, '♬ ¼'], [0.5, '♪ ½'], [1, '♩ 1'], [1.5, '♩. 1½'], [2, '𝅗𝅥 2'], [3, '3'], [4, '𝅝 4']];
function initEditor() {
  const durs = $('ed-durs');
  for (const [d, lbl] of DURS) durs.append(h('button', { 'data-d': d, onclick: () => { ed.dur = d; markDur(); } }, lbl));
  $('ed-text').addEventListener('input', updateEditorPreview);
  $('ed-cancel').addEventListener('click', () => showTab('library'));
  $('ed-save').addEventListener('click', saveEditor);
  $('ed-play').addEventListener('click', playEditor);
  $('ed-rest').addEventListener('click', () => insertToken('-'));
  $('ed-undo').addEventListener('click', () => {
    const ta = $('ed-text'); const parts = ta.value.trimEnd().split(/\s+/); parts.pop();
    ta.value = parts.join(' ') + (parts.length ? ' ' : ''); updateEditorPreview();
  });
  window.addEventListener('resize', () => { if ($('v-editor').classList.contains('on')) updateEditorPreview(); });
}
function markDur() { $('ed-durs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.d === ed.dur)); }
function buildKeys() {
  const box = $('ed-keys'); box.replaceChildren();
  const lo = Math.min(S.profile.chestLow, S.profile.headLow) - 3, hi = Math.max(S.profile.chestHigh, S.profile.headHigh) + 2;
  let white = 0;
  const KW = 33;
  for (let m = lo; m <= hi; m++) {
    const black = isBlack(m);
    if (black && m === lo) continue;
    const z = noteZone(m, S.profile);
    const k = h('button', { class: 'key' + (black ? ' black' : '') + (z === 'out' ? ' zone-out' : z === 'passage' ? ' zone-passage' : ''), title: noteName(m), type: 'button' },
      !black && (m % 12 === 0 || m % 12 === 5 || m % 12 === 9) ? noteName(m) : '');
    k.addEventListener('pointerdown', (e) => { e.preventDefault(); keyHit(m, k); });
    if (black) k.style.left = `${white * KW - 12}px`; else white++;
    box.append(k);
  }
  box.style.width = `${white * KW + 2}px`;
}
async function keyHit(m, el) {
  el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 160);
  await engine.ensureContext();
  engine.synth.note(m, engine.ctx.currentTime + 0.01, 0.5, 0.3);
  const name = ['do', 'do#', 'ré', 'ré#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'][m % 12] + (Math.floor(m / 12) - 1);
  insertToken(name);
}
function insertToken(base) {
  const ta = $('ed-text');
  let tok = base;
  if (ed.dur !== ed.lastDur) { tok += ':' + ed.dur; ed.lastDur = ed.dur; }
  const ly = $('ed-lyric').value.trim();
  if (ly && base !== '-') { tok += '/' + ly.replace(/\s+/g, '_'); $('ed-lyric').value = ''; }
  const pos = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, pos), after = ta.value.slice(pos);
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  ta.value = before + sep + tok + ' ' + after.replace(/^\s+/, '');
  const np = (before + sep + tok + ' ').length;
  ta.setSelectionRange(np, np);
  updateEditorPreview();
}
function openEditor(score) {
  ed = { score, dur: 1, lastDur: null };
  $('ed-heading').textContent = score ? 'Modifier la partition' : 'Nouvelle partition';
  $('ed-title').value = score ? score.title : '';
  $('ed-tempo').value = score ? score.tempo : 80;
  $('ed-bpb').value = score ? score.beatsPerBar : 4;
  $('ed-tags').value = score ? (score.tags || []).join(', ') : '';
  $('ed-text').value = score ? toText(score.notes, score.beatsPerBar) : '';
  // reprendre la dernière durée écrite pour que l'insertion au clavier reste cohérente
  const durMatches = $('ed-text').value.match(/:([\d./]+)/g);
  ed.lastDur = score ? (durMatches ? parseFloat(durMatches[durMatches.length - 1].slice(1)) : null) : null;
  markDur(); buildKeys();
  showView('v-editor');
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === 'library'));
  updateEditorPreview();
}
function updateEditorPreview() {
  const { notes, errors, length } = parseText($('ed-text').value);
  const errs = $('ed-errors'); errs.replaceChildren(...errors.slice(0, 6).map((e) => h('li', {}, e)));
  const r = scoreRange(notes);
  const bpb = +$('ed-bpb').value || 4;
  $('ed-info').textContent = r ? `${notes.length} notes, de ${noteName(r[0])} à ${noteName(r[1])}, ${Math.ceil(length / bpb)} mesures.` : 'Clique sur le clavier ou écris les notes.';
  drawPreview($('ed-preview'), notes, S.profile);
}
async function saveEditor() {
  const { notes, errors } = parseText($('ed-text').value);
  if (!notes.length) { toast('Ajoute au moins une note.'); return; }
  if (errors.length) { toast('Corrige les notes signalées en rouge avant d’enregistrer.'); return; }
  const s = ed.score && !ed.score.builtin ? { ...ed.score } : { id: db.uid() };
  Object.assign(s, {
    title: $('ed-title').value.trim() || 'Sans titre',
    tempo: Math.max(20, Math.min(240, +$('ed-tempo').value || 80)),
    beatsPerBar: Math.max(1, +$('ed-bpb').value || 4),
    tags: $('ed-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    notes, updated: Date.now(), builtin: false,
  });
  await db.put('scores', s); await loadScores();
  toast('Partition enregistrée.');
  setMode(S.scores.find((x) => x.id === s.id));
  showTab('library');
}
async function playEditor() {
  const { notes } = parseText($('ed-text').value);
  if (!notes.length) return;
  await engine.ensureContext();
  engine.synth.stopAll();
  const bps = (+$('ed-tempo').value || 80) / 60, t = engine.ctx.currentTime + 0.1;
  for (const n of notes) engine.synth.note(n.m, t + n.b / bps, n.d / bps * 0.95, 0.3);
}

// ---------- pratique ----------
let roll, rpRoll, run = null, rafId = 0, idleLive = null;
function initPractice() {
  roll = new Roll($('roll'));
  rpRoll = new Roll($('rp-roll'));
  $('pr-play').addEventListener('click', () => (run ? stopRun() : startRun()));
  $('pr-rec').addEventListener('change', (e) => { S.rec = e.target.checked; });
  $('pr-loop').addEventListener('change', (e) => { S.loop = e.target.checked; });
  $('pr-from').addEventListener('change', () => { readBars(); drawIdle(); });
  $('pr-to').addEventListener('change', () => { readBars(); drawIdle(); });
  $('pr-up').addEventListener('click', () => setTranspose(S.transpose + 1));
  $('pr-down').addEventListener('click', () => setTranspose(S.transpose - 1));
  $('pr-oct-up').addEventListener('click', () => setTranspose(S.transpose + 12));
  $('pr-oct-down').addEventListener('click', () => setTranspose(S.transpose - 12));
  $('pr-tempo').addEventListener('input', (e) => { S.tempoPct = +e.target.value; $('pr-tempo-lbl').textContent = `${S.tempoPct} %`; savePref(); });
  $('pr-guide').addEventListener('change', (e) => { S.guide = e.target.value; });
  $('pr-vol').addEventListener('input', (e) => { S.guideVol = +e.target.value; });
  $('pr-metro').addEventListener('change', (e) => { S.metro = e.target.checked; });
  $('pr-zoom').addEventListener('input', (e) => { S.zoom = +e.target.value; drawIdle(); });
  $('pr-suggest').addEventListener('click', suggest);
  $('pr-fit').addEventListener('click', fitToVoice);
  setInterval(() => { $('pr-level').style.width = `${Math.max(0, Math.min(100, (engine.levelDb + 70) * 1.6))}%`; }, 80);
}
function setMode(score) {
  if (run) stopRun();
  S.current = score;
  S.mode = score ? 'score' : 'free';
  document.body.classList.toggle('free', !score);
  $('pr-title').textContent = score ? score.title : 'Mode libre';
  $('pr-about').textContent = score ? (score.about || scoreMeta(score)) : 'Ta voix tracée en direct, sans partition. Pratique pour explorer ta tessiture ou tenir une note.';
  $('pr-result').replaceChildren();
  if (score) {
    const pref = S.prefs[score.id] || {};
    S.transpose = pref.transpose || 0;
    S.tempoPct = pref.tempoPct || 100;
    $('pr-tempo').value = S.tempoPct; $('pr-tempo-lbl').textContent = `${S.tempoPct} %`;
    const bars = Math.max(1, Math.ceil(scoreLength(score) / score.beatsPerBar - 1e-6));
    $('pr-from').max = bars; $('pr-to').max = bars;
    $('pr-from').value = 1; $('pr-to').value = bars;
    readBars();
    showTranspose();
  }
  drawIdle();
}
function readBars() {
  if (!S.current) return;
  const bars = Math.max(1, Math.ceil(scoreLength(S.current) / S.current.beatsPerBar - 1e-6));
  let a = Math.max(1, Math.min(bars, Math.round(+$('pr-from').value || 1)));
  let b = Math.max(a, Math.min(bars, Math.round(+$('pr-to').value || bars)));
  $('pr-from').value = a; $('pr-to').value = b;
  S.fromBar = a; S.toBar = b;
}
async function savePref() {
  if (!S.current) return;
  S.prefs[S.current.id] = { transpose: S.transpose, tempoPct: S.tempoPct };
  await db.kvSet('prefs', S.prefs);
}
function setTranspose(s) {
  S.transpose = Math.max(-36, Math.min(36, s));
  showTranspose(); savePref(); drawIdle();
}
function showTranspose() {
  $('pr-shift').textContent = S.transpose > 0 ? `+${S.transpose}` : String(S.transpose);
  let lbl = shiftLabel(S.transpose);
  if (S.current) {
    const e = evaluateShift(S.current.notes, S.transpose, S.profile);
    const r = scoreRange(transposeNotes(S.current.notes, S.transpose));
    if (r) lbl += ` · ${noteName(r[0])} – ${noteName(r[1])}`;
    if (e.outside) lbl += ` · ${e.outside} hors tessiture`;
    else if (e.passage) lbl += ` · ${e.passage} dans le passage`;
  }
  $('pr-shift-lbl').textContent = lbl;
}
function suggest() {
  if (!S.current) return;
  const best = suggestShift(S.current.notes, S.profile);
  setTranspose(best.shift);
  const parts = [`Tonalité conseillée : ${shiftLabel(best.shift)}.`];
  parts.push(best.outside ? `${best.outside} note${best.outside > 1 ? 's restent' : ' reste'} hors de ta tessiture.` : 'Toutes les notes tiennent dans ta tessiture.');
  if (best.passage) parts.push(`${best.passage} dans ta zone de passage, entourées en orange.`);
  toast(parts.join(' '), 6000);
}
function selectionNotes() {
  const s = S.current, bpb = s.beatsPerBar;
  const a = (S.fromBar - 1) * bpb, b = Math.min(scoreLength(s), S.toBar * bpb);
  return { start: a, end: b, notes: transposeNotes(s.notes, S.transpose).filter((n) => n.b >= a - 1e-6 && n.b < b - 1e-6) };
}
async function fitToVoice() {
  if (!S.current || run) return;
  try { await engine.start(); } catch (e) { micError(e); return; }
  const first = selectionNotes().notes.find((n) => n.m != null);
  if (!first) return;
  const orig = first.m - S.transpose;
  const btn = $('pr-fit');
  btn.disabled = true;
  const vals = [];
  const t0 = engine.ctx.currentTime;
  $('roll-msg').textContent = '';
  toast(`Chante la première note${first.l ? ` (« ${first.l} »)` : ''} là où elle te paraît naturelle et tiens-la 2 secondes.`, 3000);
  const off = engine.onPitch((ev) => { if (ev.time > t0 + 0.6) vals.push(ev.midi); showReadout(ev, null); });
  await new Promise((r) => setTimeout(r, 3000));
  off(); btn.disabled = false;
  const held = heldNote(vals, 60);
  if (held === null) { toast("Je n'ai pas entendu de note tenue assez stable. Réessaie un peu plus fort ou plus longtemps."); return; }
  const shift = Math.round(held - orig);
  setTranspose(shift);
  toast(`Calé : ${shiftLabel(shift)}. Tu as chanté ${noteName(held)}, la mélodie démarre donc sur ${noteName(orig + shift)}.`, 6000);
}
function micError(e) {
  const msg = e && e.name === 'NotAllowedError' ? "L'accès au micro a été refusé. Autorise-le dans les réglages du navigateur pour cette page." : (e.message || String(e));
  toast(msg, 7000);
}
function viewRange(notes) {
  if (!notes || !notes.length) {
    const p = S.profile;
    return [Math.min(p.chestLow, p.headLow) - 3, Math.max(p.chestHigh, p.headHigh) + 3];
  }
  const r = scoreRange(notes);
  let lo = r[0] - 4, hi = r[1] + 4;
  while (hi - lo < 16) { lo--; hi++; }
  return [lo, hi];
}
function pxPerBeat(bps) { return (140 * S.zoom) / bps; }
function drawIdle() {
  if (run || !$('v-practice').classList.contains('on')) return;
  if (S.mode === 'free') {
    const [lo, hi] = viewRange(null);
    roll.draw({ notes: [], beat: 0, pxPerBeat: 140 * S.zoom, yMin: lo, yMax: hi, frames: idleLive ? idleLive : [], profile: S.profile, playX: 0.75 });
    $('roll-msg').textContent = '';
    return;
  }
  const sel = selectionNotes();
  const all = transposeNotes(S.current.notes, S.transpose);
  const bps = (S.current.tempo * S.tempoPct) / 100 / 60;
  const [lo, hi] = viewRange(all);
  roll.draw({ notes: all, beat: sel.start, pxPerBeat: pxPerBeat(bps), yMin: lo, yMax: hi, frames: [], profile: S.profile, beatsPerBar: S.current.beatsPerBar, showBars: true, start: sel.start, end: sel.end });
}

async function startRun() {
  try { await engine.start(); } catch (e) { micError(e); return; }
  applySettings();
  const ctx = engine.ctx;
  $('pr-result').replaceChildren();
  if (S.mode === 'free') {
    run = { free: true, t0: ctx.currentTime, frames: [], bps: 1, notes: [], range: viewRange(null) };
  } else {
    const sc = S.current;
    const sel = selectionNotes();
    const bps = (sc.tempo * S.tempoPct) / 100 / 60;
    const countIn = Math.max(2, Math.round(sc.beatsPerBar));
    const t0 = ctx.currentTime + 0.3 + countIn / bps;
    run = {
      free: false, t0, bps, countIn, start: sel.start, end: sel.end, L: sel.end - sel.start, loop: S.loop,
      notes: sel.notes, all: transposeNotes(sc.notes, S.transpose), frames: [], sched: ctx.currentTime, range: viewRange(transposeNotes(sc.notes, S.transpose)),
      transpose: S.transpose, tempoPct: S.tempoPct,
    };
    // décompte
    for (let i = 0; i < countIn; i++) engine.synth.click(t0 - (countIn - i) / bps, i === 0, 0.45);
    const firstNote = sel.notes.find((n) => n.m != null);
    if (S.guide === 'start' && firstNote) engine.synth.note(firstNote.m, t0 - countIn / bps, (countIn - 0.5) / bps, S.guideVol * 0.6);
    run.events = [];
    if (S.guide === 'full') for (const n of sel.notes) if (n.m != null) run.events.push({ t: (n.b - sel.start) / bps, m: n.m, d: (n.d / bps) * 0.96 });
    if (S.metro) for (let b = Math.ceil(sel.start); b < sel.end; b++) run.events.push({ t: (b - sel.start) / bps, click: true, accent: b % sc.beatsPerBar === 0 });
    run.timer = setInterval(schedule, 40);
    schedule();
  }
  run.recording = S.rec;
  if (S.rec) engine.startRecording();
  run.off = engine.onPitch(onFrame);
  $('pr-play').textContent = '■ Arrêter';
  $('pr-play').classList.add('stop');
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}
function beatAt(t) {
  const r = run;
  if (r.free) return { b: t - r.t0, k: 0 };
  const x = (t - r.t0) * r.bps;
  if (x < 0) return { b: r.start + x, k: -1 };
  if (r.loop) { const k = Math.floor(x / r.L); return { b: r.start + x - k * r.L, k }; }
  return { b: r.start + x, k: 0 };
}
function schedule() {
  if (!run || run.free) return;
  const ctx = engine.ctx, until = ctx.currentTime + 0.3;
  const per = run.L / run.bps;
  const kFrom = Math.max(0, Math.floor((run.sched - run.t0) / per));
  const kTo = run.loop ? Math.max(0, Math.floor((until - run.t0) / per)) : 0;
  for (let k = kFrom; k <= kTo; k++) {
    for (const e of run.events) {
      const at = run.t0 + k * per + e.t;
      if (at >= run.sched && at < until) {
        if (e.click) engine.synth.click(at, e.accent, 0.3);
        else engine.synth.note(e.m, at, e.d, S.guideVol * 0.5);
      }
    }
  }
  run.sched = until;
}
function targetAt(notes, b) {
  for (const n of notes) if (n.m != null && b >= n.b && b < n.b + n.d) return n;
  return null;
}
function fold(c) { return c - 1200 * Math.round(c / 1200); }
function onFrame(ev) {
  if (!run) return;
  const { b, k } = beatAt(ev.time);
  const tgt = run.free ? null : targetAt(run.notes, b);
  const c = tgt && ev.midi !== null ? fold((ev.midi - tgt.m) * 100) : null;
  run.frames.push({ b, m: ev.midi, c, k, t: ev.time });
  showReadout(ev, tgt);
}
let lastRo = 0;
function showReadout(ev, tgt) {
  const now = performance.now();
  if (now - lastRo < 50) return; lastRo = now;
  if (ev.midi === null) { $('ro-hz').textContent = '– Hz'; return; }
  const m = ev.midi, near = Math.round(m);
  $('ro-note').textContent = noteName(near);
  $('ro-hz').textContent = `${(ev.f0 || midiToFreq(m)).toFixed(1)} Hz`;
  let c, label;
  if (tgt) { c = fold((m - tgt.m) * 100); label = `cible ${noteName(tgt.m)}`; }
  else { c = (m - near) * 100; label = ''; }
  $('ro-target').textContent = label;
  $('ro-cents').textContent = tgt ? `écart à la cible ${fmtCents(c)}` : `écart ${fmtCents(c)}`;
  const pos = Math.max(-100, Math.min(100, c));
  const nd = $('ro-needle');
  nd.style.left = `${50 + pos / 2}%`;
  nd.style.background = Math.abs(c) <= 25 ? 'var(--good)' : Math.abs(c) <= 50 ? 'var(--warn)' : 'var(--bad)';
}
function tick() {
  if (!run) return;
  const ctx = engine.ctx;
  const cur = beatAt(ctx.currentTime);
  const [lo, hi] = run.range;
  if (run.free) {
    const fr = run.frames.length > 4000 ? run.frames.slice(-4000) : run.frames;
    roll.draw({ notes: [], beat: cur.b, pxPerBeat: 140 * S.zoom, yMin: lo, yMax: hi, frames: fr, profile: S.profile, playX: 0.75 });
  } else {
    const shown = run.frames.filter((f) => f.k === cur.k || (cur.k <= 0 && f.k <= 0));
    roll.draw({ notes: run.all, beat: cur.b, pxPerBeat: pxPerBeat(run.bps), yMin: lo, yMax: hi, frames: shown, profile: S.profile, beatsPerBar: S.current.beatsPerBar, showBars: true, start: run.start, end: run.end });
    const msg = $('roll-msg');
    if (cur.k < 0) msg.textContent = String(Math.ceil(-(cur.b - run.start)));
    else msg.textContent = '';
    if (!run.loop && cur.b >= run.end + 0.4) { stopRun(); return; }
  }
  rafId = requestAnimationFrame(tick);
}
async function stopRun() {
  if (!run) return;
  const r = run; run = null;
  cancelAnimationFrame(rafId);
  clearInterval(r.timer);
  r.off();
  engine.synth.stopAll();
  $('roll-msg').textContent = '';
  $('pr-play').textContent = '▶ Lancer';
  $('pr-play').classList.remove('stop');
  const rec = r.recording ? engine.stopRecording() : null;
  if (r.free) {
    if (rec) { await saveTake(r, rec, null); toast('Prise enregistrée dans « Prises ».'); }
    drawIdle();
    return;
  }
  const frames = r.frames.filter((f) => f.k >= 0 && f.b >= r.start && f.b < r.end);
  const voiced = frames.filter((f) => f.m !== null).length;
  if (voiced < 20) { toast('Pas assez de voix détectée pour faire un bilan.'); drawIdle(); return; }
  const result = analyse(r.notes, frames, r.bps);
  const box = $('pr-result');
  box.replaceChildren(renderBilan(result, 'Bilan de la prise'));
  if (rec) {
    await saveTake(r, rec, result);
    box.prepend(h('p', { class: 'muted small' }, 'Prise enregistrée avec le son. Retrouve-la dans « Prises ».'));
  } else {
    const btn = h('button', { class: 'ghost small' }, 'Garder ce bilan dans les prises (sans le son)');
    btn.addEventListener('click', async () => { await saveTake(r, null, result); btn.replaceWith(h('span', { class: 'muted small' }, 'Bilan gardé.')); });
    box.prepend(h('div', { class: 'row-btns' }, btn));
  }
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  drawIdle();
}
async function saveTake(r, rec, result) {
  const base = rec ? rec.startTime : r.free ? r.t0 : r.t0 - r.countIn / r.bps;
  const fr = r.frames;
  const take = {
    id: db.uid(), date: Date.now(), mode: r.free ? 'free' : 'score',
    scoreId: r.free ? null : S.current.id, title: r.free ? 'Mode libre' : S.current.title,
    transpose: r.transpose || 0, tempoPct: r.tempoPct || 100, bps: r.bps,
    start: r.start ?? 0, end: r.end ?? (fr.length ? fr[fr.length - 1].b : 0), beatsPerBar: r.free ? null : S.current.beatsPerBar,
    notes: r.free ? [] : r.notes,
    frames: {
      t: Float32Array.from(fr, (f) => f.t - base), b: Float32Array.from(fr, (f) => f.b),
      m: Float32Array.from(fr, (f) => (f.m === null ? NaN : f.m)), k: Int16Array.from(fr, (f) => f.k),
    },
    audio: rec ? rec.blob : null,
    duration: rec ? rec.duration : fr.length ? fr[fr.length - 1].t - fr[0].t : 0,
    result,
  };
  await db.put('takes', take);
  return take;
}

function renderBilan(result, title) {
  const s = result.summary;
  const tile = (lbl, val, cls = '') => h('div', { class: 'tile ' + cls }, h('span', {}, lbl), h('b', {}, val));
  const rows = result.rows.map((r) => h('tr', {},
    h('td', {}, String(r.idx + 1)),
    h('td', {}, noteName(r.m)),
    h('td', {}, r.l || ''),
    h('td', {}, r.sung ? fmtCents(r.err) : 'non chantée'),
    h('td', {}, r.sung ? `±${Math.round(r.spread)} c` : ''),
    h('td', {}, r.attack != null ? `${Math.round(r.attack * 1000)} ms` : r.sung ? 'pas atteinte' : ''),
    h('td', {}, h('span', { class: 'pill ' + pillClass(r.score) }, `${r.score} %`)),
    h('td', {}, r.octave ? 'à l’octave' : '')));
  return h('div', { class: 'bilan panel' },
    h('h3', {}, title),
    h('div', { class: 'tiles' },
      tile('Score de justesse', `${s.score} %`, 'score'),
      tile('Écart moyen', s.meanAbsErr != null ? `${Math.round(s.meanAbsErr)} cents` : '–'),
      tile('Tendance', s.bias != null ? fmtCents(s.bias) : '–'),
      tile('Stabilité', s.spread != null ? `±${Math.round(s.spread)} cents` : '–'),
      tile('Attaque moyenne', s.attack != null ? `${Math.round(s.attack * 1000)} ms` : '–'),
      tile('Notes ratées', `${s.missed + s.silent} / ${s.notes}`)),
    h('ul', { class: 'insights' }, result.insights.map((i) => h('li', { class: i.kind }, i.text))),
    h('details', {}, h('summary', { class: 'small' }, 'Détail note par note'),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['#', 'Note', 'Syllabe', 'Écart', 'Stabilité', 'Attaque', 'Juste', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows)))),
    h('p', { class: 'muted small' }, 'Une note est juste à ±50 cents (un quart de ton) et bien centrée à ±25. L’attaque est le temps pour te poser dans la zone juste. Le score compte la part du temps passée dans la zone juste, hors attaque.'));
}

// ---------- prises ----------
function initTakes() {
  $('tk-filter').addEventListener('change', renderTakes);
  $('rp-close').addEventListener('click', closeReplay);
  $('rp-play').addEventListener('click', toggleReplay);
  $('rp-pos').addEventListener('input', seekReplay);
  $('rp-audio').addEventListener('ended', () => { $('rp-play').textContent = '▶ Réécouter'; });
}
async function renderTakes() {
  const takes = (await db.all('takes')).sort((a, b) => b.date - a.date);
  const sel = $('tk-filter'); const val = sel.value;
  const titles = [...new Map(takes.map((t) => [t.scoreId || 'free', t.title])).entries()];
  sel.replaceChildren(h('option', { value: '' }, 'Toutes les partitions'), ...titles.map(([id, t]) => h('option', { value: id }, t)));
  sel.value = titles.some(([id]) => id === val) ? val : '';
  const list = $('tk-list'); list.replaceChildren();
  const shown = takes.filter((t) => !sel.value || (t.scoreId || 'free') === sel.value);
  if (!shown.length) list.append(h('p', { class: 'muted' }, 'Aucune prise pour l’instant. Coche « Enregistrer » avant de lancer une partition, ou garde le bilan après une prise.'));
  for (const t of shown) {
    const del = h('button', { class: 'ghost small danger' }, 'Supprimer');
    twoStep(del, 'Confirmer', async () => { await db.del('takes', t.id); renderTakes(); });
    const score = t.result ? t.result.summary.score : null;
    list.append(h('div', { class: 'take' },
      score != null ? h('span', { class: 'pill ' + pillClass(score) }, `${score} %`) : h('span', { class: 'pill' }, 'libre'),
      h('div', { class: 't-main' }, h('b', {}, t.title),
        h('span', { class: 'muted small' }, [fmtDate(t.date), fmtDur(t.duration || 0), t.mode === 'score' ? shiftLabel(t.transpose) : null, t.mode === 'score' ? `tempo ${t.tempoPct} %` : null, t.audio ? 'avec le son' : 'sans le son'].filter(Boolean).join(' · '))),
      h('button', { class: 'ghost small', onclick: () => openReplay(t) }, t.audio ? 'Réécouter' : 'Revoir'),
      t.audio ? h('button', { class: 'ghost small', onclick: () => download(`${t.title} ${new Date(t.date).toISOString().slice(0, 16).replace(':', 'h')}.wav`, t.audio) }, 'Télécharger') : null,
      del));
  }
}
let rp = null;
function openReplay(t) {
  closeReplay();
  const F = t.frames;
  const frames = Array.from(F.b, (b, i) => {
    const m = Number.isNaN(F.m[i]) ? null : F.m[i];
    const tgt = t.mode === 'score' ? targetAt(t.notes, b) : null;
    return { b, m, k: F.k[i], t: F.t[i], c: tgt && m !== null ? fold((m - tgt.m) * 100) : null };
  });
  const [lo, hi] = viewRange(t.mode === 'score' ? t.notes : null);
  rp = { take: t, frames, lo, hi, idx: 0 };
  $('tk-replay').hidden = false;
  $('rp-title').textContent = `${t.title} · ${fmtDate(t.date)}`;
  const audio = $('rp-audio');
  if (t.audio) { audio.src = URL.createObjectURL(t.audio); $('rp-play').hidden = false; } else { audio.removeAttribute('src'); $('rp-play').hidden = true; }
  $('rp-pos').max = String(Math.max(0.1, frames.length ? frames[frames.length - 1].t : 1));
  $('rp-pos').value = '0';
  $('rp-bilan').replaceChildren(t.result ? renderBilan(t.result, 'Bilan') : h('p', { class: 'muted small' }, 'Prise en mode libre, sans bilan.'));
  rpRoll.resize();
  drawReplay(frames.length ? frames[0].t : 0);
  $('tk-replay').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeReplay() {
  if (!rp) return;
  const a = $('rp-audio'); a.pause();
  if (a.src) URL.revokeObjectURL(a.src);
  cancelAnimationFrame(rp.raf);
  rp = null; $('tk-replay').hidden = true;
  $('rp-play').textContent = '▶ Réécouter';
}
function frameAtTime(t) { // recherche dichotomique
  const f = rp.frames; let lo = 0, hi = f.length - 1;
  if (!f.length) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (f[mid].t <= t) lo = mid; else hi = mid - 1; }
  return lo;
}
function drawReplay(t) {
  const tk = rp.take;
  const i = frameAtTime(t);
  const f = i >= 0 ? rp.frames[i] : { b: tk.start, k: 0 };
  let beat = f.b + (t - (f.t ?? t)) * (tk.bps || 1);
  // on trace la voix jusqu'à l'instant écouté, comme pendant la prise
  const upTo = rp.frames.slice(0, i + 1);
  const frames = tk.mode === 'score' ? upTo.filter((x) => x.k === f.k || (f.k <= 0 && x.k <= 0)) : upTo;
  rpRoll.draw({
    notes: tk.notes, beat, pxPerBeat: pxPerBeat(tk.bps || 1), yMin: rp.lo, yMax: rp.hi, frames, profile: S.profile,
    beatsPerBar: tk.beatsPerBar, showBars: tk.mode === 'score', start: tk.mode === 'score' ? tk.start : null, end: tk.mode === 'score' ? tk.end : null,
    playX: tk.mode === 'score' ? 0.3 : 0.6,
  });
  $('rp-time').textContent = `${fmtDur(Math.max(0, t))}`;
}
function toggleReplay() {
  const a = $('rp-audio');
  if (!a.src) return;
  if (!a.paused) { a.pause(); $('rp-play').textContent = '▶ Réécouter'; return; }
  a.play(); $('rp-play').textContent = '❚❚ Pause';
  const loop = () => {
    if (!rp) return;
    drawReplay(a.currentTime);
    $('rp-pos').value = String(a.currentTime);
    if (!a.paused) rp.raf = requestAnimationFrame(loop);
  };
  rp.raf = requestAnimationFrame(loop);
}
function seekReplay(e) {
  const t = +e.target.value;
  const a = $('rp-audio');
  if (a.src) a.currentTime = t;
  drawReplay(t);
}

// ---------- progrès ----------
function initProgress() {
  $('pg-score').addEventListener('change', renderProgress);
  $('pg-csv').addEventListener('click', exportCsv);
  window.addEventListener('resize', () => { if (S.tab === 'progress') renderProgress(); });
}
async function renderProgress() {
  const takes = (await db.all('takes')).filter((t) => t.result).sort((a, b) => a.date - b.date);
  const sel = $('pg-score'); const val = sel.value;
  const titles = [...new Map(takes.map((t) => [t.scoreId, t.title])).entries()];
  sel.replaceChildren(h('option', { value: '' }, 'Toutes les partitions'), ...titles.map(([id, t]) => h('option', { value: id }, t)));
  sel.value = titles.some(([id]) => id === val) ? val : '';
  const list = takes.filter((t) => !sel.value || t.scoreId === sel.value);
  const allTakes = await db.all('takes');
  const totalTime = allTakes.reduce((a, t) => a + (t.duration || 0), 0);
  const tile = (lbl, v, cls = '') => h('div', { class: 'tile ' + cls }, h('span', {}, lbl), h('b', {}, v));
  const scores = list.map((t) => t.result.summary.score);
  const lastN = (n) => scores.slice(-n);
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  $('pg-tiles').replaceChildren(
    tile('Prises avec bilan', String(list.length)),
    tile('Temps de pratique enregistré', fmtDur(totalTime)),
    tile('Moyenne des 5 dernières', avg(lastN(5)) != null ? `${avg(lastN(5))} %` : '–', 'score'),
    tile('Meilleur score', scores.length ? `${Math.max(...scores)} %` : '–'));
  drawChart($('pg-chart'), list);
  // points récurrents sur les 10 dernières prises
  const recent = list.slice(-10);
  const counts = {};
  for (const t of recent) for (const i of t.result.insights) if (i.kind === 'warn') { counts[i.key] = counts[i.key] || { n: 0, text: i.text }; counts[i.key].n++; counts[i.key].text = i.text; }
  const ins = Object.values(counts).sort((a, b) => b.n - a.n).slice(0, 5);
  $('pg-insights').replaceChildren(...(ins.length ? ins.map((i) => h('li', { class: 'warn' }, h('b', {}, `${i.n} prise${i.n > 1 ? 's' : ''} sur ${recent.length}. `), i.text))
    : [h('li', {}, list.length ? 'Rien de récurrent sur les dernières prises.' : 'Les points qui reviennent apparaîtront ici après quelques prises.')]));
  // notes difficiles
  const per = {};
  for (const t of list) for (const r of t.result.rows) {
    const key = `${t.scoreId}|${r.b}`;
    per[key] = per[key] || { title: t.title, m: r.m, l: r.l, b: r.b, bpb: t.beatsPerBar || 4, s: [] };
    per[key].s.push(r.score); per[key].m = r.m;
  }
  const hard = Object.values(per).map((p) => ({ ...p, avg: p.s.reduce((a, b) => a + b, 0) / p.s.length })).filter((p) => p.s.length >= 1).sort((a, b) => a.avg - b.avg).slice(0, 6);
  $('pg-hard').replaceChildren(...(hard.length ? hard.map((p) => h('div', { class: 'hard-row' },
    h('span', { style: 'min-width:5.5rem' }, `${noteName(p.m)}${p.l ? ` « ${p.l} »` : ''}`),
    h('span', { class: 'muted small', style: 'min-width:6rem' }, `${sel.value ? '' : p.title + ', '}mes. ${Math.floor(p.b / p.bpb) + 1}`),
    h('div', { class: 'bar-bg' }, h('div', { class: 'bar-fg', style: `width:${100 - p.avg}%` })),
    h('span', { class: 'tnum small' }, `${Math.round(p.avg)} %`)))
    : [h('p', { class: 'muted small' }, 'Pas encore de données.')]));
}
function drawChart(canvas, list) {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const W = r.width, H = r.height, L = 40, R = 12, T = 12, B = 26;
  g.clearRect(0, 0, W, H);
  g.font = '11px ' + css('--font-ui'); g.fillStyle = css('--muted'); g.textBaseline = 'middle';
  for (const v of [0, 25, 50, 75, 100]) {
    const y = T + (1 - v / 100) * (H - T - B);
    g.fillStyle = css('--line'); g.fillRect(L, Math.round(y), W - L - R, 1);
    g.fillStyle = css('--muted'); g.fillText(`${v} %`, 4, y);
  }
  if (!list.length) { g.fillText('Aucune prise avec bilan pour l’instant.', L + 10, H / 2); return; }
  const n = list.length;
  const x = (i) => (n === 1 ? L + (W - L - R) / 2 : L + (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  // moyenne glissante sur 5 prises
  g.strokeStyle = css('--note'); g.lineWidth = 6; g.lineJoin = 'round'; g.beginPath();
  list.forEach((t, i) => { const a = list.slice(Math.max(0, i - 4), i + 1).map((q) => q.result.summary.score); const v = a.reduce((p, q) => p + q, 0) / a.length; i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); });
  g.stroke();
  g.strokeStyle = css('--accent'); g.lineWidth = 2; g.beginPath();
  list.forEach((t, i) => { const v = t.result.summary.score; i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v)); });
  g.stroke();
  list.forEach((t, i) => { g.fillStyle = i === n - 1 ? css('--accent') : css('--surface'); g.strokeStyle = css('--accent'); g.lineWidth = 2; g.beginPath(); g.arc(x(i), y(t.result.summary.score), i === n - 1 ? 5 : 3.5, 0, 7); g.fill(); g.stroke(); });
  g.fillStyle = css('--muted'); g.textBaseline = 'alphabetic';
  const lbl = (i) => new Date(list[i].date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  g.textAlign = 'left'; g.fillText(lbl(0), L, H - 6);
  if (n > 1) { g.textAlign = 'right'; g.fillText(lbl(n - 1), W - R, H - 6); }
  g.textAlign = 'left';
}
async function exportCsv() {
  const takes = (await db.all('takes')).filter((t) => t.result).sort((a, b) => a.date - b.date);
  const rows = [['date', 'partition', 'transposition', 'tempo_pct', 'note_index', 'temps', 'cible_midi', 'cible', 'syllabe', 'ecart_cents', 'stabilite_cents', 'attaque_ms', 'juste_pct', 'score_note', 'score_prise']];
  for (const t of takes) for (const r of t.result.rows) {
    rows.push([new Date(t.date).toISOString(), t.title, t.transpose, t.tempoPct, r.idx + 1, r.b, r.m, noteName(r.m), r.l,
      r.err != null ? r.err.toFixed(1) : '', r.spread != null ? r.spread.toFixed(1) : '', r.attack != null ? Math.round(r.attack * 1000) : '',
      Math.round(r.inTune * 100), r.score, t.result.summary.score]);
  }
  const csv = rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
  download('voix-juste-prises.csv', new Blob(['﻿' + csv], { type: 'text/csv' }));
}

// ---------- profil ----------
const PF = [
  ['chestLow', 'Voix de poitrine, plus grave'], ['chestHigh', 'Voix de poitrine, plus aiguë'],
  ['headLow', 'Voix de tête, plus grave'], ['headHigh', 'Voix de tête, plus aiguë'],
  ['comfortLow', 'Zone confortable, bas'], ['comfortHigh', 'Zone confortable, haut'],
  ['passageLow', 'Passage (cassure), début'], ['passageHigh', 'Passage (cassure), fin'],
];
function initProfile() {
  $('rt-start').addEventListener('click', () => (rangeTest ? stopRangeTest() : startRangeTest()));
  $('rt-reset').addEventListener('click', () => { if (rangeTest) { rangeTest.low = null; rangeTest.high = null; } showRange(); });
  $('rt-chest').addEventListener('click', () => applyRange('chest'));
  $('rt-head').addEventListener('click', () => applyRange('head'));
  $('mt-start').addEventListener('click', micTest);
  const st = { 'st-naming': 'naming', 'st-flats': 'flats', 'st-a4': 'a4', 'st-fmin': 'fmin', 'st-gate': 'gateDb', 'st-lat': 'latencyMs' };
  for (const [id, key] of Object.entries(st)) {
    $(id).addEventListener('change', async (e) => {
      let v = e.target.value;
      if (key === 'flats') v = v === '1';
      else if (key !== 'naming') v = +v;
      S.settings[key] = v;
      await db.kvSet('settings', S.settings);
      applySettings(); renderProfile(); showTranspose();
    });
  }
  $('bk-export').addEventListener('click', exportBackup);
  $('bk-file').addEventListener('change', importBackup);
  $('imp-part').addEventListener('change', updateImportPreview);
  $('imp-oct').addEventListener('change', updateImportPreview);
  $('imp-dlg').addEventListener('close', () => { if ($('imp-dlg').returnValue === 'ok') saveImport(); });
}
function renderProfile() {
  const box = $('pf-fields'); box.replaceChildren();
  const opts = [];
  for (let m = 28; m <= 84; m++) opts.push(m);
  for (const [key, label] of PF) {
    const sel = h('select', { id: 'pf-' + key }, opts.map((m) => h('option', { value: m }, `${noteName(m)}  (${midiToFreq(m).toFixed(0)} Hz)`)));
    sel.value = String(S.profile[key]);
    sel.addEventListener('change', async () => { S.profile[key] = +sel.value; await db.kvSet('profile', S.profile); showTranspose(); });
    box.append(h('div', { class: 'field' }, h('label', { for: 'pf-' + key }, label), sel));
  }
  box.append(h('div', { class: 'field' }, h('label', {}, ' '), h('button', { class: 'ghost small', onclick: async () => { S.profile = { ...DEFAULT_PROFILE }; await db.kvSet('profile', S.profile); renderProfile(); } }, 'Revenir aux valeurs de départ')));
  $('st-naming').value = S.settings.naming; $('st-flats').value = S.settings.flats ? '1' : '0';
  $('st-a4').value = S.settings.a4; $('st-fmin').value = S.settings.fmin; $('st-gate').value = S.settings.gateDb; $('st-lat').value = S.settings.latencyMs;
}
let rangeTest = null;
async function startRangeTest() {
  try { await engine.start(); } catch (e) { micError(e); return; }
  rangeTest = { low: rangeTest?.low ?? null, high: rangeTest?.high ?? null, win: [] };
  $('rt-start').textContent = 'Arrêter';
  rangeTest.off = engine.onPitch((ev) => {
    const w = rangeTest.win; w.push(ev.midi); if (w.length > 50) w.shift();
    if (ev.midi !== null) $('rt-now').textContent = noteName(ev.midi);
    const held = heldNote(w, 45);
    if (held !== null) {
      const n = Math.round(held);
      if (rangeTest.low === null || n < rangeTest.low) rangeTest.low = n;
      if (rangeTest.high === null || n > rangeTest.high) rangeTest.high = n;
      showRange();
    }
  });
}
function stopRangeTest() {
  if (!rangeTest) return;
  rangeTest.off && rangeTest.off();
  rangeTest.off = null;
  $('rt-start').textContent = 'Démarrer';
  const keep = { low: rangeTest.low, high: rangeTest.high };
  rangeTest = null;
  rangeKeep = keep;
}
let rangeKeep = null;
function currentRange() { return rangeTest || rangeKeep || { low: null, high: null }; }
function showRange() {
  const r = currentRange();
  $('rt-low').textContent = r.low === null ? '–' : noteName(r.low);
  $('rt-high').textContent = r.high === null ? '–' : noteName(r.high);
  const ok = r.low !== null && r.high !== null;
  $('rt-chest').disabled = !ok; $('rt-head').disabled = !ok;
}
async function applyRange(kind) {
  const r = currentRange();
  if (r.low === null) return;
  S.profile[kind + 'Low'] = r.low; S.profile[kind + 'High'] = r.high;
  await db.kvSet('profile', S.profile);
  renderProfile();
  toast(`Voix de ${kind === 'chest' ? 'poitrine' : 'tête'} : ${noteName(r.low)} – ${noteName(r.high)}.`);
}
async function micTest() {
  try { await engine.start(); } catch (e) { micError(e); return; }
  const btn = $('mt-start'); btn.disabled = true;
  const notes = [41, 45, 50, 57, 62];
  const ctx = engine.ctx, t0 = ctx.currentTime + 0.4, dur = 1.6;
  const got = notes.map(() => []);
  const off = engine.onPitch((ev) => {
    const i = Math.floor((ev.time - t0) / dur), within = ev.time - t0 - i * dur;
    if (i >= 0 && i < notes.length && within > 0.4 && within < dur - 0.3 && ev.midi !== null) got[i].push(ev.midi);
  });
  notes.forEach((m, i) => engine.synth.note(m, t0 + i * dur, dur - 0.15, 0.5));
  $('mt-result').replaceChildren(h('p', { class: 'muted small' }, 'Écoute en cours…'));
  await new Promise((r) => setTimeout(r, (0.6 + notes.length * dur) * 1000));
  off(); btn.disabled = false;
  const rows = notes.map((m, i) => {
    const v = got[i].sort((a, b) => a - b);
    const med = v.length ? v[v.length >> 1] : null;
    const err = med === null ? null : (med - m) * 100;
    const verdict = med === null ? ['bad', 'non entendue'] : Math.abs(err) <= 15 ? ['good', 'juste'] : Math.abs(Math.abs(err) - 1200) < 60 ? ['warn', 'lue à l’octave'] : ['bad', 'mal lue'];
    return h('tr', {}, h('td', {}, noteName(m)), h('td', {}, `${midiToFreq(m).toFixed(1)} Hz`), h('td', {}, med === null ? '–' : noteName(med)), h('td', {}, err === null ? '–' : fmtCents(err)), h('td', {}, h('span', { class: 'pill ' + verdict[0] }, verdict[1])));
  });
  $('mt-result').replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Note jouée', 'Fréquence', 'Note lue', 'Écart', ''].map((t) => h('th', {}, t)))), h('tbody', {}, rows))),
  h('p', { class: 'muted small' }, 'Si rien n’est entendu, monte le volume ou baisse le seuil du micro. Les petits haut-parleurs restituent mal le fa2 : un écart sur cette note seule vient souvent du haut-parleur, pas du micro.'));
}

// ---------- sauvegarde ----------
const blobToB64 = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
const b64ToBlob = async (u) => (await fetch(u)).blob();
async function exportBackup() {
  const withAudio = $('bk-audio').checked;
  const takes = await db.all('takes');
  const out = {
    app: 'voix-juste', version: 1, date: new Date().toISOString(),
    profile: S.profile, settings: S.settings, prefs: S.prefs,
    scores: S.scores.filter((s) => !s.builtin),
    takes: await Promise.all(takes.map(async (t) => ({
      ...t, frames: { t: Array.from(t.frames.t), b: Array.from(t.frames.b), m: Array.from(t.frames.m, (v) => (Number.isNaN(v) ? null : v)), k: Array.from(t.frames.k) },
      audio: withAudio && t.audio ? await blobToB64(t.audio) : null,
    }))),
  };
  download(`voix-juste-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(out)], { type: 'application/json' }));
}
async function importBackup(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'voix-juste') throw new Error('Ce fichier n’est pas une sauvegarde Voix Juste.');
    for (const s of data.scores || []) await db.put('scores', s);
    for (const t of data.takes || []) {
      t.frames = { t: Float32Array.from(t.frames.t), b: Float32Array.from(t.frames.b), m: Float32Array.from(t.frames.m, (v) => (v === null ? NaN : v)), k: Int16Array.from(t.frames.k) };
      t.audio = t.audio ? await b64ToBlob(t.audio) : null;
      await db.put('takes', t);
    }
    if (data.profile) { S.profile = { ...DEFAULT_PROFILE, ...data.profile }; await db.kvSet('profile', S.profile); }
    if (data.settings) { S.settings = { ...DEFAULT_SETTINGS, ...data.settings }; await db.kvSet('settings', S.settings); applySettings(); }
    if (data.prefs) { S.prefs = { ...S.prefs, ...data.prefs }; await db.kvSet('prefs', S.prefs); }
    await loadScores(); renderProfile();
    $('bk-info').textContent = `Importé : ${(data.scores || []).length} partitions, ${(data.takes || []).length} prises.`;
  } catch (err) { toast(err.message || String(err), 6000); }
}

boot().catch((e) => { console.error(e); toast('Erreur au démarrage : ' + (e.message || e), 8000); });
window.__vj = { S, engine, db }; // pour le débogage
