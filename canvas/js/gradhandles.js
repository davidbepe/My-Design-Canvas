// Kontrol gradient langsung di kanvas (seperti Figma/Framer), tampil selama color picker terbuka
// dalam mode gradient:
// - Linear: garis melewati tengah elemen. Drag ujungnya = putar arah (Shift = kelipatan 15°),
//   drag titik warna di garis = geser posisinya, klik titik = pilih (diedit di color picker).
// - Radial: titik tengah (drag = pindah pusat), pegangan kanan & bawah = lebar & tinggi lingkaran,
//   titik warna di sepanjang jari-jari.
// Model gradient (kind, angle, shape, stops) milik color picker; di sini hanya diubah lalu dikabarkan.
import { state } from './state.js';
import { worldToScreen, toLocal } from './camera.js';
import { rectOf } from './selection.js';

const SVG = 'http://www.w3.org/2000/svg';
const KNOB = 18; // jarak pegangan putar dari ujung garis (px layar)

let layer;
let ctx = null; // { ref, fill: { g, sel }, onChange(), onSelect(i) }

export function initGradientHandles(overlayEl) {
  layer = document.createElementNS(SVG, 'svg');
  layer.classList.add('grad-handles');
  overlayEl.append(layer);
}

export function setGradientHandles(next) {
  ctx = next;
  redrawGradientHandles();
}

export const isGradientHandle = (target) => !!target?.closest?.('.grad-handles');

// ---------- Geometri (koordinat layar) ----------

function box() {
  const r = rectOf(ctx.ref);
  if (!r) return null;
  const p = worldToScreen(r.x, r.y);
  const z = state.view.zoom;
  return { x: p.x, y: p.y, w: r.w * z, h: r.h * z, z };
}

// Garis gradient linear CSS: lewat tengah kotak, arah dari sudut, panjang menyentuh sudut kotak.
function linearLine(b, angle) {
  const a = (angle * Math.PI) / 180;
  const d = { x: Math.sin(a), y: -Math.cos(a) };
  const len = Math.abs(b.w * Math.sin(a)) + Math.abs(b.h * Math.cos(a));
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return { c, d, len, start: { x: c.x - (d.x * len) / 2, y: c.y - (d.y * len) / 2 } };
}

// Radial: "RXpx RYpx at X% Y%" (kalau tidak ditulis: elips farthest-corner di tengah).
export function parseRadial(shape, wCss, hCss) {
  let x = 50;
  let y = 50;
  const at = shape?.match(/at\s+(-?[\d.]+)%\s+(-?[\d.]+)%/);
  if (at) { x = Number(at[1]); y = Number(at[2]); }
  const size = shape?.match(/(?:^|\s)([\d.]+)px(?:\s+([\d.]+)px)?/);
  if (size) return { x, y, rx: Number(size[1]), ry: Number(size[2] ?? size[1]) };
  // farthest-corner: elips yang menyentuh sudut terjauh dari pusat
  const dx = Math.max(x, 100 - x) / 100 * wCss;
  const dy = Math.max(y, 100 - y) / 100 * hCss;
  return { x, y, rx: dx * Math.SQRT2, ry: dy * Math.SQRT2 };
}

const radialShape = ({ x, y, rx, ry }) => `${r2(rx)}px ${r2(ry)}px at ${r2(x)}% ${r2(y)}%`;

// ---------- Gambar ----------

export function redrawGradientHandles() {
  if (!layer) return;
  layer.replaceChildren();
  const g = ctx?.fill.g;
  if (!g) return;
  const b = box();
  if (!b) return;
  if (g.kind === 'linear') {
    const L = linearLine(b, g.angle);
    const end = { x: L.start.x + L.d.x * L.len, y: L.start.y + L.d.y * L.len };
    // Pegangan putar sedikit di luar ujung garis, supaya tidak menumpuk dengan titik warna 0% / 100%.
    const knob = (p, sign) => ({ x: p.x + sign * L.d.x * KNOB, y: p.y + sign * L.d.y * KNOB });
    const k0 = knob(L.start, -1);
    const k1 = knob(end, 1);
    layer.append(svgEl('line', { x1: k0.x, y1: k0.y, x2: k1.x, y2: k1.y, class: 'gh-line dim' }));
    layer.append(svgEl('line', { x1: L.start.x, y1: L.start.y, x2: end.x, y2: end.y, class: 'gh-line' }));
    endHandle(k0, (p, e) => setAngle(L.c, p, e, true));
    endHandle(k1, (p, e) => setAngle(L.c, p, e, false));
    stopHandles((stop) => ({ x: L.start.x + L.d.x * L.len * (stop.pos / 100), y: L.start.y + L.d.y * L.len * (stop.pos / 100) }),
      (p) => clamp(((p.x - L.start.x) * L.d.x + (p.y - L.start.y) * L.d.y) / L.len * 100));
  } else {
    const R = parseRadial(g.shape, b.w / b.z, b.h / b.z);
    const c = { x: b.x + (b.w * R.x) / 100, y: b.y + (b.h * R.y) / 100 };
    const rx = R.rx * b.z;
    const ry = R.ry * b.z;
    layer.append(svgEl('ellipse', { cx: c.x, cy: c.y, rx, ry, class: 'gh-line' }));
    layer.append(svgEl('line', { x1: c.x, y1: c.y, x2: c.x + rx, y2: c.y, class: 'gh-line' }));
    layer.append(svgEl('line', { x1: c.x + rx, y1: c.y, x2: c.x + rx + KNOB, y2: c.y, class: 'gh-line dim' }));
    layer.append(svgEl('line', { x1: c.x, y1: c.y, x2: c.x, y2: c.y + ry, class: 'gh-line dim' }));
    // pusat
    endHandle(c, (p) => {
      g.shape = radialShape({ ...R, x: ((p.x - b.x) / b.w) * 100, y: ((p.y - b.y) / b.h) * 100 });
      changed();
    }, 'gh-center');
    // lebar (pegangan sedikit di luar, supaya tidak menumpuk dengan titik warna 100%) & tinggi
    endHandle({ x: c.x + rx + KNOB, y: c.y }, (p) => { g.shape = radialShape({ ...R, rx: Math.max(1, (p.x - KNOB - c.x) / b.z) }); changed(); });
    endHandle({ x: c.x, y: c.y + ry }, (p) => { g.shape = radialShape({ ...R, ry: Math.max(1, (p.y - c.y) / b.z) }); changed(); });
    stopHandles((stop) => ({ x: c.x + rx * (stop.pos / 100), y: c.y }), (p) => clamp(((p.x - c.x) / rx) * 100));
  }
}

function setAngle(center, p, e, fromStart) {
  let deg = (Math.atan2(p.x - center.x, -(p.y - center.y)) * 180) / Math.PI;
  if (fromStart) deg += 180;
  deg = ((deg % 360) + 360) % 360;
  ctx.fill.g.angle = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
  changed();
}

function stopHandles(at, posOf) {
  const { fill } = ctx;
  fill.g.stops.forEach((stop, i) => {
    const p = at(stop);
    const h = svgEl('rect', { x: p.x - 6, y: p.y - 6, width: 12, height: 12, rx: 3, class: `gh-stop${i === fill.sel ? ' on' : ''}` });
    h.style.setProperty('--sw', stop.color);
    h.setAttribute('fill', stop.color);
    dragHandle(h, (q) => { stop.pos = posOf(q); changed(); }, () => ctx.onSelect(i));
    layer.append(h);
  });
}

function endHandle(p, onMove, cls = 'gh-end') {
  const h = svgEl('circle', { cx: p.x, cy: p.y, r: cls === 'gh-center' ? 6 : 5, class: cls });
  dragHandle(h, onMove);
  layer.append(h);
}

// Drag pegangan: kirim posisi kursor (koordinat layar kanvas). onDown dipanggil saat mulai ditekan.
// Gerakan didengarkan di window (bukan di pegangannya), karena pegangan digambar ulang setiap gerakan.
function dragHandle(el, onMove, onDown) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation(); // jangan sampai kanvas memulai seleksi / drag elemen
    onDown?.();
    const move = (ev) => {
      const { sx, sy } = toLocal(ev);
      onMove({ x: sx, y: sy }, ev);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      redrawGradientHandles();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

function changed() {
  ctx.onChange();
  redrawGradientHandles();
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

const clamp = (n) => Math.round(Math.min(100, Math.max(0, n)));
const r2 = (n) => Math.round(n * 10) / 10;
