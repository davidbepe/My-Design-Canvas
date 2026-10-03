// Group (Ctrl+G) dan Ungroup (Ctrl+Shift+G), seperti group di Figma / pen.dev.
// Ungroup juga melepas FRAME (seperti Figma): frame-nya hilang, isinya pindah ke induk tanpa bergeser.
// Frame utama yang di-ungroup: setiap isinya jadi frame utama sendiri di posisi yang sama.
//
// Di HTML tidak ada elemen "group", jadi group = <div data-group style="display: contents">.
// "display: contents" membuat pembungkusnya tidak punya kotak sendiri: isi group tersusun persis
// seperti sebelum dibungkus. Group hanya merapikan layer; ukurannya = gabungan kotak isinya.
import {
  state, emit, resolve, pathOf, setSelectionList, toast, visibleChildren, getArtboard, docOf, CONTAINER_TAGS, COMPONENT_ROLE,
} from './state.js';
import { recordDoc, group, snapshot } from './history.js';
import { isFree, makeFlow } from './position.js';
import { createArtboardWithHistory, deleteArtboard, nextFrameName } from './actions.js';
import { isAutoLayoutBox, placeFreeAt } from './draw.js';

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

export async function ungroupSelection() {
  const roots = [];
  const byArtboard = new Map();
  for (const ref of state.selected) {
    if (!ref.path.length) { roots.push(ref.artboardId); continue; }
    const el = resolve(ref);
    if (!el || !(isGroup(el) || isFrameBox(el))) continue;
    if (!byArtboard.has(ref.artboardId)) byArtboard.set(ref.artboardId, []);
    byArtboard.get(ref.artboardId).push(el);
  }
  if (!roots.length && !byArtboard.size) return toast('Pilih group atau frame yang berisi elemen');
  const selected = [];
  await group('Ungroup', async () => {
    for (const [artboardId, els] of byArtboard) {
      recordDoc(artboardId, 'Ungroup', () => {
        // Lepas dari yang terdalam dulu, supaya frame bersarang yang sama-sama terpilih tetap benar.
        const freed = [];
        for (const el of [...els].reverse()) {
          if (!el.isConnected) continue;
          freed.push(...(isGroup(el) ? unwrapGroup(el) : unwrapFrame(el)));
        }
        // Path dihitung setelah semua dilepas, karena posisinya saling menggeser.
        selected.push(...freed.filter((el) => el.isConnected).map((el) => ({ artboardId, path: pathOf(el) })));
        setSelectionList(selected);
      });
      emit('structure', artboardId);
    }
    for (const id of roots) selected.push(...await ungroupArtboard(id));
  });
  setSelectionList(selected);
}

// Frame = wadah (div, section, ...) tanpa teks sendiri, bukan instance komponen, dan berisi elemen.
function isFrameBox(el) {
  if (!CONTAINER_TAGS.has(el.tagName) || el.getAttribute(COMPONENT_ROLE) === 'instance') return false;
  if ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) return false;
  return visibleChildren(el).length > 0;
}

function unwrapGroup(g) {
  const kids = visibleChildren(g);
  g.replaceWith(...g.childNodes);
  return kids;
}

// Lepas frame: isinya pindah ke induk di tempat frame tadi, tanpa bergeser di layar.
// - induk auto layout: isinya masuk ke urutan auto layout induk;
// - induk frame biasa: isinya tetap di posisinya (posisi Absolute), ukurannya dikunci.
function unwrapFrame(el) {
  const parent = el.parentElement;
  const kids = visibleChildren(el);
  const rects = kids.map((k) => k.getBoundingClientRect());
  for (const k of kids) el.before(k);
  if (isAutoLayoutBox(parent)) {
    for (const k of kids) {
      if (isFree(k)) { makeFlow(k); k.style.removeProperty('margin'); }
    }
  } else {
    kids.forEach((k, i) => {
      if (!k.style.width) k.style.width = `${round(rects[i].width)}px`;
      if (!k.style.height) k.style.height = `${round(rects[i].height)}px`;
      placeFreeAt(k, { left: rects[i].left, top: rects[i].top });
    });
  }
  el.remove();
  return kids;
}

// Gaya posisi/ukuran yang hanya berarti di dalam frame lain (tidak dibawa ke frame utama baru).
const PLACEMENT = ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'flex-shrink', 'flex-grow', 'flex-basis', 'align-self', 'rotate', 'translate'];

// Lepas frame utama: setiap isinya jadi frame utama sendiri, di posisi & ukuran yang sama di kanvas.
async function ungroupArtboard(id) {
  const a = getArtboard(id);
  const doc = docOf(id);
  const kids = doc?.body ? visibleChildren(doc.body) : [];
  if (!a || !kids.length) {
    toast('Frame utama ini kosong');
    return [];
  }
  const base = snapshot(id);
  const used = [];
  const created = [];
  for (const k of kids) {
    const r = k.getBoundingClientRect();
    const d = new DOMParser().parseFromString(base, 'text/html');
    const name = k.getAttribute('data-name') || nextFrameName(used);
    used.push(name);
    d.title = name;
    if (isFrameBox(k) || (CONTAINER_TAGS.has(k.tagName) && !k.textContent.trim() && k.getAttribute(COMPONENT_ROLE) !== 'instance')) {
      // Frame: gayanya jadi gaya <body> frame utama baru, isinya ikut. (Salinan, supaya elemen
      // aslinya tidak berubah: undo harus bisa mengembalikan frame utama seperti semula.)
      const style = k.cloneNode(false).style;
      for (const prop of PLACEMENT) style.removeProperty(prop);
      d.body.setAttribute('style', `${style.cssText} min-height: 100vh;`.trim());
      d.body.innerHTML = k.innerHTML;
    } else {
      // Teks, gambar, shape: masuk ke frame utama baru seukuran dirinya.
      const clone = d.importNode(k, true);
      for (const prop of ['position', 'left', 'top', 'right', 'bottom', 'margin']) clone.style.removeProperty(prop);
      d.body.removeAttribute('style');
      d.body.replaceChildren(clone);
    }
    const html = `<!doctype html>\n${d.documentElement.outerHTML}\n`;
    const c = await createArtboardWithHistory({
      name, html,
      width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)),
      x: Math.round(a.x + r.left), y: Math.round(a.y + r.top),
    }, 'Ungroup');
    if (c) created.push({ artboardId: c.id, path: [] });
  }
  await deleteArtboard(id);
  return created;
}

const round = (n) => Math.round(n * 100) / 100;
