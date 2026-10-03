// Effects (shadow & blur) dan Fill gradient: menerjemahkan nilai CSS <-> daftar yang bisa diedit di panel.
//
// Effects ala Figma:
//   Drop shadow / Inner shadow -> box-shadow (shape & vector SVG: filter drop-shadow, tanpa spread/inner)
//   Layer blur                 -> filter: blur()
//   Background blur            -> backdrop-filter: blur()
// Gradient: linear-gradient(...) / radial-gradient(...) di background-image.

// Pisahkan "a, b(c, d), e" di koma yang tidak berada di dalam kurung.
export function splitTop(str, sep = ',') {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// ---------- Shadow ----------

// "rgba(0, 0, 0, 0.25) 0px 4px 12px 0px inset" -> { inset, x, y, blur, spread, color }
function parseShadow(str) {
  const parts = splitTop(str, ' ');
  const nums = [];
  let color = 'rgba(0, 0, 0, 0.25)';
  let inset = false;
  for (const p of parts) {
    if (p === 'inset') inset = true;
    else if (/^-?[\d.]+(px)?$/.test(p)) nums.push(parseFloat(p));
    else color = p;
  }
  const [x = 0, y = 0, blur = 0, spread = 0] = nums;
  return { type: inset ? 'inner' : 'drop', x, y, blur, spread, color };
}

const shadowCss = (s, withSpread = true) =>
  `${s.type === 'inner' ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px${withSpread ? ` ${s.spread}px` : ''} ${s.color}`;

// Penyesuaian warna lewat CSS filter (seperti "Adjustments" di aplikasi desain).
export const ADJUSTMENTS = {
  brightness: { label: 'Brightness', unit: '%', def: 120 },
  contrast: { label: 'Contrast', unit: '%', def: 120 },
  saturate: { label: 'Saturation', unit: '%', def: 150 },
  grayscale: { label: 'Grayscale', unit: '%', def: 100, max: 100 },
  sepia: { label: 'Sepia', unit: '%', def: 100, max: 100 },
  'hue-rotate': { label: 'Hue rotate', unit: '°', def: 90 },
  invert: { label: 'Invert', unit: '%', def: 100, max: 100 },
};

// Nilai fungsi filter -> angka di panel: "1.2" / "120%" -> 120, "90deg" -> 90.
function adjustValue(fn, arg) {
  const n = parseFloat(arg);
  if (fn === 'hue-rotate') return arg.endsWith('turn') ? n * 360 : arg.endsWith('rad') ? (n * 180) / Math.PI : n;
  return arg.trim().endsWith('%') ? n : n * 100;
}
const adjustCss = (e) => `${e.fn}(${round(e.value)}${e.fn === 'hue-rotate' ? 'deg' : '%'})`;

// Baca semua efek elemen dari style hasil hitungan browser.
// svg = shape/vector SVG: bayangan mengikuti bentuknya lewat filter drop-shadow.
export function readEffects(cs, svg) {
  const list = [];
  if (!svg && cs.boxShadow && cs.boxShadow !== 'none') list.push(...splitTop(cs.boxShadow).map(parseShadow));
  if (cs.textShadow && cs.textShadow !== 'none') {
    list.push(...splitTop(cs.textShadow).map((t) => ({ ...parseShadow(t), type: 'text' })));
  }
  for (const fn of filterFns(cs.filter)) {
    const m = fn.match(/^([\w-]+)\((.*)\)$/s);
    if (!m) continue;
    if (m[1] === 'blur') list.push({ type: 'layer-blur', blur: parseFloat(m[2]) || 0 });
    else if (m[1] === 'drop-shadow' && svg) list.push(parseShadow(m[2]));
    else if (ADJUSTMENTS[m[1]]) list.push({ type: 'adjust', fn: m[1], value: adjustValue(m[1], m[2]) });
  }
  const bd = filterFns(cs.backdropFilter).find((f) => f.startsWith('blur('));
  if (bd) list.push({ type: 'bg-blur', blur: parseFloat(bd.slice(5)) || 0 });
  return list;
}

function filterFns(value) {
  if (!value || value === 'none') return [];
  return splitTop(value, ' ');
}

// Tulis daftar efek ke elemen. Fungsi filter yang tidak dikenali panel (dari kode yang sudah ada) dipertahankan.
export function effectStyles(el, list, svg) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const handled = (f) => f.startsWith('blur(') || (svg && f.startsWith('drop-shadow(')) || Object.keys(ADJUSTMENTS).some((k) => f.startsWith(`${k}(`));
  const keep = filterFns(cs.filter).filter((f) => !handled(f));
  const shadows = list.filter((e) => e.type === 'drop' || e.type === 'inner');
  const texts = list.filter((e) => e.type === 'text');
  const blur = list.find((e) => e.type === 'layer-blur');
  const bg = list.find((e) => e.type === 'bg-blur');
  const filter = [
    ...keep,
    ...(svg ? shadows.filter((s) => s.type === 'drop').map((s) => `drop-shadow(${shadowCss(s, false)})`) : []),
    ...list.filter((e) => e.type === 'adjust').map(adjustCss),
    ...(blur ? [`blur(${blur.blur}px)`] : []),
  ];
  return {
    'box-shadow': svg || !shadows.length ? null : shadows.map((s) => shadowCss(s)).join(', '),
    'text-shadow': texts.length ? texts.map((t) => `${t.x}px ${t.y}px ${t.blur}px ${t.color}`).join(', ') : null,
    filter: filter.length ? filter.join(' ') : null,
    'backdrop-filter': bg ? `blur(${bg.blur}px)` : null,
    '-webkit-backdrop-filter': bg ? `blur(${bg.blur}px)` : null,
  };
}

// Efek baru dari menu +. Kunci "adjust:<fungsi>" untuk penyesuaian warna.
export function defaultEffect(key) {
  if (key.startsWith('adjust:')) {
    const fn = key.slice(7);
    return { type: 'adjust', fn, value: ADJUSTMENTS[fn].def };
  }
  return structuredClone(DEFAULT_EFFECTS[key]);
}

export const effectKey = (e) => (e.type === 'adjust' ? `adjust:${e.fn}` : e.type);

export const DEFAULT_EFFECTS = {
  drop: { type: 'drop', x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0, 0, 0, 0.25)' },
  inner: { type: 'inner', x: 0, y: 2, blur: 4, spread: 0, color: 'rgba(0, 0, 0, 0.25)' },
  text: { type: 'text', x: 0, y: 2, blur: 4, color: 'rgba(0, 0, 0, 0.35)' },
  'layer-blur': { type: 'layer-blur', blur: 4 },
  'bg-blur': { type: 'bg-blur', blur: 12 },
};

// ---------- Gradient ----------

const SIDES = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };

// "linear-gradient(90deg, rgb(..) 0%, ...)" -> { kind, angle, shape, stops: [{ color, pos }] }
export function parseGradient(value) {
  const m = value?.match(/^(linear|radial)-gradient\((.*)\)$/s);
  if (!m) return null;
  const parts = splitTop(m[2]);
  const g = { kind: m[1], angle: 180, shape: '', stops: [] };
  if (parts.length && !isColorStart(parts[0])) {
    const head = parts.shift();
    if (g.kind === 'linear') {
      if (head.startsWith('to ')) g.angle = SIDES[head.slice(3)] ?? 180;
      else g.angle = parseAngle(head);
    } else {
      g.shape = head;
    }
  }
  for (const part of parts) {
    const tokens = splitTop(part, ' ');
    const color = tokens.shift();
    const pos = tokens.length ? parseFloat(tokens[0]) : NaN;
    g.stops.push({ color, pos });
  }
  if (g.stops.length < 2) return null;
  // Posisi yang tidak ditulis dibagi rata.
  g.stops.forEach((s, i) => { if (!Number.isFinite(s.pos)) s.pos = (i / (g.stops.length - 1)) * 100; });
  return g;
}

function isColorStart(part) {
  const first = splitTop(part, ' ')[0];
  return CSS.supports('color', first);
}

function parseAngle(v) {
  const n = parseFloat(v);
  if (v.endsWith('turn')) return n * 360;
  if (v.endsWith('rad')) return (n * 180) / Math.PI;
  return Number.isFinite(n) ? n : 180;
}

export function gradientCss(g) {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${round(s.pos)}%`).join(', ');
  if (g.kind === 'radial') return `radial-gradient(${g.shape ? `${g.shape}, ` : ''}${stops})`;
  return `linear-gradient(${round(g.angle)}deg, ${stops})`;
}

const round = (n) => Math.round(n * 100) / 100;
