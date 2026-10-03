// Garis bantu merah ala Figma:
// 1. Smart guides + snap saat menggeser, resize, atau menggambar artboard (tepi & tengah sejajar).
// 2. Pengukur jarak: pilih elemen, tahan Alt, arahkan mouse ke elemen lain (atau ke induknya).
import { state, sameRef, isEditableTarget, emit } from './state.js';
import { worldToScreen } from './camera.js';

const SNAP_PX = 6; // jarak "menempel", dalam piksel layar

let layer;
let guides = []; // garis sejajar (koordinat world): { axis: 'x'|'y', at, from, to }
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

// ---------- Smart guides & snap ----------

const xsOf = (r) => ({ l: r.x, c: r.x + r.w / 2, r: r.x + r.w });
const ysOf = (r) => ({ t: r.y, m: r.y + r.h / 2, b: r.y + r.h });
const otherBoxes = (excludeIds) => state.artboards
  .filter((a) => !excludeIds.has(a.id))
  .map((a) => ({ x: a.x, y: a.y, w: a.width, h: a.height }));

// Cari geseran terkecil supaya salah satu tepi `rect` pas dengan tepi/tengah artboard lain.
// xEdges/yEdges: tepi mana yang boleh menempel (saat resize, hanya tepi yang sedang ditarik).
export function snapRect(rect, excludeIds, { xEdges = ['l', 'c', 'r'], yEdges = ['t', 'm', 'b'] } = {}) {
  const t = SNAP_PX / state.view.zoom;
  const mx = xsOf(rect);
  const my = ysOf(rect);
  let dx = null;
  let dy = null;
  for (const o of otherBoxes(excludeIds)) {
    for (const v of Object.values(xsOf(o))) {
      for (const e of xEdges) {
        const d = v - mx[e];
        if (Math.abs(d) <= t && (dx === null || Math.abs(d) < Math.abs(dx))) dx = d;
      }
    }
    for (const v of Object.values(ysOf(o))) {
      for (const e of yEdges) {
        const d = v - my[e];
        if (Math.abs(d) <= t && (dy === null || Math.abs(d) < Math.abs(dy))) dy = d;
      }
    }
  }
  return { dx: dx ?? 0, dy: dy ?? 0 };
}

// Garis merah untuk setiap tepi/tengah `rect` yang sejajar dengan artboard lain.
export function showGuidesFor(rect, excludeIds) {
  guides = [];
  const mx = xsOf(rect);
  const my = ysOf(rect);
  for (const o of otherBoxes(excludeIds)) {
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
}

export function clearGuides() {
  guides = [];
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
    // Jarak ke keempat tepi dalam induk
    gap(B.x, A.x, A.cy, 'h');
    gap(A.r, B.r, A.cy, 'h');
    gap(B.y, A.y, A.cx, 'v');
    gap(A.b, B.b, A.cx, 'v');
    return true;
  }
  // Dua objek terpisah: jarak horizontal dan/atau vertikal di antara keduanya
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

// Garis jarak + label angka (dalam px desain).
function gap(from, to, at, dir) {
  const d = to - from;
  if (d < 0.5) return;
  if (dir === 'h') line(from, at, to, at); else line(at, from, at, to);
  const mid = (from + to) / 2;
  label(dir === 'h' ? mid : at, dir === 'h' ? at : mid, Math.round(d * 10) / 10);
}

// Garis putus-putus dari ujung garis jarak ke objek, kalau keduanya tidak sejajar.
function connector(B, x, y) {
  if (y < B.y) line(x, y, x, B.y, true);
  else if (y > B.b) line(x, B.b, x, y, true);
  if (x < B.x) line(x, y, B.x, y, true);
  else if (x > B.r) line(B.r, y, x, y, true);
}

function line(x1, y1, x2, y2, dashed = false) {
  const p1 = worldToScreen(x1, y1);
  const p2 = worldToScreen(x2, y2);
  const el = document.createElement('div');
  const vertical = Math.abs(p1.x - p2.x) < 0.5;
  el.className = `guide-line ${vertical ? 'v' : 'h'}${dashed ? ' dashed' : ''}`;
  if (vertical) {
    Object.assign(el.style, { left: `${p1.x}px`, top: `${Math.min(p1.y, p2.y)}px`, width: '1px', height: `${Math.abs(p2.y - p1.y)}px` });
  } else {
    Object.assign(el.style, { left: `${Math.min(p1.x, p2.x)}px`, top: `${p1.y}px`, width: `${Math.abs(p2.x - p1.x)}px`, height: '1px' });
  }
  layer.append(el);
}

function label(x, y, value) {
  const p = worldToScreen(x, y);
  const el = document.createElement('div');
  el.className = 'guide-label';
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
