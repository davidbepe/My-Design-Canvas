// Garis bantu ala Figma:
// 1. Smart guides + snap: tepi & tengah sejajar (garis merah).
// 2. Jarak sama (garis pink + angka): objek tepat di tengah dua tetangga, atau jaraknya sama dengan
//    jarak antar-objek lain di baris/kolom yang sama. Objek juga menempel ke jarak itu.
// 3. Pengukur jarak: pilih elemen, tahan Alt, arahkan mouse ke elemen lain (atau ke induknya).
//
// Semua kotak memakai koordinat world: { x, y, w, h }.
import { state, sameRef, isEditableTarget, emit } from './state.js';
import { worldToScreen } from './camera.js';

const SNAP_PX = 6; // jarak "menempel", dalam piksel layar

let layer;
let guides = []; // garis sejajar: { axis: 'x'|'y', at, from, to }
let spacing = []; // jarak sama: { dir: 'h'|'v', from, to, at, value }
let measuring = false;

export function initGuides(overlayEl) {
  layer = document.createElement('div');
  layer.className = 'guides';
  overlayEl.append(layer);

  addEventListener('keydown', (e) => {
    if (e.key !== 'Alt' || isEditableTarget(e.target)) return;
    e.preventDefault();
    if (!measuring) { measuring = true; emit('layout'); }
  });
  addEventListener('keyup', (e) => {
    if (e.key !== 'Alt') return;
    e.preventDefault(); // jangan sampai Alt memindahkan fokus ke menu browser
    measuring = false;
    emit('layout');
  });
  addEventListener('blur', () => {
    if (measuring) { measuring = false; emit('layout'); }
  });
}

export const isMeasuring = () => measuring;

export function artboardBoxes(excludeIds = new Set()) {
  return state.artboards
    .filter((a) => !excludeIds.has(a.id))
    .map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height }));
}

const xsOf = (r) => ({ l: r.x, c: r.x + r.w / 2, r: r.x + r.w });
const ysOf = (r) => ({ t: r.y, m: r.y + r.h / 2, b: r.y + r.h });
const tolerance = () => SNAP_PX / state.view.zoom;
const closest = (values) => values.filter((v) => v !== null && Math.abs(v) <= tolerance())
  .reduce((best, v) => (best === null || Math.abs(v) < Math.abs(best) ? v : best), null);

// ---------- Snap tepi & tengah ----------

// Geseran terkecil supaya salah satu tepi `rect` pas dengan tepi/tengah kotak lain.
// xEdges/yEdges: tepi mana yang boleh menempel (saat resize, hanya tepi yang sedang ditarik).
// Mengembalikan null per sumbu kalau tidak ada yang cukup dekat.
export function snapRect(rect, boxes, { xEdges = ['l', 'c', 'r'], yEdges = ['t', 'm', 'b'] } = {}) {
  const mx = xsOf(rect);
  const my = ysOf(rect);
  const dxs = [];
  const dys = [];
  for (const o of boxes) {
    for (const v of Object.values(xsOf(o))) for (const e of xEdges) dxs.push(v - mx[e]);
    for (const v of Object.values(ysOf(o))) for (const e of yEdges) dys.push(v - my[e]);
  }
  return { dx: closest(dxs), dy: closest(dys) };
}

// ---------- Jarak sama ----------

// Kotak lain yang sebaris (horizontal) / sekolom (vertikal) dengan rect, diurutkan.
function lineOf(rect, boxes, dir) {
  if (dir === 'h') {
    return boxes.filter((b) => b.y < rect.y + rect.h && b.y + b.h > rect.y).sort((a, b) => a.x - b.x);
  }
  return boxes.filter((b) => b.x < rect.x + rect.w && b.x + b.w > rect.x).sort((a, b) => a.y - b.y);
}

// Untuk satu arah: tetangga sebelum/sesudah rect, dan jarak antar-kotak lain yang sudah ada.
function spacingContext(rect, boxes, dir, slack) {
  const pos = dir === 'h' ? 'x' : 'y';
  const size = dir === 'h' ? 'w' : 'h';
  const start = rect[pos];
  const end = rect[pos] + rect[size];
  const line = lineOf(rect, boxes, dir);
  const before = line.filter((b) => b[pos] + b[size] <= start + slack).sort((a, b) => (b[pos] + b[size]) - (a[pos] + a[size]))[0];
  const after = line.filter((b) => b[pos] >= end - slack).sort((a, b) => a[pos] - b[pos])[0];
  const gaps = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const g = line[i + 1][pos] - (line[i][pos] + line[i][size]);
    if (g > 0) gaps.push({ a: line[i], b: line[i + 1], g });
  }
  return {
    before, after, gaps,
    gBefore: before ? start - (before[pos] + before[size]) : null,
    gAfter: after ? after[pos] - end : null,
  };
}

// Geseran supaya jarak rect ke tetangga sama dengan jarak lain (di tengah, atau sama dengan pasangan lain).
export function spacingSnap(rect, boxes) {
  const out = {};
  for (const dir of ['h', 'v']) {
    const { gBefore, gAfter, gaps } = spacingContext(rect, boxes, dir, tolerance());
    const candidates = [];
    if (gBefore !== null && gAfter !== null) candidates.push((gAfter - gBefore) / 2);
    for (const { g } of gaps) {
      if (gBefore !== null) candidates.push(g - gBefore);
      if (gAfter !== null) candidates.push(gAfter - g);
    }
    out[dir === 'h' ? 'dx' : 'dy'] = closest(candidates);
  }
  return out;
}

// Gabungan snap untuk menggeser: tepi/tengah sejajar atau jarak sama, mana yang lebih dekat.
export function snapMove(rect, boxes) {
  const a = snapRect(rect, boxes);
  const s = spacingSnap(rect, boxes);
  const pick = (p, q) => (p === null ? q : q === null ? p : Math.abs(p) <= Math.abs(q) ? p : q);
  return { dx: pick(a.dx, s.dx) ?? 0, dy: pick(a.dy, s.dy) ?? 0 };
}

// Tampilkan garis merah (sejajar) dan pink (jarak sama) untuk posisi akhir rect.
export function showGuidesFor(rect, boxes, { withSpacing = true } = {}) {
  guides = [];
  spacing = [];
  const mx = xsOf(rect);
  const my = ysOf(rect);
  for (const o of boxes) {
    for (const v of Object.values(xsOf(o))) {
      if (Object.values(mx).some((m) => Math.abs(m - v) < 1)) {
        guides.push({ axis: 'x', at: v, from: Math.min(rect.y, o.y), to: Math.max(rect.y + rect.h, o.y + o.h) });
      }
    }
    for (const v of Object.values(ysOf(o))) {
      if (Object.values(my).some((m) => Math.abs(m - v) < 1)) {
        guides.push({ axis: 'y', at: v, from: Math.min(rect.x, o.x), to: Math.max(rect.x + rect.w, o.x + o.w) });
      }
    }
  }
  if (withSpacing) addSpacingMarks(rect, boxes);
}

function addSpacingMarks(rect, boxes) {
  for (const dir of ['h', 'v']) {
    const { before, after, gBefore, gAfter, gaps } = spacingContext(rect, boxes, dir, 0.5);
    const marks = new Set();
    const same = (p, q) => p !== null && q !== null && p > 0 && Math.abs(p - q) < 1;
    if (same(gBefore, gAfter)) { marks.add([before, rect]); marks.add([rect, after]); }
    for (const { a, b, g } of gaps) {
      if (same(gBefore, g)) { marks.add([before, rect]); marks.add([a, b]); }
      if (same(gAfter, g)) { marks.add([rect, after]); marks.add([a, b]); }
    }
    for (const [p, q] of marks) spacing.push(spacingMark(p, q, dir));
  }
}

// Garis jarak di antara dua kotak, di tengah bagian yang saling bertumpuk.
function spacingMark(p, q, dir) {
  if (dir === 'h') {
    const top = Math.max(p.y, q.y);
    const bottom = Math.min(p.y + p.h, q.y + q.h);
    return { dir, from: p.x + p.w, to: q.x, at: (top + bottom) / 2, value: q.x - (p.x + p.w) };
  }
  const left = Math.max(p.x, q.x);
  const right = Math.min(p.x + p.w, q.x + q.w);
  return { dir, from: p.y + p.h, to: q.y, at: (left + right) / 2, value: q.y - (p.y + p.h) };
}

export function clearGuides() {
  guides = [];
  spacing = [];
}

// ---------- Gambar ----------

// rectOf: fungsi ref → kotak world (dari selection.js). Mengembalikan true kalau sedang mengukur
// (supaya kotak hover biru disembunyikan dan diganti kotak merah).
export function drawGuides(rectOf) {
  layer.replaceChildren();
  for (const g of guides) {
    if (g.axis === 'x') line(g.at, g.from, g.at, g.to);
    else line(g.from, g.at, g.to, g.at);
  }
  for (const s of spacing) {
    if (s.dir === 'h') line(s.from, s.at, s.to, s.at, 'spacing');
    else line(s.at, s.from, s.at, s.to, 'spacing');
    label(s.dir === 'h' ? (s.from + s.to) / 2 : s.at, s.dir === 'h' ? s.at : (s.from + s.to) / 2, Math.round(s.value * 10) / 10, 'spacing');
  }
  return drawMeasure(rectOf);
}

function drawMeasure(rectOf) {
  const sel = state.selection;
  if (!measuring || !sel) return false;
  // Ukur ke elemen yang ditunjuk mouse; kalau tidak ada, ke induk elemen terpilih.
  const target = state.hover && !sameRef(state.hover, sel)
    ? state.hover
    : sel.path.length ? { artboardId: sel.artboardId, path: sel.path.slice(0, -1) } : null;
  const a = rectOf(sel);
  const b = target && rectOf(target);
  if (!a || !b) return false;
  box(b);

  const R = (r) => ({ ...r, r: r.x + r.w, b: r.y + r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2 });
  let A = R(a);
  let B = R(b);
  const contains = (o, i) => o.x <= i.x + 0.5 && o.y <= i.y + 0.5 && o.r >= i.r - 0.5 && o.b >= i.b - 0.5;
  if (contains(A, B)) [A, B] = [B, A]; // terpilih = induk, ditunjuk = anak: ukur anak ke tepi induk

  if (contains(B, A)) {
    gap(B.x, A.x, A.cy, 'h');
    gap(A.r, B.r, A.cy, 'h');
    gap(B.y, A.y, A.cx, 'v');
    gap(A.b, B.b, A.cx, 'v');
    return true;
  }
  const overlapY = [Math.max(A.y, B.y), Math.min(A.b, B.b)];
  const overlapX = [Math.max(A.x, B.x), Math.min(A.r, B.r)];
  const y = overlapY[0] < overlapY[1] ? (overlapY[0] + overlapY[1]) / 2 : A.cy;
  const x = overlapX[0] < overlapX[1] ? (overlapX[0] + overlapX[1]) / 2 : A.cx;
  if (A.r <= B.x) { gap(A.r, B.x, y, 'h'); connector(B, B.x, y); }
  else if (B.r <= A.x) { gap(B.r, A.x, y, 'h'); connector(B, B.r, y); }
  if (A.b <= B.y) { gap(A.b, B.y, x, 'v'); connector(B, x, B.y); }
  else if (B.b <= A.y) { gap(B.b, A.y, x, 'v'); connector(B, x, B.b); }
  return true;
}

function gap(from, to, at, dir) {
  const d = to - from;
  if (d < 0.5) return;
  if (dir === 'h') line(from, at, to, at); else line(at, from, at, to);
  const mid = (from + to) / 2;
  label(dir === 'h' ? mid : at, dir === 'h' ? at : mid, Math.round(d * 10) / 10);
}

function connector(B, x, y) {
  if (y < B.y) line(x, y, x, B.y, 'dashed');
  else if (y > B.b) line(x, B.b, x, y, 'dashed');
  if (x < B.x) line(x, y, B.x, y, 'dashed');
  else if (x > B.r) line(B.r, y, x, y, 'dashed');
}

function line(x1, y1, x2, y2, variant = '') {
  const p1 = worldToScreen(x1, y1);
  const p2 = worldToScreen(x2, y2);
  const el = document.createElement('div');
  const vertical = Math.abs(p1.x - p2.x) < 0.5;
  el.className = `guide-line ${vertical ? 'v' : 'h'} ${variant}`;
  if (vertical) {
    Object.assign(el.style, { left: `${p1.x}px`, top: `${Math.min(p1.y, p2.y)}px`, width: '1px', height: `${Math.abs(p2.y - p1.y)}px` });
  } else {
    Object.assign(el.style, { left: `${Math.min(p1.x, p2.x)}px`, top: `${p1.y}px`, width: `${Math.abs(p2.x - p1.x)}px`, height: '1px' });
  }
  layer.append(el);
}

function label(x, y, value, variant = '') {
  const p = worldToScreen(x, y);
  const el = document.createElement('div');
  el.className = `guide-label ${variant}`;
  el.textContent = value;
  Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px` });
  layer.append(el);
}

function box(r) {
  const p = worldToScreen(r.x, r.y);
  const el = document.createElement('div');
  el.className = 'guide-box';
  Object.assign(el.style, {
    left: `${p.x}px`, top: `${p.y}px`, width: `${r.w * state.view.zoom}px`, height: `${r.h * state.view.zoom}px`,
  });
  layer.append(el);
}
