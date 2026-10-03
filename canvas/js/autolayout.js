// Auto layout ala Figma, diterjemahkan ke CSS flexbox:
// - tambah / hapus auto layout (Shift+A), atau bungkus beberapa elemen ke frame auto layout baru
// - arah, kotak perataan 3×3, gap (termasuk "Auto" = space-between)
// - resizing elemen anak: Fixed / Hug / Fill
import { state, emit, resolve, pathOf, setSelectionList, toast, visibleChildren } from './state.js';
import { recordDoc, group } from './history.js';

const ALIGN_VALUES = { start: 'flex-start', center: 'center', end: 'flex-end' };

export function isAutoLayout(el) {
  return el.ownerDocument.defaultView.getComputedStyle(el).display.includes('flex');
}

// Shift+A: beberapa elemen sejajar → bungkus; satu elemen/artboard → tambahkan auto layout.
export function autoLayoutShortcut() {
  const refs = state.selected;
  if (!refs.length) return toast('Pilih frame, elemen, atau artboard dulu');
  const elements = refs.filter((r) => r.path.length);
  if (elements.length > 1) return wrapInAutoLayout(elements);
  const ref = state.selection;
  const el = resolve(ref);
  if (el && isAutoLayout(el)) return toast('Sudah memakai auto layout');
  addAutoLayout([ref]);
}

export function addAutoLayout(refs) {
  group('Tambah auto layout', () => {
    for (const ref of refs) {
      const el = resolve(ref);
      if (!el) continue;
      recordDoc(ref.artboardId, 'Tambah auto layout', () => {
        el.style.setProperty('display', 'flex');
        el.style.setProperty('flex-direction', 'column');
        el.style.setProperty('gap', '16px');
        // Artboard: isi bisa diratakan ke tengah/bawah hanya kalau tingginya penuh.
        if (!ref.path.length) el.style.setProperty('min-height', '100vh');
      });
      emit('structure', ref.artboardId);
    }
  });
}

export function removeAutoLayout(refs) {
  group('Hapus auto layout', () => {
    for (const ref of refs) {
      const el = resolve(ref);
      if (!el) continue;
      recordDoc(ref.artboardId, 'Hapus auto layout', () => {
        for (const p of ['flex-direction', 'flex-wrap', 'gap', 'justify-content', 'align-items']) el.style.removeProperty(p);
        // "block" eksplisit, supaya flex dari stylesheet artboard juga ikut mati.
        el.style.setProperty('display', 'block');
      });
      emit('structure', ref.artboardId);
    }
  });
}

// Bungkus beberapa elemen sejajar ke dalam frame auto layout baru. Arahnya ditebak dari susunan elemen.
export function wrapInAutoLayout(refs) {
  const els = refs.map(resolve).filter(Boolean);
  const parent = els[0]?.parentElement;
  if (!parent || els.some((e) => e.parentElement !== parent) || refs.some((r) => r.artboardId !== refs[0].artboardId)) {
    return toast('Untuk dibungkus, elemen harus berada di induk yang sama');
  }
  const ordered = visibleChildren(parent).filter((c) => els.includes(c));
  const rects = ordered.map((e) => e.getBoundingClientRect());
  const horizontal = rects.every((r, i) => i === 0 || r.left >= rects[i - 1].right - 1);
  const doc = parent.ownerDocument;
  const frame = doc.createElement('div');
  frame.className = 'frame';
  frame.style.cssText = `display: flex; flex-direction: ${horizontal ? 'row' : 'column'}; gap: 8px; box-sizing: border-box;`;
  recordDoc(refs[0].artboardId, 'Bungkus dengan auto layout', () => {
    parent.insertBefore(frame, ordered[0]);
    frame.append(...ordered);
    setSelectionList([{ artboardId: refs[0].artboardId, path: pathOf(frame) }]);
  });
  emit('structure', refs[0].artboardId);
}

// ---------- Perataan 3×3 ----------

const toPos = (v) => (v === 'center' ? 'center' : v === 'flex-end' || v === 'end' || v === 'right' ? 'end' : 'start');

// Posisi isi saat ini: { h: start|center|end, v: start|center|end }
export function alignmentOf(cs) {
  const row = cs.flexDirection.startsWith('row');
  const main = toPos(cs.justifyContent);
  const cross = toPos(cs.alignItems);
  return row ? { h: main, v: cross } : { h: cross, v: main };
}

// Di flex, "justify" = sumbu arah layout, "align" = sumbu silang.
export function alignmentStyles(cs, h, v) {
  const row = cs.flexDirection.startsWith('row');
  return {
    'justify-content': ALIGN_VALUES[row ? h : v],
    'align-items': ALIGN_VALUES[row ? v : h],
  };
}

// ---------- Resizing anak: Fixed / Hug / Fill ----------

function parentFlex(el) {
  const parent = el.parentElement;
  if (!parent) return { inFlex: false, row: false };
  const pcs = el.ownerDocument.defaultView.getComputedStyle(parent);
  return { inFlex: pcs.display.includes('flex'), row: pcs.flexDirection.startsWith('row'), pcs };
}

export function sizeModeOf(el, axis) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const { inFlex, row, pcs } = parentFlex(el);
  const inline = el.style.getPropertyValue(axis).trim();
  const isMain = inFlex && (axis === 'width') === row;
  if (inline === '100%') return 'fill';
  if (isMain && parseFloat(cs.flexGrow) > 0) return 'fill';
  const unset = !inline || inline === 'auto';
  if (inFlex && !isMain && unset) {
    const self = cs.alignSelf;
    const stretch = self === 'stretch' || ((self === 'auto' || self === 'normal') && ['normal', 'stretch'].includes(pcs.alignItems));
    if (stretch) return 'fill';
  }
  // Di luar auto layout, elemen block otomatis selebar induknya.
  if (!inFlex && axis === 'width' && unset && cs.display === 'block') return 'fill';
  if (unset || inline === 'fit-content' || inline === 'max-content') return 'hug';
  return 'fixed';
}

// Kumpulan perubahan style untuk satu mode. null = hapus properti itu.
export function sizeModeStyles(el, axis, mode) {
  const { inFlex, row } = parentFlex(el);
  const isMain = inFlex && (axis === 'width') === row;
  const size = Math.round(el.getBoundingClientRect()[axis]);
  const reset = isMain ? { 'flex-grow': null, 'flex-basis': null } : inFlex ? { 'align-self': null } : {};
  if (mode === 'fixed') return { ...reset, [axis]: `${size}px` };
  if (mode === 'hug') return { ...reset, [axis]: 'fit-content' };
  // fill
  if (isMain) return { [axis]: 'auto', 'flex-grow': '1', 'flex-basis': '0', [`min-${axis}`]: '0' };
  if (inFlex) return { [axis]: null, 'align-self': 'stretch' };
  return { [axis]: '100%' };
}

// Mengetik angka di W/H = ukuran tetap, jadi Fill (flex-grow / align-self) dilepas.
export function fixedSizeCleanup(el, axis) {
  const { inFlex, row } = parentFlex(el);
  const isMain = inFlex && (axis === 'width') === row;
  return isMain ? { 'flex-grow': null, 'flex-basis': null } : inFlex ? { 'align-self': null } : {};
}
