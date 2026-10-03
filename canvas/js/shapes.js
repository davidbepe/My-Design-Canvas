// Bentuk dasar ala Figma: Rectangle, Ellipse, Segitiga, Polygon, Bintang, Garis, Panah.
//
// Rectangle & Ellipse dibuat dari <div> (Fill/Border/Radius di panel kanan langsung berlaku).
// Segitiga, polygon, bintang, garis, dan panah dibuat dari SVG, supaya garis tepinya (stroke)
// benar-benar mengikuti bentuk. Warnanya diatur lewat CSS fill/stroke pada <svg>.
const SVG = 'http://www.w3.org/2000/svg';

export const SHAPE_TOOLS = ['rect', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'arrow'];
export const SHAPE_LABELS = {
  rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Segitiga', polygon: 'Polygon', star: 'Bintang', line: 'Garis', arrow: 'Panah',
};
const DEFAULT_COUNT = { polygon: 5, star: 5 };

// Titik-titik bentuk dalam kotak 0..100 (viewBox), lalu direntangkan mengikuti ukuran elemen.
export function shapePoints(kind, count = DEFAULT_COUNT[kind]) {
  if (kind === 'triangle') return '50,0 100,100 0,100';
  const n = Math.max(3, Math.min(60, Math.round(count)));
  const pts = [];
  const steps = kind === 'star' ? n * 2 : n;
  for (let i = 0; i < steps; i++) {
    const r = kind === 'star' && i % 2 ? 19 : 50; // bintang: titik dalam ±38% dari luar
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    pts.push(`${round(50 + r * Math.cos(angle))},${round(50 + r * Math.sin(angle))}`);
  }
  return pts.join(' ');
}

// Bangun elemen bentuk. w/h = ukuran hasil drag; start/end dipakai untuk arah garis.
export function buildShape(doc, kind, w, h, dragged, start, end) {
  if (kind === 'rect' || kind === 'ellipse') {
    const el = doc.createElement('div');
    el.className = kind; // jadi nama layer
    const width = dragged ? w : 100;
    const height = dragged ? h : 100;
    el.style.cssText = `width: ${width}px; height: ${height}px; flex-shrink: 0; box-sizing: border-box; background: #d9d9d9;`
      + (kind === 'ellipse' ? ' border-radius: 50%;' : '');
    return el;
  }
  if (kind === 'line' || kind === 'arrow') return buildLine(doc, kind, w, h, dragged, start, end);

  const width = dragged ? w : 100;
  const height = dragged ? h : 100;
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('data-shape', kind);
  if (DEFAULT_COUNT[kind]) svg.setAttribute('data-count', String(DEFAULT_COUNT[kind]));
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none'); // ikut direntangkan saat ukurannya diubah
  svg.style.cssText = `display: block; width: ${width}px; height: ${height}px; flex-shrink: 0; overflow: visible; fill: #d9d9d9; stroke: none; stroke-width: 1px;`;
  const poly = doc.createElementNS(SVG, 'polygon');
  poly.setAttribute('points', shapePoints(kind));
  poly.setAttribute('vector-effect', 'non-scaling-stroke'); // tebal garis tidak ikut melar
  svg.append(poly);
  return svg;
}

function buildLine(doc, kind, w, h, dragged, start, end) {
  let W = dragged ? w : 100;
  let H = dragged ? h : 0;
  let x1; let y1; let x2; let y2;
  if (H < 4) { H = 2; x1 = 0; x2 = W; y1 = y2 = 1; } // hampir datar → garis horizontal lurus
  else if (W < 4) { W = 2; y1 = 0; y2 = H; x1 = x2 = 1; } // hampir tegak → vertikal lurus
  else {
    // Garis miring mengikuti arah drag
    x1 = start.x <= end.x ? 0 : W;
    y1 = start.y <= end.y ? 0 : H;
    x2 = W - x1;
    y2 = H - y1;
  }
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('data-shape', kind);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.cssText = `display: block; width: ${W}px; height: ${H}px; flex-shrink: 0; overflow: visible; fill: none; stroke: #111111; color: #111111; stroke-width: 2px; stroke-linecap: round;`;
  if (kind === 'arrow') {
    // Kepala panah memakai warna "color" (diset sama dengan stroke oleh panel kanan).
    const id = `arrow-${Math.random().toString(36).slice(2, 8)}`;
    const defs = doc.createElementNS(SVG, 'defs');
    defs.innerHTML = `<marker id="${id}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" stroke="none"/></marker>`;
    svg.append(defs);
    svg.dataset.marker = id;
  }
  const line = doc.createElementNS(SVG, 'line');
  for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(k, round(v));
  if (kind === 'arrow') line.setAttribute('marker-end', `url(#${svg.dataset.marker})`);
  svg.append(line);
  return svg;
}

// Ubah jumlah sisi polygon / titik bintang.
export function setShapeCount(svg, count) {
  const kind = svg.getAttribute('data-shape');
  const n = Math.max(3, Math.min(60, Math.round(count)));
  svg.setAttribute('data-count', String(n));
  svg.querySelector('polygon')?.setAttribute('points', shapePoints(kind, n));
}

const round = (n) => Math.round(n * 100) / 100;

// Jadikan vector: segitiga/polygon/bintang/garis diganti <path>, supaya titiknya bisa diedit (Pen).
export const CONVERTIBLE_SHAPES = new Set(['triangle', 'polygon', 'star', 'line']);

export function shapeToVector(svg) {
  const kind = svg.getAttribute('data-shape');
  if (!CONVERTIBLE_SHAPES.has(kind)) return false;
  const doc = svg.ownerDocument;
  const poly = svg.querySelector(':scope > polygon');
  const line = svg.querySelector(':scope > line');
  let d;
  if (poly) {
    const pts = poly.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
    d = `M ${pts.map(([x, y]) => `${round(x)} ${round(y)}`).join(' L ')} Z`;
  } else if (line) {
    const n = (k) => round(Number(line.getAttribute(k)) || 0);
    d = `M ${n('x1')} ${n('y1')} L ${n('x2')} ${n('y2')}`;
  } else {
    return false;
  }
  const path = doc.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  (poly ?? line).replaceWith(path);
  svg.removeAttribute('data-shape');
  svg.removeAttribute('data-count');
  svg.setAttribute('data-vector', 'pen');
  svg.setAttribute('aria-label', 'Vector');
  if (!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'none');
  return true;
}
