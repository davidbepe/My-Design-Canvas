// Kamera kanvas: zoom & pan dengan menggeser dan menskalakan "world" lewat CSS transform.
import { state, emit, isEditableTarget, DRAW_TOOLS } from './state.js';

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const VIEW_KEY = 'design-canvas:view';

let viewportEl;
let worldEl;
let spaceDown = false;
let drag = null;
let pendingFit = false;

export function initCamera(viewport, world) {
  viewportEl = viewport;
  worldEl = world;

  viewportEl.addEventListener('wheel', onWheel, { passive: false });
  // Ctrl+scroll di luar kanvas (mis. di atas panel) jangan sampai men-zoom halaman browser.
  addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) { spaceDown = true; updateCursor(); }
    } else if (e.shiftKey && e.code === 'Digit1') fitAll();
    else if (e.shiftKey && e.code === 'Digit0') zoomCenter(1);
    else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomCenter(state.view.zoom * 1.25); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomCenter(state.view.zoom / 1.25); }
    else if (mod && e.key === '0') { e.preventDefault(); zoomCenter(1); }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; updateCursor(); } });
  addEventListener('blur', () => { spaceDown = false; updateCursor(); });

  // Drag untuk pan: Space + drag, tool Hand, atau tombol tengah mouse.
  viewportEl.addEventListener('pointerdown', (e) => {
    if (!wantsPan(e)) return;
    e.preventDefault();
    drag = { px: e.clientX, py: e.clientY, x: state.view.x, y: state.view.y };
    viewportEl.setPointerCapture(e.pointerId);
    updateCursor();
  });
  viewportEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    state.view.x = drag.x + (e.clientX - drag.px);
    state.view.y = drag.y + (e.clientY - drag.py);
    applyView();
  });
  const endDrag = () => { drag = null; updateCursor(); };
  viewportEl.addEventListener('pointerup', endDrag);
  viewportEl.addEventListener('pointercancel', endDrag);

  // Kalau tab dibuka di latar belakang, ukurannya masih 0 dan hitungan fit jadi kacau.
  // Tunda sampai kanvas punya ukuran.
  new ResizeObserver(() => {
    if (pendingFit && viewportEl.clientWidth && viewportEl.clientHeight) { pendingFit = false; fitAll(); }
  }).observe(viewportEl);
}

export function wantsPan(e) {
  return e.button === 1 || (e.button === 0 && (spaceDown || state.tool === 'hand'));
}

export function isPanning() {
  return !!drag;
}

export function updateCursor() {
  viewportEl.classList.toggle('can-pan', spaceDown || state.tool === 'hand');
  viewportEl.classList.toggle('panning', !!drag);
  viewportEl.classList.toggle('can-draw', !spaceDown && DRAW_TOOLS.has(state.tool));
}

// Posisi mouse relatif terhadap pojok kiri-atas kanvas.
export function toLocal(e) {
  const r = viewportEl.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

export function screenToWorld(sx, sy) {
  const { x, y, zoom } = state.view;
  return { x: (sx - x) / zoom, y: (sy - y) / zoom };
}

export function worldToScreen(wx, wy) {
  const { x, y, zoom } = state.view;
  return { x: wx * zoom + x, y: wy * zoom + y };
}

export function applyView() {
  const { x, y, zoom } = state.view;
  worldEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  document.documentElement.style.setProperty('--zoom', zoom);
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(state.view)); } catch {}
  emit('view');
}

export function restoreView() {
  try {
    const saved = JSON.parse(localStorage.getItem(VIEW_KEY));
    if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom >= MIN_ZOOM) {
      Object.assign(state.view, saved);
      applyView();
      return true;
    }
  } catch {}
  return false;
}

// Zoom dengan titik (sx, sy) di layar tetap diam: rasanya seperti zoom ke arah kursor.
export function zoomAt(sx, sy, nextZoom) {
  const view = state.view;
  nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const w = screenToWorld(sx, sy);
  view.zoom = nextZoom;
  view.x = sx - w.x * nextZoom;
  view.y = sy - w.y * nextZoom;
  applyView();
}

export function zoomCenter(nextZoom) {
  zoomAt(viewportEl.clientWidth / 2, viewportEl.clientHeight / 2, nextZoom);
}

export function fitAll() {
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  if (!vw || !vh) { pendingFit = true; return; }
  const boards = state.artboards;
  if (!boards.length) {
    Object.assign(state.view, { x: vw / 2, y: vh / 2, zoom: 1 });
    return applyView();
  }
  const minX = Math.min(...boards.map((a) => a.x));
  const minY = Math.min(...boards.map((a) => a.y));
  const maxX = Math.max(...boards.map((a) => a.x + a.width));
  const maxY = Math.max(...boards.map((a) => a.y + a.height));
  fitRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, 1);
}

// Pusatkan dan zoom supaya kotak (koordinat world) pas di layar.
export function fitRect(rect, maxZoom = 4) {
  const vw = viewportEl.clientWidth;
  const vh = viewportEl.clientHeight;
  if (!vw || !vh || !rect.w || !rect.h) return;
  const pad = 80;
  const view = state.view;
  const zoom = Math.min(maxZoom, (vw - pad * 2) / rect.w, (vh - pad * 2) / rect.h);
  view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  view.x = (vw - rect.w * view.zoom) / 2 - rect.x * view.zoom;
  view.y = (vh - rect.h * view.zoom) / 2 - rect.y * view.zoom;
  applyView();
}

// Scroll = pan. Ctrl+scroll atau pinch trackpad = zoom (browser mengirim pinch sebagai ctrl+wheel).
function onWheel(e) {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : 1; // beberapa mouse melapor dalam "baris"
  if (e.ctrlKey || e.metaKey) {
    const { sx, sy } = toLocal(e);
    zoomAt(sx, sy, state.view.zoom * Math.exp(-e.deltaY * unit * 0.01));
  } else {
    const horizontal = e.shiftKey && !e.deltaX;
    state.view.x -= (horizontal ? e.deltaY : e.deltaX) * unit;
    state.view.y -= (horizontal ? 0 : e.deltaY) * unit;
    applyView();
  }
}
