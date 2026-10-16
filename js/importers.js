// Import de partitions : MusicXML (.musicxml, .xml), MusicXML compressé (.mxl) et MIDI (.mid).
// Chaque importeur rend { title, tempo, beatsPerBar, parts: [{ name, notes, info }] }.
// Les notes sont en temps de noire. Pour une partie polyphonique on garde la note la plus haute.

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const r3 = (x) => Math.round(x * 1000) / 1000;

export async function importFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.mid') || name.endsWith('.midi')) return parseMidi(buf, file.name);
  if (name.endsWith('.mxl')) return parseMusicXML(await unzipMxl(buf), file.name);
  if (name.endsWith('.musicxml') || name.endsWith('.xml')) return parseMusicXML(new TextDecoder().decode(buf), file.name);
  throw new Error('Format non reconnu. Formats acceptés : .musicxml, .xml, .mxl, .mid');
}

const baseTitle = (f) => f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
const kids = (el, tag) => Array.from(el.children).filter((c) => c.tagName === tag);
const kid = (el, tag) => kids(el, tag)[0] || null;
const txt = (el, tag) => { const k = el && kid(el, tag); return k ? k.textContent.trim() : null; };

export function parseMusicXML(xml, filename = '') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Le fichier MusicXML est illisible.');
  const root = doc.documentElement;
  if (root.tagName === 'score-timewise') throw new Error('Format MusicXML « timewise » non pris en charge. Réexporte en MusicXML standard.');
  const title = (doc.querySelector('work > work-title')?.textContent || doc.querySelector('movement-title')?.textContent || baseTitle(filename)).trim();
  const partNames = {};
  doc.querySelectorAll('part-list > score-part').forEach((sp) => { partNames[sp.getAttribute('id')] = txt(sp, 'part-name') || sp.getAttribute('id'); });
  let tempo = null, beatsPerBar = 4;
  const parts = [];
  for (const part of kids(root, 'part')) {
    let divisions = 1, pos = 0, measureStart = 0, transpose = 0, clefOct = 0;
    let mainVoice = null;
    const notes = [];
    for (const meas of kids(part, 'measure')) {
      pos = measureStart;
      let maxPos = pos;
      for (const el of Array.from(meas.children)) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          const dv = txt(el, 'divisions'); if (dv) divisions = parseFloat(dv);
          const time = kid(el, 'time');
          if (time && txt(time, 'beats') && parts.length === 0) beatsPerBar = (parseFloat(txt(time, 'beats')) * 4) / parseFloat(txt(time, 'beat-type') || 4);
          const tr = kid(el, 'transpose');
          if (tr) transpose = parseFloat(txt(tr, 'chromatic') || 0) + 12 * parseFloat(txt(tr, 'octave-change') || 0);
          const clef = kid(el, 'clef');
          if (clef && txt(clef, 'clef-octave-change')) clefOct = parseInt(txt(clef, 'clef-octave-change'), 10);
        } else if (tag === 'direction' || tag === 'sound') {
          const s = tag === 'sound' ? el : el.querySelector('sound');
          if (s && s.getAttribute('tempo') && tempo === null) tempo = parseFloat(s.getAttribute('tempo'));
          if (tempo === null) {
            const pm = el.querySelector('metronome per-minute');
            const unit = el.querySelector('metronome beat-unit')?.textContent;
            if (pm) tempo = parseFloat(pm.textContent) * ({ half: 2, eighth: 0.5, whole: 4 }[unit] || 1);
          }
        } else if (tag === 'backup') { pos -= parseFloat(txt(el, 'duration')) / divisions; }
        else if (tag === 'forward') { pos += parseFloat(txt(el, 'duration')) / divisions; maxPos = Math.max(maxPos, pos); }
        else if (tag === 'note') {
          if (kid(el, 'grace')) continue;
          const dur = parseFloat(txt(el, 'duration') || 0) / divisions;
          const isChord = !!kid(el, 'chord');
          const voice = txt(el, 'voice') || '1';
          if (mainVoice === null && !kid(el, 'rest')) mainVoice = voice;
          const start = isChord ? pos - dur : pos;
          if (!isChord) pos += dur;
          maxPos = Math.max(maxPos, pos);
          if (voice !== (mainVoice || voice)) continue;
          const pitch = kid(el, 'pitch');
          if (!pitch) continue;
          const midi = (parseInt(txt(pitch, 'octave'), 10) + 1) * 12 + STEP[txt(pitch, 'step')] + Math.round(parseFloat(txt(pitch, 'alter') || 0)) + transpose;
          let lyric = '';
          const ly = kids(el, 'lyric').find((l) => (l.getAttribute('number') || '1') === '1') || kid(el, 'lyric');
          if (ly) {
            lyric = Array.from(ly.querySelectorAll('text')).map((t) => t.textContent).join('');
            const syl = txt(ly, 'syllabic');
            if (syl === 'begin' || syl === 'middle') lyric += '-';
          }
          const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
          const last = notes[notes.length - 1];
          if (isChord) {
            if (last && Math.abs(last.b - start) < 1e-6 && midi > last.m) { last.m = midi; }
            continue;
          }
          if (ties.includes('stop') && last && last.m === midi && Math.abs(last.b + last.d - start) < 1e-3) { last.d = r3(last.d + dur); continue; }
          notes.push({ m: midi, b: r3(start), d: r3(dur), l: lyric });
        }
      }
      measureStart = maxPos;
    }
    const info = clefOct ? `clé avec octave ${clefOct > 0 ? '+' : ''}${clefOct}` : '';
    parts.push({ name: partNames[part.getAttribute('id')] || `Partie ${parts.length + 1}`, notes: dedupe(notes), info, clefOct });
  }
  return { title, tempo: tempo || 80, beatsPerBar, parts: parts.filter((p) => p.notes.length) };
}

function dedupe(notes) { // évite les chevauchements : la note suivante coupe la précédente
  notes.sort((a, b) => a.b - b.b || b.m - a.m);
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.b - n.b) < 1e-6) { if (n.m > last.m) Object.assign(last, n); continue; }
    if (last && last.b + last.d > n.b) last.d = r3(n.b - last.b);
    out.push({ ...n });
  }
  return out;
}

// --- MXL : archive zip contenant le MusicXML ---
async function unzipMxl(buf) {
  const files = readZip(buf);
  let path = null;
  if (files['META-INF/container.xml']) {
    const c = new TextDecoder().decode(await inflate(files['META-INF/container.xml']));
    const m = c.match(/full-path="([^"]+)"/);
    if (m) path = m[1];
  }
  if (!path) path = Object.keys(files).find((p) => !p.startsWith('META-INF') && /\.(xml|musicxml)$/i.test(p));
  if (!path || !files[path]) throw new Error("Impossible de trouver la partition dans le fichier .mxl.");
  return new TextDecoder().decode(await inflate(files[path]));
}
function readZip(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Archive .mxl invalide.');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nl));
    const lnl = v.getUint16(lho + 26, true), lel = v.getUint16(lho + 28, true);
    out[name] = { method, data: new Uint8Array(buf, lho + 30 + lnl + lel, csize) };
    p += 46 + nl + el + cl;
  }
  return out;
}
async function inflate(f) {
  if (f.method === 0) return f.data;
  if (typeof DecompressionStream === 'undefined') throw new Error('Ce navigateur ne sait pas décompresser les .mxl. Exporte en .musicxml non compressé.');
  const s = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

// --- MIDI ---
export function parseMidi(buf, filename = '') {
  const d = new Uint8Array(buf);
  let p = 0;
  const u32 = () => (d[p++] << 24) | (d[p++] << 16) | (d[p++] << 8) | d[p++];
  const u16 = () => (d[p++] << 8) | d[p++];
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d[p++]); return s; };
  const vlq = () => { let v = 0, b; do { b = d[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (str(4) !== 'MThd') throw new Error('Fichier MIDI invalide.');
  const hlen = u32(); u16(); const ntracks = u16(); const division = u16(); p += hlen - 6;
  if (division & 0x8000) throw new Error('Fichier MIDI en temps SMPTE non pris en charge.');
  let tempo = null, beatsPerBar = 4, title = '';
  const tracks = [];
  for (let t = 0; t < ntracks && p < d.length; t++) {
    if (str(4) !== 'MTrk') break;
    const len = u32(), end = p + len;
    let tick = 0, status = 0, name = '';
    const on = {}, notes = [], lyrics = [];
    while (p < end) {
      tick += vlq();
      let b = d[p];
      if (b & 0x80) { status = b; p++; } else b = status;
      const type = status & 0xf0;
      if (status === 0xff) {
        const mt = d[p++], ml = vlq(), ms = p;
        if (mt === 0x51 && tempo === null) tempo = 60000000 / ((d[ms] << 16) | (d[ms + 1] << 8) | d[ms + 2]);
        if (mt === 0x58) beatsPerBar = (d[ms] * 4) / 2 ** d[ms + 1];
        if (mt === 0x03) { name = new TextDecoder().decode(d.subarray(ms, ms + ml)); if (t === 0 && !title) title = name; }
        if (mt === 0x05) lyrics.push({ tick, text: new TextDecoder('latin1').decode(d.subarray(ms, ms + ml)).trim() });
        p = ms + ml;
      } else if (status === 0xf0 || status === 0xf7) { const l = vlq(); p += l; }
      else if (type === 0x90 || type === 0x80) {
        const note = d[p++], vel = d[p++];
        const key = (status & 0x0f) * 128 + note;
        if (type === 0x90 && vel > 0) { if (on[key] === undefined) on[key] = tick; }
        else if (on[key] !== undefined) { notes.push({ m: note, s: on[key], e: tick }); delete on[key]; }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    if (notes.length) {
      const q = notes.map((n) => ({ m: n.m, b: r3(n.s / division), d: r3((n.e - n.s) / division), l: '' }));
      for (const ly of lyrics) { const n = notes.findIndex((x) => x.s === ly.tick); if (n >= 0) q[n].l = ly.text; }
      const melody = dedupe(q).filter((n) => n.d > 0);
      tracks.push({ name: name || `Piste ${t + 1}`, notes: melody, info: notes.length > melody.length * 1.2 ? 'polyphonique, note la plus haute gardée' : '' });
    }
  }
  return { title: baseTitle(filename) || title, tempo: tempo ? Math.round(tempo) : 80, beatsPerBar, parts: tracks };
}
