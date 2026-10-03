// Align & Distribute, seperti tombol perataan di atas panel kanan Figma.
//
// Beberapa elemen terpilih: diratakan terhadap kotak gabungan semuanya.
// Satu elemen: diratakan terhadap induknya. Distribute (≥ 3 elemen): jarak antar-elemen dibuat sama.
// Hanya elemen berposisi Bebas (dan artboard) yang bisa digeser; elemen "Ikut layout" diatur auto layout.
import { state, emit, resolve, getArtboard, toast } from './state.js';
import { recordDoc, group } from './history.js';
import { changeArtboard } from './actions.js';
import { rectOf } from './selection.js';
import { isFree, freePosition } from './position.js';
import { isGroup, freeLeaves, isMovableGroup } from './group.js';

const FLOW_HINT = 'Elemen yang "Ikut layout" diatur oleh auto layout. Ubah Posisi ke Bebas untuk menggesernya.';

const movable = (ref) => !ref.path.length || isMovableEl(resolve(ref));
const isMovableEl = (el) => !!el && (isGroup(el) ? isMovableGroup(el) : isFree(el));

// Tampilkan tombol align kalau ada yang bisa diratakan.
export function canAlign() {
  const refs = state.selected;
  if (refs.length > 1) return true;
  return refs.length === 1 && refs[0].path.length > 0 && movable(refs[0]);
}

// mode: left | hcenter | right | top | vcenter | bottom
export function alignSelection(mode) {
  const refs = state.selected;
  const items = refs.map((ref) => ({ ref, rect: rectOf(ref) })).filter((i) => i.rect);
  if (!items.length) return;
  const bounds = items.length === 1 ? parentRect(items[0].ref) : union(items.map((i) => i.rect));
  if (!bounds) return;
  move('Ratakan', items.map(({ ref, rect }) => {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = bounds.x - rect.x;
    if (mode === 'hcenter') dx = bounds.x + bounds.w / 2 - (rect.x + rect.w / 2);
    if (mode === 'right') dx = bounds.x + bounds.w - (rect.x + rect.w);
    if (mode === 'top') dy = bounds.y - rect.y;
    if (mode === 'vcenter') dy = bounds.y + bounds.h / 2 - (rect.y + rect.h / 2);
    if (mode === 'bottom') dy = bounds.y + bounds.h - (rect.y + rect.h);
    return { ref, dx, dy };
  }));
}

// axis: 'h' (jarak horizontal sama) | 'v' (jarak vertikal sama)
export function distributeSelection(axis) {
  const items = state.selected.map((ref) => ({ ref, rect: rectOf(ref) })).filter((i) => i.rect);
  if (items.length < 3) return toast('Pilih minimal 3 elemen untuk mengatur jarak yang sama');
  const [pos, size] = axis === 'h' ? ['x', 'w'] : ['y', 'h'];
  items.sort((a, b) => a.rect[pos] - b.rect[pos]);
  const first = items[0].rect;
  const last = items.at(-1).rect;
  const total = items.reduce((s, i) => s + i.rect[size], 0);
  const gap = (last[pos] + last[size] - first[pos] - total) / (items.length - 1);
  let cursor = first[pos];
  move('Atur jarak sama', items.map(({ ref, rect }) => {
    const target = cursor;
    cursor += rect[size] + gap;
    const d = target - rect[pos];
    return { ref, dx: axis === 'h' ? d : 0, dy: axis === 'v' ? d : 0 };
  }));
}

function move(label, moves) {
  const todo = moves.filter((m) => Math.abs(m.dx) >= 0.01 || Math.abs(m.dy) >= 0.01);
  const blocked = todo.filter((m) => !movable(m.ref));
  if (blocked.length) toast(FLOW_HINT);
  const ok = todo.filter((m) => movable(m.ref));
  if (!ok.length) return;
  group(label, () => {
    // Artboard: ubah posisinya di manifest.
    for (const { ref, dx, dy } of ok.filter((m) => !m.ref.path.length)) {
      const a = getArtboard(ref.artboardId);
      if (a) changeArtboard(a.id, { x: Math.round(a.x + dx), y: Math.round(a.y + dy) }, label);
    }
    // Elemen: geser left/top, dicatat per artboard.
    const byArtboard = new Map();
    for (const m of ok.filter((x) => x.ref.path.length)) {
      if (!byArtboard.has(m.ref.artboardId)) byArtboard.set(m.ref.artboardId, []);
      byArtboard.get(m.ref.artboardId).push({ el: resolve(m.ref), dx: m.dx, dy: m.dy });
    }
    for (const [id, list] of byArtboard) {
      recordDoc(id, label, () => { for (const { el, dx, dy } of list) moveBy(el, dx, dy); });
      emit('structure', id);
    }
  });
}

// Geser elemen bebas (atau semua elemen bebas di dalam group) sejauh dx/dy.
export function moveBy(el, dx, dy) {
  for (const target of isGroup(el) ? freeLeaves(el) : [el]) {
    const p = freePosition(target);
    target.style.left = `${round(p.left + dx)}px`;
    target.style.top = `${round(p.top + dy)}px`;
  }
}

function parentRect(ref) {
  if (!ref.path.length) return null;
  return rectOf({ artboardId: ref.artboardId, path: ref.path.slice(0, -1) });
}

function union(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x, y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}

const round = (n) => Math.round(n * 100) / 100;
