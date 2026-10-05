// Auto layout ala Figma, diterjemahkan ke CSS flexbox:
// - tambah / hapus auto layout (Shift+A), atau bungkus beberapa elemen ke frame auto layout baru
// - arah, kotak perataan 3×3, gap (termasuk "Auto" = space-between)
// - resizing elemen anak: Fixed / Hug / Fill
import { state, emit, resolve, pathOf, setSelectionList, toast, visibleChildren, CONTAINER_TAGS } from './state.js';
import { recordDoc, group } from './history.js';
import { isFree, freePosition, makeFlow } from './position.js';
import { wrapArtboardInAutoLayout } from './actions.js';

const ALIGN_VALUES = { start: 'flex-start', center: 'center', end: 'flex-end' };

export function isAutoLayout(el) {
  return el.ownerDocument.defaultView.getComputedStyle(el).display.includes('flex');
}

// Shift+A seperti Figma/pen.dev:
// - beberapa elemen sejajar → dibungkus bersama ke auto layout baru;
// - frame biasa → diberi auto layout;
// - frame yang SUDAH auto layout, atau teks/gambar/shape → dibungkus ke auto layout baru
//   (jadi bisa membuat auto layout di dalam auto layout).
export function autoLayoutShortcut() {
  const refs = state.selected;
  if (!refs.length) return toast('Pilih frame atau elemen dulu');
  const elements = refs.filter((r) => r.path.length);
  if (elements.length > 1) return wrapInAutoLayout(elements);
  const ref = state.selection;
  const el = resolve(ref);
  if (!el) return;
  if (!ref.path.length) {
    // Frame utama yang sudah auto layout: dibungkus frame utama baru (frame lama masuk ke dalamnya).
    if (isAutoLayout(el)) return wrapArtboardInAutoLayout(ref.artboardId);
    return addAutoLayout([ref]);
  }
  if (isAutoLayout(el) || !isPlainFrame(el)) return wrapInAutoLayout([ref]);
  addAutoLayout([ref]);
}

// Frame biasa = wadah (div, section, ...) tanpa teks sendiri, bukan instance komponen.
function isPlainFrame(el) {
  if (!CONTAINER_TAGS.has(el.tagName) || el.getAttribute('data-component-role') === 'instance') return false;
  return ![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
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
  // Satu elemen: vertikal. Beberapa: ditebak dari susunannya (berjajar ke kanan = horizontal).
  const horizontal = ordered.length > 1 && rects.every((r, i) => i === 0 || r.left >= rects[i - 1].right - 1);
  const doc = parent.ownerDocument;
  const frame = doc.createElement('div');
  frame.className = 'frame';
  // Hug: seukuran isinya, tidak melebar memenuhi induk.
  frame.style.cssText = `display: flex; flex-direction: ${horizontal ? 'row' : 'column'}; gap: 8px; box-sizing: border-box; width: fit-content; height: fit-content; flex-shrink: 0;`;
  recordDoc(refs[0].artboardId, 'Bungkus dengan auto layout', () => {
    // Elemen berposisi Absolute: posisinya pindah ke pembungkus, supaya tidak bergeser di layar.
    const free = ordered.filter(isFree);
    if (free.length) {
      const left = Math.min(...free.map((e) => freePosition(e).left));
      const top = Math.min(...free.map((e) => freePosition(e).top));
      Object.assign(frame.style, { position: 'absolute', left: `${left}px`, top: `${top}px` });
      free.forEach(makeFlow);
    }
    parent.insertBefore(frame, ordered[0]);
    frame.append(...ordered);
    setSelectionList([{ artboardId: refs[0].artboardId, path: pathOf(frame) }]);
  });
  // Buka pembungkus dan elemen yang dibungkus di panel Layers.
  const wrapPath = pathOf(frame);
  emit('expand-layers', [wrapPath, ...ordered.map(pathOf)].map((path) => ({ artboardId: refs[0].artboardId, path })));
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
  const reset = isMain ? { 'flex-grow': null, 'flex-basis': null, [`min-${axis}`]: null } : inFlex ? { 'align-self': null } : {};
  // Elemen sebaris (mis. <span>, <a> di dalam teks) tidak menerima lebar/tinggi: jadikan inline-block.
  const sizable = el.ownerDocument.defaultView.getComputedStyle(el).display === 'inline' && mode !== 'hug'
    ? { display: 'inline-block' } : {};
  if (mode === 'fixed') return { ...reset, ...sizable, [axis]: `${size}px` };
  if (mode === 'hug') return { ...reset, [axis]: 'fit-content' };
  // fill. Tanpa min-width/height: 0, supaya seperti Figma elemen Fill tidak pernah lebih kecil dari
  // isinya (di induk yang Hug, flex-basis 0 + min 0 membuat elemen menyusut sampai 0).
  if (isMain) return { ...sizable, [axis]: 'auto', 'flex-grow': '1', 'flex-basis': '0', [`min-${axis}`]: null };
  if (inFlex) return { ...sizable, [axis]: null, 'align-self': 'stretch' };
  return { ...sizable, [axis]: '100%' };
}

// Seperti Figma: anak diberi Fill pada arah utama auto layout, sedangkan induknya Hug di arah itu.
// Induknya dijadikan Fixed di ukurannya sekarang, supaya ada ruang yang bisa diisi (kalau tetap Hug,
// anak yang Fill kehilangan ukurannya sendiri dan mengecil).
export function lockHugParent(el, axis) {
  const { inFlex, row } = parentFlex(el);
  const parent = el.parentElement;
  if (!inFlex || (axis === 'width') !== row || !parent || parent.tagName === 'BODY') return;
  if (sizeModeOf(parent, axis) !== 'hug') return;
  parent.style.setProperty(axis, `${Math.round(parent.getBoundingClientRect()[axis])}px`);
}

// Mengetik angka di W/H = ukuran tetap, jadi Fill (flex-grow / align-self) dilepas.
export function fixedSizeCleanup(el, axis) {
  const { inFlex, row } = parentFlex(el);
  const isMain = inFlex && (axis === 'width') === row;
  return isMain ? { 'flex-grow': null, 'flex-basis': null } : inFlex ? { 'align-self': null } : {};
}
