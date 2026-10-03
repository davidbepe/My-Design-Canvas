// Warna latar kanvas (area di belakang artboard), seperti warna "Page" di Figma.
// Disimpan di browser ini; warna label artboard menyesuaikan supaya tetap terbaca.
const KEY = 'design-canvas:canvas-bg';
export const DEFAULT_CANVAS = '#2c2c2c';
export const CANVAS_PRESETS = [
  ['#1e1e1e', 'Gelap'],
  ['#2c2c2c', 'Abu-abu tua (bawaan)'],
  ['#e5e5e5', 'Abu-abu muda'],
  ['#f5f5f5', 'Terang'],
  ['#ffffff', 'Putih'],
];

let current = DEFAULT_CANVAS;

export const canvasColor = () => current;

export function initCanvasColor() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  applyCanvasColor(saved || DEFAULT_CANVAS, false);
}

export function applyCanvasColor(color, save = true) {
  const hex = toHex(color);
  if (!hex) return false;
  current = hex;
  const root = document.documentElement.style;
  root.setProperty('--canvas-bg', hex);
  // Label artboard: gelap di kanvas terang, terang di kanvas gelap.
  root.setProperty('--label-on-canvas', luminance(hex) > 0.5 ? '#5f5f5f' : '#9a9a9a');
  if (save) {
    try { localStorage.setItem(KEY, hex); } catch {}
  }
  return true;
}

// Terima #rgb, #rrggbb, atau rgb(...), kembalikan #rrggbb.
function toHex(color) {
  const c = String(color).trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((x) => x + x).join('')}`.toLowerCase();
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
