// Group (Ctrl+G) dan Ungroup (Ctrl+Shift+G), seperti group di Figma / pen.dev.
//
// Di HTML tidak ada elemen "group", jadi group = <div data-group style="display: contents">.
// "display: contents" membuat pembungkusnya tidak punya kotak sendiri: isi group tersusun persis
// seperti sebelum dibungkus. Group hanya merapikan layer; ukurannya = gabungan kotak isinya.
import { state, emit, resolve, pathOf, setSelectionList, toast, visibleChildren } from './state.js';
import { recordDoc, group } from './history.js';
import { isFree } from './position.js';

export const isGroup = (el) => !!el?.hasAttribute?.('data-group');

// Kotak (koordinat artboard) sebuah elemen. Group tidak punya kotak, jadi pakai gabungan isinya.
export function boxOf(el) {
  if (!isContents(el)) return el.getBoundingClientRect();
  const boxes = visibleChildren(el).map(boxOf).filter((r) => r.width || r.height);
  if (!boxes.length) return new DOMRect(0, 0, 0, 0);
  const left = Math.min(...boxes.map((r) => r.left));
  const top = Math.min(...boxes.map((r) => r.top));
  const right = Math.max(...boxes.map((r) => r.right));
  const bottom = Math.max(...boxes.map((r) => r.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function isContents(el) {
  return el.ownerDocument.defaultView.getComputedStyle(el).display === 'contents';
}

// Induk "sungguhan" untuk layout & posisi: lewati pembungkus display: contents.
export function layoutParent(el) {
  let p = el.parentElement;
  while (p && p.tagName !== 'BODY' && isContents(p)) p = p.parentElement;
  return p;
}

// Elemen berposisi bebas di dalam group (termasuk group di dalam group).
export function freeLeaves(groupEl) {
  return visibleChildren(groupEl).flatMap((c) => (isGroup(c) ? freeLeaves(c) : isFree(c) ? [c] : []));
}

// Group bisa di-drag/diratakan kalau isinya punya elemen berposisi bebas.
export const isMovableGroup = (el) => isGroup(el) && freeLeaves(el).length > 0;

export function groupSelection() {
  const refs = state.selected.filter((r) => r.path.length);
  if (!refs.length) return toast('Pilih elemen yang mau di-group dulu');
  const els = refs.map(resolve).filter(Boolean);
  const parent = els[0]?.parentElement;
  if (!parent || els.some((e) => e.parentElement !== parent) || refs.some((r) => r.artboardId !== refs[0].artboardId)) {
    return toast('Untuk di-group, elemen harus berada di induk yang sama');
  }
  const ordered = visibleChildren(parent).filter((c) => els.includes(c));
  const g = parent.ownerDocument.createElement('div');
  g.setAttribute('data-group', '');
  g.style.display = 'contents';
  const { artboardId } = refs[0];
  recordDoc(artboardId, 'Group', () => {
    parent.insertBefore(g, ordered[0]);
    g.append(...ordered);
    setSelectionList([{ artboardId, path: pathOf(g) }]);
  });
  emit('structure', artboardId);
}

export function ungroupSelection() {
  const byArtboard = new Map();
  for (const ref of state.selected) {
    const el = resolve(ref);
    if (!isGroup(el)) continue;
    if (!byArtboard.has(ref.artboardId)) byArtboard.set(ref.artboardId, []);
    byArtboard.get(ref.artboardId).push(el);
  }
  if (!byArtboard.size) return toast('Pilih group yang mau dilepas');
  group('Ungroup', () => {
    const selected = [];
    for (const [artboardId, groups] of byArtboard) {
      recordDoc(artboardId, 'Ungroup', () => {
        const freed = [];
        for (const g of groups) {
          freed.push(...visibleChildren(g));
          g.replaceWith(...g.childNodes);
        }
        // Path dihitung setelah semua group dilepas, karena posisinya saling menggeser.
        selected.push(...freed.map((el) => ({ artboardId, path: pathOf(el) })));
        setSelectionList(selected);
      });
      emit('structure', artboardId);
    }
  });
}
