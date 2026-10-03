// Pixel grid ala Figma / pen.dev: garis tipis di setiap 1 px desain, muncul saat zoom >= 400%.
// Digambar di atas kanvas DAN artboard (seperti pen.dev), tapi di bawah garis seleksi.
// Nyala/mati lewat panel Kanvas atau Shift + '. Pilihan disimpan di browser ini.
import { state } from './state.js';

const KEY = 'design-canvas:pixel-grid';
export const PIXEL_GRID_MIN_ZOOM = 4;

let el;
let enabled = true;

export function initPixelGrid(overlayEl) {
  el = document.createElement('div');
  el.id = 'pixel-grid';
  el.hidden = true;
  overlayEl.before(el);
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch {}
  updatePixelGrid();
}

export const isPixelGridOn = () => enabled;

export function setPixelGrid(on) {
  enabled = on;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
  updatePixelGrid();
}

// Dipanggil setiap kali kanvas di-zoom/pan: satu kotak grid = 1 px desain di layar.
export function updatePixelGrid() {
  if (!el) return;
  const { x, y, zoom } = state.view;
  el.hidden = !enabled || zoom < PIXEL_GRID_MIN_ZOOM;
  if (el.hidden) return;
  el.style.backgroundSize = `${zoom}px ${zoom}px`;
  el.style.backgroundPosition = `${mod(x, zoom)}px ${mod(y, zoom)}px`;
}

const mod = (n, m) => ((n % m) + m) % m;
