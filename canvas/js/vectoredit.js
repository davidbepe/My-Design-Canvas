// Edit titik vector (seperti mode edit vector di Figma).
//
// Masuk: double-click vector, Enter saat vector terpilih, atau tombol "Edit titik" di panel kanan.
// Di dalam mode ini: drag titik = pindahkan, drag handle = ubah lengkungan (Alt = handle tidak
// simetris), klik garis = tambah titik, double-click titik = sudut <-> lengkung, Delete = hapus titik,
// panah = geser titik. Keluar dengan Esc, Enter, atau klik di luar vector.
//
// Titik disimpan dalam koordinat viewBox <svg>. Setelah diedit, viewBox, ukuran, dan posisi <svg>
// disesuaikan lagi supaya kotaknya pas membungkus path.
import { state, on, emit, resolve, getArtboard, setSelection, sameRef, toast, isEditableTarget } from './state.js';
import { worldToScreen, screenToWorld } from './camera.js';
import { snapshot, pushDoc, captureDoc } from './history.js';
import { penPath } from './vector.js';
import { isFree, freePosition } from './position.js';

const SVG = 'http://www.w3.org/2000/svg';
const HIT = 7; // jarak (px layar) untuk mengenai titik, handle, atau garis

let layer;
let overlay;
let edit = null; // { ref, el, path, points: [{ x, y, hin, hout }], closed, selected }
let drag = null; // { kind: 'point' | 'handle', i, key, start, orig, before, moved }

export const isEditingVector = () => !!edit;

export function canEditVector(el) {
  return !!el && el.tagName.toLowerCase() === 'svg' && el.hasAttribute('data-vector') && !!el.querySelector(':scope > path');
}

export function initVectorEdit(overlayEl) {
  overlay = overlayEl;
  layer = document.createElementNS(SVG, 'svg');
  layer.classList.add('vector-layer');
  overlayEl.append(layer);
  addEventListener('keydown', onKey, true); // fase capture: Esc/Delete tidak ikut memicu shortcut kanvas
  on('selection', () => {
    if (edit && !(state.selected.length === 1 && sameRef(state.selection, edit.ref))) stopVectorEdit();
  });
  on('tool', () => { if (edit && state.tool !== 'select') stopVectorEdit(); });
  // Undo/redo atau Claude mengganti isi artboard: baca ulang titiknya.
  on('doc', (id) => {
    if (!edit || id !== edit.ref.artboardId) return;
    const el = resolve(edit.ref);
    const parsed = canEditVector(el) && parsePath(el.querySelector(':scope > path').getAttribute('d'));
    if (!parsed) return stopVectorEdit();
    Object.assign(edit, { el, path: el.querySelector(':scope > path'), ...parsed });
    if (edit.selected >= edit.points.length) edit.selected = -1;
    redraw();
  });
}

export function startVectorEdit(ref) {
  const el = resolve(ref);
  if (!canEditVector(el)) return false;
  const path = el.querySelector(':scope > path');
  const parsed = parsePath(path.getAttribute('d'));
  if (!parsed) {
    toast('Bentuk path ini belum bisa diedit titiknya');
    return false;
  }
  setSelection(ref);
  edit = { ref, el, path, ...parsed, selected: -1 };
  overlay.classList.add('vector-editing');
  emit('vectoredit');
  redraw();
  return true;
}

export function stopVectorEdit() {
  if (!edit) return;
  edit = null;
  drag = null;
  overlay.classList.remove('vector-editing');
  redraw();
  emit('vectoredit');
}

// ---------- Mouse (dipanggil dari selection.js) ----------

// true = klik mengenai titik/handle/garis dan ditangani di sini.
export function vectorEditDown(e, s) {
  const f = frame();
  const pts = edit.points;
  const sel = pts[edit.selected];
  const id = edit.ref.artboardId;
  if (sel) {
    for (const key of ['hin', 'hout']) {
      if (sel[key] && dist(toScreen(sel[key], f), s) <= HIT) {
        drag = { kind: 'handle', i: edit.selected, key, before: snapshot(id) };
        return true;
      }
    }
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    if (dist(toScreen(pts[i], f), s) <= HIT) {
      edit.selected = i;
      drag = { kind: 'point', i, start: s, orig: clonePoint(pts[i]), before: snapshot(id) };
      redraw();
      return true;
    }
  }
  const hit = segmentAt(s, f);
  if (hit) {
    const before = snapshot(id);
    const i = splitSegment(hit.index, hit.t);
    edit.selected = i;
    apply();
    drag = { kind: 'point', i, start: s, orig: clonePoint(pts[i]), before, moved: true, label: 'Tambah titik vector' };
    return true;
  }
  return false;
}

export function vectorEditMove(s, e) {
  if (!edit || !drag) return;
  const f = frame();
  const p = edit.points[drag.i];
  if (drag.kind === 'point') {
    const dx = (s.sx - drag.start.sx) / state.view.zoom / f.sx;
    const dy = (s.sy - drag.start.sy) / state.view.zoom / f.sy;
    if (!drag.moved && Math.hypot(s.sx - drag.start.sx, s.sy - drag.start.sy) < 2) return;
    const o = drag.orig;
    p.x = o.x + dx;
    p.y = o.y + dy;
    if (o.hin) p.hin = { x: o.hin.x + dx, y: o.hin.y + dy };
    if (o.hout) p.hout = { x: o.hout.x + dx, y: o.hout.y + dy };
  } else {
    const h = fromScreen(s, f);
    p[drag.key] = h;
    // Bawaan: handle seberang ikut berputar (sudut simetris, panjangnya tetap). Alt = bebas.
    const other = drag.key === 'hin' ? 'hout' : 'hin';
    if (!e.altKey && p[other]) {
      const len = Math.hypot(p[other].x - p.x, p[other].y - p.y);
      const ang = Math.atan2(p.y - h.y, p.x - h.x);
      p[other] = { x: p.x + Math.cos(ang) * len, y: p.y + Math.sin(ang) * len };
    }
  }
  drag.moved = true;
  apply();
}

export function vectorEditUp() {
  const d = drag;
  drag = null;
  if (!edit || !d?.moved) return;
  finishChange(d.label ?? (d.kind === 'handle' ? 'Ubah lengkungan' : 'Pindah titik vector'), d.before);
}

// Double-click titik: sudut <-> lengkung.
export function vectorEditDoubleClick(s) {
  const f = frame();
  const i = edit.points.findIndex((p) => dist(toScreen(p, f), s) <= HIT);
  if (i < 0) return;
  const before = snapshot(edit.ref.artboardId);
  const p = edit.points[i];
  if (p.hin || p.hout) {
    p.hin = null;
    p.hout = null;
  } else {
    smoothPoint(i);
  }
  edit.selected = i;
  apply();
  finishChange(p.hin ? 'Titik jadi lengkung' : 'Titik jadi sudut', before);
}

// ---------- Keyboard ----------

function onKey(e) {
  if (!edit || isEditableTarget(e.target) || e.ctrlKey || e.metaKey) return;
  const pts = edit.points;
  const sel = pts[edit.selected];
  if (e.key === 'Escape' || e.key === 'Enter') {
    stopVectorEdit();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (!sel) return stop(e); // jangan sampai seluruh vector ikut terhapus
    if (pts.length <= 2) {
      toast('Vector minimal punya 2 titik');
      return stop(e);
    }
    const before = snapshot(edit.ref.artboardId);
    pts.splice(edit.selected, 1);
    edit.selected = -1;
    apply();
    finishChange('Hapus titik vector', before);
  } else if (e.key.startsWith('Arrow') && sel) {
    const f = frame();
    const step = e.shiftKey ? 10 : 1;
    const dx = (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / f.sx;
    const dy = (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) / f.sy;
    captureDoc(edit.ref.artboardId, 'Geser titik vector'); // tekan berulang digabung jadi satu undo
    for (const q of [sel, sel.hin, sel.hout].filter(Boolean)) { q.x += dx; q.y += dy; }
    apply();
    fitBox();
    emit('structure', edit.ref.artboardId);
  } else {
    return;
  }
  stop(e);
}

function stop(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
}

// ---------- Mengubah path ----------

function apply() {
  edit.path.setAttribute('d', penPath(edit.points, edit.closed));
  emit('edit', edit.ref.artboardId);
}

function finishChange(label, before) {
  fitBox();
  const id = edit.ref.artboardId;
  pushDoc(id, label, before, snapshot(id), [edit.ref], [edit.ref]);
  emit('edit', id);
  emit('structure', id); // ukuran & X/Y di panel kanan ikut diperbarui
}

// Sesuaikan viewBox, ukuran, dan posisi <svg> supaya pas membungkus path yang baru.
function fitBox() {
  const { el, points } = edit;
  const f = frame();
  const all = points.flatMap((p) => [p, p.hin, p.hout].filter(Boolean));
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const w = Math.max(1, Math.max(...all.map((p) => p.x)) - minX);
  const h = Math.max(1, Math.max(...all.map((p) => p.y)) - minY);
  for (const p of all) { p.x = round(p.x - minX); p.y = round(p.y - minY); }
  el.setAttribute('viewBox', `0 0 ${round(w)} ${round(h)}`);
  el.style.width = `${round(w * f.sx)}px`;
  el.style.height = `${round(h * f.sy)}px`;
  if (isFree(el)) {
    const pos = freePosition(el);
    el.style.left = `${round(pos.left + (minX - f.vx) * f.sx)}px`;
    el.style.top = `${round(pos.top + (minY - f.vy) * f.sy)}px`;
  }
  edit.path.setAttribute('d', penPath(points, edit.closed));
}

// Jadikan titik lengkung: handle searah garis dari titik sebelum ke titik sesudahnya.
function smoothPoint(i) {
  const pts = edit.points;
  const n = pts.length;
  const p = pts[i];
  const prev = pts[i - 1] ?? (edit.closed ? pts[n - 1] : null);
  const next = pts[i + 1] ?? (edit.closed ? pts[0] : null);
  const a = prev ?? p;
  const b = next ?? p;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!len) return;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  if (prev) {
    const l = Math.hypot(p.x - prev.x, p.y - prev.y) / 3;
    p.hin = { x: p.x - ux * l, y: p.y - uy * l };
  }
  if (next) {
    const l = Math.hypot(next.x - p.x, next.y - p.y) / 3;
    p.hout = { x: p.x + ux * l, y: p.y + uy * l };
  }
}

// Segmen ke-i: dari titik i ke titik i+1 (atau kembali ke titik pertama kalau bentuknya tertutup).
function segments() {
  const pts = edit.points;
  const list = [];
  for (let i = 0; i < pts.length - 1; i++) list.push([i, i + 1]);
  if (edit.closed && pts.length > 2) list.push([pts.length - 1, 0]);
  return list;
}

function bezier(a, b) {
  return [a, a.hout ?? a, b.hin ?? b, b];
}

function pointAt([p0, p1, p2, p3], t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function segmentAt(s, f) {
  let best = null;
  for (const [index, [ia, ib]] of segments().entries()) {
    const curve = bezier(edit.points[ia], edit.points[ib]);
    for (let k = 1; k < 60; k++) {
      const t = k / 60;
      const d = dist(toScreen(pointAt(curve, t), f), s);
      if (d <= HIT && (!best || d < best.d)) best = { index, t, d };
    }
  }
  return best;
}

// Belah segmen di t (algoritma de Casteljau): bentuk kurva tidak berubah, hanya bertambah satu titik.
function splitSegment(index, t) {
  const pts = edit.points;
  const [ia, ib] = segments()[index];
  const a = pts[ia];
  const b = pts[ib];
  const lerp = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const point = { hin: null, hout: null };
  if (!a.hout && !b.hin) {
    Object.assign(point, lerp(a, b)); // garis lurus
  } else {
    const [p0, p1, p2, p3] = bezier(a, b);
    const p01 = lerp(p0, p1);
    const p12 = lerp(p1, p2);
    const p23 = lerp(p2, p3);
    const p012 = lerp(p01, p12);
    const p123 = lerp(p12, p23);
    Object.assign(point, lerp(p012, p123));
    a.hout = p01;
    point.hin = p012;
    point.hout = p123;
    b.hin = p23;
  }
  const at = ib === 0 ? pts.length : ib;
  pts.splice(at, 0, point);
  return at;
}

// ---------- Membaca atribut d ----------

// Mendukung M, L, H, V, C, Z (huruf besar & kecil) dengan satu sub-path, yaitu semua yang dibuat
// Pen/Pencil di editor ini. Path lain (busur, kurva kuadrat, banyak sub-path) mengembalikan null.
export function parsePath(d) {
  const tokens = (d ?? '').match(/[a-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pts = [];
  let closed = false;
  let cur = { x: 0, y: 0 };
  let cmd = null;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) return null;
    if (closed) return null; // ada sub-path kedua setelah Z
    const rel = cmd === cmd.toLowerCase();
    const at = (x, y) => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    const C = cmd.toUpperCase();
    if (C === 'M') {
      if (pts.length) return null;
      cur = at(num(), num());
      pts.push({ ...cur, hin: null, hout: null });
      cmd = rel ? 'l' : 'L'; // pasangan angka berikutnya setelah M = garis
    } else if (C === 'L') {
      cur = at(num(), num());
      pts.push({ ...cur, hin: null, hout: null });
    } else if (C === 'H') {
      const x = num();
      cur = { x: rel ? cur.x + x : x, y: cur.y };
      pts.push({ ...cur, hin: null, hout: null });
    } else if (C === 'V') {
      const y = num();
      cur = { x: cur.x, y: rel ? cur.y + y : y };
      pts.push({ ...cur, hin: null, hout: null });
    } else if (C === 'C') {
      if (!pts.length) return null;
      const c1 = at(num(), num());
      const c2 = at(num(), num());
      cur = at(num(), num());
      pts.at(-1).hout = c1;
      pts.push({ ...cur, hin: c2, hout: null });
    } else if (C === 'Z') {
      closed = true;
    } else {
      return null;
    }
  }
  const all = pts.flatMap((p) => [p, p.hin, p.hout].filter(Boolean));
  if (pts.length < 2 || all.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  // Bentuk tertutup biasanya kembali ke titik awal sebelum Z: gabungkan titik kembar itu.
  if (closed && pts.length > 2 && near(pts.at(-1), pts[0])) pts[0].hin = pts.pop().hin;
  // Handle yang menempel di titiknya sendiri = tidak ada handle.
  for (const p of pts) {
    if (p.hin && near(p.hin, p)) p.hin = null;
    if (p.hout && near(p.hout, p)) p.hout = null;
  }
  return { points: pts, closed };
}

// ---------- Koordinat ----------

// Hubungan koordinat viewBox <svg> dengan koordinat kanvas (world).
function frame() {
  const a = getArtboard(edit.ref.artboardId);
  const r = edit.el.getBoundingClientRect();
  const vb = edit.el.viewBox.baseVal;
  const vw = vb?.width || r.width || 1;
  const vh = vb?.height || r.height || 1;
  return {
    ox: (a?.x ?? 0) + r.left, oy: (a?.y ?? 0) + r.top,
    sx: (r.width || 1) / vw, sy: (r.height || 1) / vh,
    vx: vb?.x || 0, vy: vb?.y || 0,
  };
}

function toScreen(p, f) {
  const s = worldToScreen(f.ox + (p.x - f.vx) * f.sx, f.oy + (p.y - f.vy) * f.sy);
  return { sx: s.x, sy: s.y };
}

function fromScreen(s, f) {
  const w = screenToWorld(s.sx, s.sy);
  return { x: (w.x - f.ox) / f.sx + f.vx, y: (w.y - f.oy) / f.sy + f.vy };
}

// ---------- Tampilan titik & handle ----------

function redraw() {
  layer.replaceChildren();
  if (!edit) return;
  const f = frame();
  const scr = (p) => p && toScreen(p, f);
  const xy = (s) => ({ x: s.sx, y: s.sy });
  const sp = edit.points.map((p) => ({ ...xy(scr(p)), hin: p.hin && xy(scr(p.hin)), hout: p.hout && xy(scr(p.hout)) }));
  const outline = document.createElementNS(SVG, 'path');
  outline.setAttribute('d', penPath(sp, edit.closed));
  outline.setAttribute('class', 'vector-edit-path');
  layer.append(outline);
  const sel = sp[edit.selected];
  if (sel) {
    for (const h of [sel.hin, sel.hout].filter(Boolean)) {
      layer.append(svgEl('line', { x1: sel.x, y1: sel.y, x2: h.x, y2: h.y, class: 'vector-handle' }));
      layer.append(svgEl('circle', { cx: h.x, cy: h.y, r: 3.5, class: 'vector-handle-end' }));
    }
  }
  for (const [i, p] of sp.entries()) {
    layer.append(svgEl('circle', { cx: p.x, cy: p.y, r: 4, class: `vector-point${i === edit.selected ? ' on' : ''}` }));
  }
}

export function redrawVectorEdit() {
  if (edit) redraw();
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const clonePoint = (p) => ({ x: p.x, y: p.y, hin: p.hin && { ...p.hin }, hout: p.hout && { ...p.hout } });
const dist = (a, b) => Math.hypot(a.sx - b.sx, a.sy - b.sy);
const near = (a, b) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
const round = (n) => Math.round(n * 100) / 100;
