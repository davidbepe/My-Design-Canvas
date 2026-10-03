// Color picker ala Figma: kotak saturasi/kecerahan, slider hue & opacity, pipet, Hex/RGB/HSL,
// dan daftar variabel warna. Menggantikan pemilih warna bawaan browser.
import { data as varData, groupOf } from './tokens.js';

let popup = null;
let state = null; // { h, s, v, a, onInput, onClose, onToken, start }
const parser = document.createElement('canvas').getContext('2d');

// ---------- Warna terakhir (riwayat) ----------

const RECENT_KEY = 'design-canvas:recent-colors';
const RECENT_MAX = 16;

export function recentColors() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? []; } catch { return []; }
}

// Catat warna yang baru dipakai (paling baru di depan, tanpa duplikat). Variabel (var(--...)) tidak dicatat.
export function rememberColor(value) {
  if (!value || /^var\(/.test(value) || value === 'none' || value === 'transparent') return;
  const { r, g, b, a } = parseCss(value);
  if (a === 0) return;
  const css = a >= 1 ? rgbToHex({ r, g, b }) : `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 100) / 100})`;
  const list = [css, ...recentColors().filter((c) => c !== css)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

// ---------- Konversi warna ----------

// Ubah warna CSS apa pun (hex, rgb, nama warna) menjadi { r, g, b, a } lewat parser bawaan canvas.
export function parseCss(value) {
  if (!value || value === 'none' || value === 'transparent') return { r: 0, g: 0, b: 0, a: value === 'transparent' ? 0 : 1 };
  parser.fillStyle = '#000';
  parser.fillStyle = value;
  const out = parser.fillStyle; // "#rrggbb" atau "rgba(r, g, b, a)"
  if (out.startsWith('#')) return { r: parseInt(out.slice(1, 3), 16), g: parseInt(out.slice(3, 5), 16), b: parseInt(out.slice(5, 7), 16), a: 1 };
  const [r, g, b, a = 1] = out.match(/[\d.]+/g).map(Number);
  return { r, g, b, a };
}

const toHex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
export const rgbToHex = ({ r, g, b }) => `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

function rgbToHsv({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const { h } = rgbToHsv({ r: r * 255, g: g * 255, b: b * 255 });
  return { h, s, l };
}

// Nilai CSS hasil picker: hex kalau tidak transparan, selain itu rgba().
function cssValue() {
  const rgb = hsvToRgb(state);
  if (state.a >= 1) return rgbToHex(rgb);
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${Math.round(state.a * 100) / 100})`;
}

// ---------- Buka / tutup ----------

// options: { value, onInput(css) dipanggil setiap perubahan, onClose(css, changed), onToken(varCss) }
export function openColorPicker(anchor, { value, onInput, onClose, onToken }) {
  closeColorPicker();
  const rgba = parseCss(value);
  state = { ...rgbToHsv(rgba), a: rgba.a, onInput, onClose, onToken, start: value, format: state?.format ?? 'hex' };
  popup = build();
  document.body.append(popup);
  const r = anchor.getBoundingClientRect();
  // Di kiri anchor (panel kanan ada di tepi layar), dijaga tetap di dalam layar.
  const left = r.left - popup.offsetWidth - 12 > 8 ? r.left - popup.offsetWidth - 12 : Math.min(r.left, innerWidth - popup.offsetWidth - 8);
  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top = `${Math.max(8, Math.min(r.top - 40, innerHeight - popup.offsetHeight - 8))}px`;
  render();
  setTimeout(() => {
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', onEsc, true);
  });
}

export function closeColorPicker() {
  if (!popup) return;
  const final = cssValue();
  const { onClose, start } = state;
  popup.remove();
  popup = null;
  removeEventListener('pointerdown', outside, true);
  removeEventListener('keydown', onEsc, true);
  if (final !== start) rememberColor(final);
  onClose?.(final, final !== start);
}

function outside(e) {
  if (!popup?.contains(e.target)) closeColorPicker();
}

function onEsc(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeColorPicker(); }
}

function changed() {
  render();
  state.onInput?.(cssValue());
}

// Satu pilihan warna selesai (lepas drag, ketik nilai, pipet): catat ke "Warna terakhir" saat itu juga.
function picked() {
  rememberColor(cssValue());
  renderRecent();
}

// ---------- Tampilan ----------

let els = {};

function build() {
  const root = el('div', 'cp');
  root.addEventListener('pointerdown', (e) => e.stopPropagation());

  const head = el('div', 'cp-head');
  head.append(el('span', '', 'Warna'));
  const close = el('button', 'icon-text-btn', '×');
  close.addEventListener('click', closeColorPicker);
  head.append(close);

  // Kotak saturasi (kiri→kanan) & kecerahan (atas→bawah)
  const sv = el('div', 'cp-sv');
  const svThumb = el('div', 'cp-thumb');
  sv.append(svThumb);
  drag(sv, (x, y) => { state.s = x; state.v = 1 - y; changed(); }, picked);

  const sliders = el('div', 'cp-sliders');
  const hue = el('div', 'cp-slider cp-hue');
  const hueThumb = el('div', 'cp-slider-thumb');
  hue.append(hueThumb);
  drag(hue, (x) => { state.h = Math.min(359.9, x * 360); changed(); }, picked);
  const alpha = el('div', 'cp-slider cp-alpha');
  const alphaFill = el('div', 'cp-alpha-fill');
  const alphaThumb = el('div', 'cp-slider-thumb');
  alpha.append(alphaFill, alphaThumb);
  drag(alpha, (x) => { state.a = Math.round(x * 100) / 100; changed(); }, picked);
  sliders.append(hue, alpha);

  const tools = el('div', 'cp-tools');
  if ('EyeDropper' in window) {
    const pipette = el('button', 'cp-pipette');
    pipette.title = 'Ambil warna dari layar (pipet)';
    pipette.innerHTML = '<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3-1.5 1.5-3-3zM9 4l3 3-6 6H3v-3z"/></svg>';
    pipette.addEventListener('click', async () => {
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        Object.assign(state, rgbToHsv(parseCss(sRGBHex)));
        changed();
        picked();
      } catch {} // dibatalkan dengan Esc
    });
    tools.append(pipette);
  }
  tools.append(sliders);

  // Format + nilai + opacity
  const values = el('div', 'cp-values');
  const format = el('select', 'cp-format');
  for (const f of ['hex', 'rgb', 'hsl']) format.append(new Option(f.toUpperCase(), f, false, f === state.format));
  format.addEventListener('change', () => { state.format = format.value; render(); });
  const inputs = el('div', 'cp-inputs');
  const opacity = el('input', 'cp-input cp-opacity');
  opacity.title = 'Opacity (%)';
  opacity.addEventListener('change', () => {
    const n = parseFloat(opacity.value);
    if (Number.isFinite(n)) { state.a = Math.max(0, Math.min(100, n)) / 100; changed(); picked(); } else render();
  });
  values.append(format, inputs, opacity);

  root.append(head, sv, tools, values);

  // Warna terakhir yang dipakai (selalu tampil; diperbarui setiap kali warna selesai dipilih)
  const recentSection = el('div', 'cp-tokens');
  recentSection.append(el('div', 'cp-label', 'Warna terakhir'));
  const recentGrid = el('div', 'cp-token-grid');
  recentSection.append(recentGrid);
  root.append(recentSection);

  // Variabel warna (design system)
  const colorTokens = Object.keys(varData.tokens).filter((n) => varData.groups.find((g) => g.id === groupOf(n))?.type === 'color');
  if (colorTokens.length && state.onToken) {
    const section = el('div', 'cp-tokens');
    section.append(el('div', 'cp-label', 'Variabel warna'));
    const grid = el('div', 'cp-token-grid');
    for (const name of colorTokens) {
      const sw = el('button', 'cp-token');
      sw.style.background = varData.tokens[name][varData.modes[0]];
      sw.title = `var(--${name})`;
      sw.addEventListener('click', () => {
        const onToken = state.onToken;
        state.start = cssValue(); // jangan panggil onClose sebagai "berubah"
        closeColorPicker();
        onToken(`var(--${name})`);
      });
      grid.append(sw);
    }
    section.append(grid);
    root.append(section);
  }

  els = { sv, svThumb, hueThumb, alphaFill, alphaThumb, inputs, opacity, recentGrid };
  renderRecent();
  return root;
}

function renderRecent() {
  const grid = els.recentGrid;
  if (!grid) return;
  const recent = recentColors();
  if (!recent.length) {
    grid.replaceChildren(el('span', 'cp-empty', 'Warna yang kamu pilih akan muncul di sini.'));
    return;
  }
  grid.replaceChildren(...recent.map((color) => {
    const sw = el('button', 'cp-token cp-recent');
    sw.style.setProperty('--sw', color);
    sw.title = color;
    sw.addEventListener('click', () => {
      const rgba = parseCss(color);
      Object.assign(state, rgbToHsv(rgba), { a: rgba.a });
      changed();
      picked();
    });
    return sw;
  }));
}

function render() {
  const rgb = hsvToRgb(state);
  const pure = rgbToHex(hsvToRgb({ h: state.h, s: 1, v: 1 }));
  els.sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})`;
  els.svThumb.style.left = `${state.s * 100}%`;
  els.svThumb.style.top = `${(1 - state.v) * 100}%`;
  els.svThumb.style.background = rgbToHex(rgb);
  els.hueThumb.style.left = `${(state.h / 360) * 100}%`;
  els.alphaFill.style.background = `linear-gradient(to right, transparent, ${rgbToHex(rgb)})`;
  els.alphaThumb.style.left = `${state.a * 100}%`;
  els.opacity.value = `${Math.round(state.a * 100)}%`;
  renderInputs(rgb);
}

// Input sesuai format: Hex (1 kolom), RGB / HSL (3 kolom).
function renderInputs(rgb) {
  const box = els.inputs;
  if (box.contains(document.activeElement)) return; // jangan ganggu yang sedang diketik
  box.replaceChildren();
  if (state.format === 'hex') {
    const input = el('input', 'cp-input cp-hex');
    input.value = rgbToHex(rgb).slice(1).toUpperCase();
    input.addEventListener('change', () => {
      const v = input.value.trim().replace(/^#/, '');
      if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { Object.assign(state, rgbToHsv(parseCss(`#${v}`))); changed(); picked(); } else render();
    });
    box.append(input);
    return;
  }
  const values = state.format === 'rgb'
    ? [rgb.r, rgb.g, rgb.b].map(Math.round)
    : (() => { const { h, s, l } = rgbToHsl(rgb); return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]; })();
  const max = state.format === 'rgb' ? [255, 255, 255] : [360, 100, 100];
  values.forEach((v, i) => {
    const input = el('input', 'cp-input');
    input.value = v;
    input.addEventListener('change', () => {
      const nums = [...box.querySelectorAll('input')].map((x, j) => Math.max(0, Math.min(max[j], parseFloat(x.value) || 0)));
      const css = state.format === 'rgb' ? `rgb(${nums.join(', ')})` : `hsl(${nums[0]}, ${nums[1]}%, ${nums[2]}%)`;
      Object.assign(state, rgbToHsv(parseCss(css)));
      changed();
      picked();
    });
    box.append(input);
  });
}

// Drag di area (kotak atau slider): kirim posisi 0..1; onEnd dipanggil saat mouse dilepas.
function drag(area, onMove, onEnd) {
  area.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    area.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = area.getBoundingClientRect();
      onMove(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
    };
    move(e);
    const up = () => {
      area.removeEventListener('pointermove', move);
      area.removeEventListener('pointerup', up);
      onEnd?.();
    };
    area.addEventListener('pointermove', move);
    area.addEventListener('pointerup', up);
  });
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}
