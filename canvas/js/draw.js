// Tool menggambar: Frame (F), Text (T), dan bentuk (Rectangle, Ellipse, Segitiga, ...).
//
// Karena posisi di HTML diatur oleh layout, elemen baru dimasukkan ke WADAH tempat kamu mulai
// menggambar, di urutan yang paling dekat dengan posisi mouse. Ukurannya mengikuti hasil drag.
// (Vector dari Pen/Pencil berbeda: diletakkan bebas persis di tempat digambar, lihat vector.js.)
import {
  state, docOf, pathOf, setSelection, setTool, toast, emit, HIDDEN_TAGS, CONTAINER_TAGS,
} from './state.js';
import { recordDoc } from './history.js';
import { createArtboardWithHistory } from './actions.js';
import { startTextEdit } from './textedit.js';
import { SHAPE_TOOLS, SHAPE_LABELS, buildShape } from './shapes.js';

const DEFAULT_SIZE = 100;
const LABELS = {
  frame: 'Tambah frame', text: 'Tambah teks',
  ...Object.fromEntries(SHAPE_TOOLS.map((t) => [t, `Tambah ${SHAPE_LABELS[t].toLowerCase()}`])),
};

export function artboardAt(wx, wy) {
  for (let i = state.artboards.length - 1; i >= 0; i--) {
    const a = state.artboards[i];
    if (wx >= a.x && wy >= a.y && wx <= a.x + a.width && wy <= a.y + a.height) return a;
  }
  return null;
}

// Naik dari elemen di bawah kursor sampai ketemu elemen yang bisa menjadi wadah.
export function containerAt(artboard, wx, wy) {
  const doc = docOf(artboard.id);
  if (!doc?.body) return null;
  let el = doc.elementFromPoint(wx - artboard.x, wy - artboard.y) ?? doc.body;
  while (el && !CONTAINER_TAGS.has(el.tagName)) el = el.parentElement;
  return el ?? doc.body;
}

// Tempat menyisipkan elemen di titik (wx, wy): wadahnya + saudara yang harus berada sesudahnya.
// Dipakai untuk drop gambar.
export function insertionAt(wx, wy) {
  const a = artboardAt(wx, wy);
  const parent = a && containerAt(a, wx, wy);
  if (!parent) return null;
  return { artboardId: a.id, parent, before: nextSiblingFor(parent, wx - a.x, wy - a.y) };
}

// Untuk hover saat tool gambar aktif: tandai wadah tujuan dengan garis biru.
export function containerRefAt(wx, wy) {
  const a = artboardAt(wx, wy);
  const el = a && containerAt(a, wx, wy);
  if (!el) return null;
  return { artboardId: a.id, path: el.tagName === 'BODY' ? [] : pathOf(el) ?? [] };
}

// Cari anak yang harus berada SETELAH elemen baru, berdasarkan arah layout wadahnya.
function nextSiblingFor(container, lx, ly) {
  const cs = container.ownerDocument.defaultView.getComputedStyle(container);
  const horizontal = cs.display.includes('flex') && cs.flexDirection.startsWith('row');
  for (const child of container.children) {
    if (HIDDEN_TAGS.has(child.tagName)) continue;
    const r = child.getBoundingClientRect();
    if (horizontal ? lx < r.left + r.width / 2 : ly < r.top + r.height / 2) return child;
  }
  return null;
}

function buildElement(doc, tool, w, h, dragged, start, end) {
  if (SHAPE_TOOLS.includes(tool)) return buildShape(doc, tool, w, h, dragged, start, end);
  if (tool === 'text') {
    const p = doc.createElement('p');
    p.textContent = 'Teks';
    p.style.cssText = 'margin: 0; font-size: 16px;';
    if (dragged && w > 20) p.style.width = `${w}px`;
    return p;
  }
  const el = doc.createElement('div');
  el.className = tool; // jadi nama layer: "frame" / "rect"
  const width = dragged ? w : DEFAULT_SIZE;
  const height = dragged ? h : DEFAULT_SIZE;
  // flex-shrink: 0 supaya ukurannya tidak dipaksa mengecil di dalam auto-layout.
  const base = `width: ${width}px; height: ${height}px; flex-shrink: 0; box-sizing: border-box;`;
  el.style.cssText = tool === 'frame'
    ? `${base} display: flex; flex-direction: column; gap: 8px; padding: 16px; background: #f4f4f5;`
    : `${base} background: #d9d9d9;`;
  return el;
}

// Dipanggil saat mouse dilepas. start/end dalam koordinat world.
export async function finishDraw(tool, start, end, dragged) {
  const rect = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.max(1, Math.round(Math.abs(end.x - start.x))),
    h: Math.max(1, Math.round(Math.abs(end.y - start.y))),
  };
  setTool('select');

  const artboard = artboardAt(start.x, start.y);
  if (!artboard) {
    if (tool !== 'frame') return toast('Gambar di dalam artboard, atau pakai Frame untuk membuat artboard baru');
    const created = await createArtboardWithHistory({
      name: nextFrameName(),
      width: dragged ? rect.w : DEFAULT_SIZE,
      height: dragged ? rect.h : DEFAULT_SIZE,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      html: '',
    }, 'Buat artboard');
    if (created) setSelection({ artboardId: created.id, path: [] });
    return;
  }

  const container = containerAt(artboard, start.x, start.y);
  if (!container) return;
  const cx = rect.x + rect.w / 2 - artboard.x;
  const cy = rect.y + rect.h / 2 - artboard.y;
  let created;
  recordDoc(artboard.id, LABELS[tool], () => {
    created = buildElement(container.ownerDocument, tool, rect.w, rect.h, dragged, start, end);
    container.insertBefore(created, nextSiblingFor(container, cx, cy));
    setSelection({ artboardId: artboard.id, path: pathOf(created) });
  });
  emit('structure', artboard.id);
  if (tool === 'text') startTextEdit(state.selection);
}

function nextFrameName() {
  const taken = new Set(state.artboards.map((a) => a.name));
  let n = 1;
  while (taken.has(`Frame ${n}`)) n++;
  return `Frame ${n}`;
}
