// State bersama editor + sistem event sederhana supaya modul-modul bisa saling mengabari.
//
// Elemen di dalam artboard dirujuk dengan "ref": { artboardId, path }.
// path = urutan indeks anak dari <body>, mis. [1, 0] = anak ke-2 dari body, lalu anak pertamanya.
// path [] = artboard itu sendiri (body).

export const state = {
  artboards: [],          // dari designs/artboards.json
  nodes: new Map(),       // id artboard -> { el, label, iframe, pending, file }
  view: { x: 0, y: 0, zoom: 1 },
  tool: 'select',         // 'select' | 'hand' | 'frame' | 'text' | bentuk (rect, ellipse, ...) | 'pen' | 'pencil'
  selected: [],           // semua ref yang terpilih (Shift+klik untuk menambah)
  hover: null,            // ref
  // Seleksi "utama" = yang terakhir dipilih. Panel properti menampilkan elemen ini.
  get selection() { return this.selected.at(-1) ?? null; },
};

const listeners = {};
export function on(event, fn) { (listeners[event] ??= []).push(fn); }
export function emit(event, data) { for (const fn of listeners[event] ?? []) fn(data); }

// Tag yang tidak tampil di panel Layers dan tidak bisa dipilih.
export const HIDDEN_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'BR']);

// Tag yang bisa menjadi wadah elemen lain (tempat elemen baru dimasukkan / di-drop di panel Layers).
export const CONTAINER_TAGS = new Set([
  'BODY', 'DIV', 'SECTION', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ARTICLE', 'ASIDE', 'FORM', 'UL', 'OL', 'LI', 'FIGURE',
]);

// Tool yang menggambar kotak dengan drag (frame, teks, bentuk) dan tool vector (klik/garis bebas).
export const DRAW_TOOLS = new Set(['frame', 'text', 'rect', 'ellipse', 'triangle', 'polygon', 'star', 'line', 'arrow']);
export const VECTOR_TOOLS = new Set(['pen', 'pencil']);

// Komponen: master ditandai data-component-role="master", salinannya "instance";
// keduanya berbagi id yang sama di data-component.
export const COMPONENT_ROLE = 'data-component-role';
export const COMPONENT_ID = 'data-component';
export const COMPONENT_NAME = 'data-component-name';

// Salinan sebuah master (lewat duplikat/paste) menjadi instance, bukan master kedua.
export function demoteMasters(root) {
  const masters = root.matches?.(`[${COMPONENT_ROLE}="master"]`) ? [root] : [];
  masters.push(...(root.querySelectorAll?.(`[${COMPONENT_ROLE}="master"]`) ?? []));
  for (const m of masters) m.setAttribute(COMPONENT_ROLE, 'instance');
  return root;
}

export function demoteMastersInHtml(html) {
  if (!html.includes(`${COMPONENT_ROLE}="master"`)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  demoteMasters(doc.documentElement);
  return `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
}

export function setTool(tool) {
  if (state.tool === tool) return;
  state.tool = tool;
  emit('tool');
}

export function toast(message) {
  emit('toast', message);
}

export function getArtboard(id) {
  return state.artboards.find((a) => a.id === id);
}

export function docOf(id) {
  try {
    return state.nodes.get(id)?.iframe?.contentDocument ?? null;
  } catch {
    return null;
  }
}

export function resolve(ref) {
  if (!ref) return null;
  let el = docOf(ref.artboardId)?.body;
  for (const i of ref.path) {
    el = el?.children[i];
    if (!el) return null;
  }
  return el ?? null;
}

export function pathOf(el) {
  const path = [];
  while (el && el.tagName !== 'BODY') {
    const parent = el.parentElement;
    if (!parent) return null;
    path.unshift([...parent.children].indexOf(el));
    el = parent;
  }
  return el ? path : null;
}

export function sameRef(a, b) {
  if (!a || !b) return a === b;
  return a.artboardId === b.artboardId && a.path.join('.') === b.path.join('.');
}

export function visibleChildren(el) {
  return [...el.children].filter((c) => !HIDDEN_TAGS.has(c.tagName));
}

export function isEditableTarget(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable]');
}

export function isSelected(ref) {
  return state.selected.some((r) => sameRef(r, ref));
}

export function setSelection(ref) {
  setSelectionList(ref ? [ref] : []);
}

export function setSelectionList(refs) {
  const unique = [];
  for (const r of refs) if (r && !unique.some((u) => sameRef(u, r))) unique.push(r);
  const same = unique.length === state.selected.length && unique.every((r, i) => sameRef(r, state.selected[i]));
  if (same) return;
  state.selected = unique;
  emit('selection');
}

// Shift+klik: tambahkan ke seleksi, atau keluarkan kalau sudah terpilih.
export function toggleSelection(ref) {
  if (!ref) return;
  setSelectionList(isSelected(ref) ? state.selected.filter((r) => !sameRef(r, ref)) : [...state.selected, ref]);
}

export function setHover(ref) {
  if (sameRef(ref, state.hover)) return;
  state.hover = ref;
  emit('hover');
}
