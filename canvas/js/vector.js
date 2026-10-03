// Vector: Pen (P) dan Pencil (Shift+P).
//
// Pen: klik = titik sudut, klik+drag = titik lengkung. Selesai dengan klik titik pertama (bentuk
// tertutup), Enter, Esc, atau double-click. Pencil: tahan dan gambar bebas; garisnya dihaluskan.
// Hasilnya <svg> berisi <path>, diletakkan BEBAS (position: absolute) persis di tempat digambar.
import { state, setTool, setSelection, emit, pathOf, toast } from './state.js';
import { worldToScreen } from './camera.js';
import { recordDoc } from './history.js';
import { artboardAt, containerAt } from './draw.js';

const SVG = 'http://www.w3.org/2000/svg';
const CLOSE_PX = 8; // jarak (layar) untuk "klik titik pertama" yang menutup bentuk

let layer; // <svg> overlay untuk pratinjau saat menggambar
let pen = null; // { tool, points: [{ x, y, hin, hout }], cursor, dragging }

export function initVector(overlayEl) {
  layer = document.createElementNS(SVG, 'svg');
  layer.classList.add('vector-layer');
  overlayEl.append(layer);
  // Enter/Esc menyelesaikan path. Didaftarkan di fase capture supaya tidak ikut memicu shortcut lain.
  addEventListener('keydown', (e) => {
    if (!pen) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(false);
    }
  }, true);
}

export const isDrawingVector = () => !!pen;

export function vectorDown(p, e) {
  if (state.tool === 'pencil') {
    pen = { tool: 'pencil', points: [p] };
    return redraw();
  }
  pen ??= { tool: 'pen', points: [], cursor: p };
  const first = pen.points[0];
  if (first && pen.points.length >= 2 && screenDistance(first, p) <= CLOSE_PX) return finish(true);
  const point = { x: p.x, y: p.y, hin: null, hout: null };
  pen.points.push(point);
  pen.dragging = point;
  redraw();
}

export function vectorMove(p, e) {
  if (!pen) return;
  if (pen.tool === 'pencil') {
    if (!e.buttons) return;
    const last = pen.points.at(-1);
    if (screenDistance(last, p) >= 2) pen.points.push(p);
    return redraw();
  }
  pen.cursor = p;
  // Drag setelah klik = tarik "handle" lengkungan (simetris di kedua sisi titik).
  if (pen.dragging && e.buttons && screenDistance(pen.dragging, p) > 2) {
    const pt = pen.dragging;
    pt.hout = { x: p.x, y: p.y };
    pt.hin = { x: 2 * pt.x - p.x, y: 2 * pt.y - p.y };
  }
  redraw();
}

export function vectorUp() {
  if (!pen) return;
  if (pen.tool === 'pencil') return finish(false);
  pen.dragging = null;
}

export function vectorDoubleClick() {
  if (!pen || pen.tool !== 'pen') return;
  // Double-click juga menambah titik kembar di posisi yang sama; buang dulu.
  const pts = pen.points;
  while (pts.length >= 2 && screenDistance(pts.at(-1), pts.at(-2)) < 3) pts.pop();
  finish(false);
}

// Batalkan tanpa menyimpan (mis. ganti tool di tengah jalan).
export function cancelVector() {
  pen = null;
  redraw();
}

// ---------- Selesai: buat <svg> di artboard ----------

function finish(closed) {
  const current = pen;
  pen = null;
  redraw();
  setTool('select');
  if (!current) return;
  let points = current.points;
  if (current.tool === 'pencil') points = simplify(points, 1.2 / state.view.zoom);
  if (points.length < 2) return;

  const start = points[0];
  const artboard = artboardAt(start.x, start.y);
  if (!artboard) return toast('Gambar vector di dalam frame');
  const container = containerAt(artboard, start.x, start.y);
  if (!container) return;

  // Kotak pembatas path (termasuk handle lengkungan), dalam koordinat world.
  const all = points.flatMap((p) => [p, p.hin, p.hout].filter(Boolean));
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const w = Math.max(1, Math.max(...all.map((p) => p.x)) - minX);
  const h = Math.max(1, Math.max(...all.map((p) => p.y)) - minY);
  const local = (p) => p && { x: round(p.x - minX), y: round(p.y - minY) };
  const shifted = points.map((p) => ({ ...local(p), hin: local(p.hin), hout: local(p.hout) }));
  const d = current.tool === 'pencil' ? smoothPath(shifted) : penPath(shifted, closed);

  const doc = container.ownerDocument;
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('data-vector', current.tool);
  svg.setAttribute('aria-label', 'Vector');
  svg.setAttribute('viewBox', `0 0 ${round(w)} ${round(h)}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);

  recordDoc(artboard.id, current.tool === 'pen' ? 'Gambar dengan pen' : 'Gambar dengan pencil', () => {
    const cs = doc.defaultView.getComputedStyle(container);
    if (cs.position === 'static') container.style.position = 'relative'; // patokan posisi bebas
    // Posisi relatif ke sisi dalam wadah (koordinat iframe = koordinat artboard).
    const cr = container.getBoundingClientRect();
    const left = minX - artboard.x - cr.left - container.clientLeft + container.scrollLeft;
    const top = minY - artboard.y - cr.top - container.clientTop + container.scrollTop;
    svg.style.cssText = `position: absolute; left: ${round(left)}px; top: ${round(top)}px; width: ${round(w)}px; height: ${round(h)}px; `
      + 'overflow: visible; fill: none; stroke: #111111; stroke-width: 2px; stroke-linecap: round; stroke-linejoin: round;';
    container.append(svg);
    setSelection({ artboardId: artboard.id, path: pathOf(svg) });
  });
  emit('structure', artboard.id);
}

export function penPath(pts, closed) {
  const seg = (a, b) => (a.hout || b.hin
    ? `C ${xy(a.hout ?? a)} ${xy(b.hin ?? b)} ${xy(b)}`
    : `L ${xy(b)}`);
  let d = `M ${xy(pts[0])}`;
  for (let i = 1; i < pts.length; i++) d += ` ${seg(pts[i - 1], pts[i])}`;
  if (closed) d += ` ${seg(pts.at(-1), pts[0])} Z`;
  return d;
}

// Kurva halus melalui semua titik (Catmull-Rom → Bezier), untuk hasil pencil.
function smoothPath(pts) {
  if (pts.length < 3) return `M ${xy(pts[0])} L ${xy(pts.at(-1))}`;
  let d = `M ${xy(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${xy(c1)} ${xy(c2)} ${xy(p2)}`;
  }
  return d;
}

// Kurangi titik pencil yang terlalu rapat (Ramer–Douglas–Peucker), supaya path ringan dan halus.
function simplify(pts, epsilon) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)];
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = distanceToLine(pts[i], a, b);
    if (dist > maxDist) { maxDist = dist; index = i; }
  }
  if (maxDist <= epsilon) return [a, b];
  return [...simplify(pts.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(pts.slice(index), epsilon)];
}

function distanceToLine(p, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!len) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
}

// ---------- Pratinjau saat menggambar ----------

function redraw() {
  layer.replaceChildren();
  if (!pen || !pen.points.length) return;
  const s = (p) => p && worldToScreen(p.x, p.y);
  const screenPts = pen.points.map((p) => ({ ...s(p), hin: s(p.hin), hout: s(p.hout) }));
  let d = pen.tool === 'pencil' ? `M ${screenPts.map(xy).join(' L ')}` : penPath(screenPts, false);
  if (pen.tool === 'pen' && pen.cursor && !pen.dragging) d += ` L ${xy(s(pen.cursor))}`; // segmen bayangan ke kursor
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('class', 'vector-preview');
  layer.append(path);
  if (pen.tool !== 'pen') return;
  for (const [i, p] of screenPts.entries()) {
    for (const hnd of [p.hin, p.hout].filter(Boolean)) {
      const l = document.createElementNS(SVG, 'line');
      l.setAttribute('x1', p.x); l.setAttribute('y1', p.y); l.setAttribute('x2', hnd.x); l.setAttribute('y2', hnd.y);
      l.setAttribute('class', 'vector-handle');
      layer.append(l);
    }
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y);
    c.setAttribute('r', i === 0 && pen.points.length >= 2 ? 5 : 3.5); // titik pertama lebih besar: klik untuk menutup
    c.setAttribute('class', 'vector-point');
    layer.append(c);
  }
}

export function redrawVector() {
  if (pen) redraw();
}

function screenDistance(a, b) {
  const p = worldToScreen(a.x, a.y);
  const q = worldToScreen(b.x, b.y);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

const round = (n) => Math.round(n * 100) / 100;
const xy = (p) => `${round(p.x)} ${round(p.y)}`;
