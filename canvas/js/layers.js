// Panel Layers: struktur elemen setiap artboard, seperti panel Layers di Figma.
// Layer bisa di-drag untuk mengubah urutan atau memindahkannya ke dalam frame lain.
import {
  state, emit, setHover, setSelection, toggleSelection, isSelected, docOf, resolve, pathOf, sameRef, visibleChildren,
  HIDDEN_TAGS, CONTAINER_TAGS, COMPONENT_ROLE, COMPONENT_NAME,
} from './state.js';
import { recordDoc } from './history.js';

const ICONS = {
  artboard: '<svg viewBox="0 0 14 14"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11"/></svg>',
  frame: '<svg viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" rx="1"/></svg>',
  text: '<svg viewBox="0 0 14 14"><path d="M3 3.5h8M7 3.5v8"/></svg>',
  image: '<svg viewBox="0 0 14 14"><rect x="2" y="2.5" width="10" height="9" rx="1"/><path d="M2.5 10l3-3 2.5 2.5 1.5-1.5 2 2"/></svg>',
  input: '<svg viewBox="0 0 14 14"><rect x="1.5" y="4" width="11" height="6" rx="1"/><path d="M4 5.8v2.4"/></svg>',
  master: '<svg viewBox="0 0 14 14" class="comp"><path d="M7 1.5L12.5 7 7 12.5 1.5 7z" fill="currentColor"/></svg>',
  instance: '<svg viewBox="0 0 14 14" class="comp"><path d="M7 1.8L12.2 7 7 12.2 1.8 7z"/></svg>',
};
const CARET = '<svg viewBox="0 0 8 8"><path d="M2 1l4 3-4 3z"/></svg>';

const INDENT = 14;

let container;
let dropLine;
let rows = [];
let drag = null; // { ref, row, startY, active, drop }
const expanded = new Set();
const knownArtboards = new Set();

const keyOf = (ref) => `${ref.artboardId}:${ref.path.join('.')}`;

export function initLayers(el) {
  container = el;
  container.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
  dropLine = document.createElement('div');
  dropLine.className = 'drop-line';
  dropLine.hidden = true;
}

// reveal: buka induk-induk elemen terpilih dan gulir supaya kelihatan.
export function renderLayers({ reveal = false } = {}) {
  for (const a of state.artboards) {
    if (!knownArtboards.has(a.id)) {
      knownArtboards.add(a.id);
      expanded.add(keyOf({ artboardId: a.id, path: [] }));
    }
  }
  if (reveal && state.selection) expandTo(state.selection);

  const frag = document.createDocumentFragment();
  rows = [];
  for (const a of state.artboards) {
    const ref = { artboardId: a.id, path: [] };
    const body = docOf(a.id)?.body;
    const info = { icon: 'artboard', name: a.name, meta: `${a.width}×${a.height}`, artboard: true };
    addRow(frag, ref, 0, info, !!body && visibleChildren(body).length > 0);
    if (body && expanded.has(keyOf(ref))) walk(frag, body, ref, 1);
  }
  container.replaceChildren(frag, dropLine);
  highlightLayers();
  if (reveal) rows.find((r) => sameRef(r.ref, state.selection))?.el.scrollIntoView({ block: 'nearest' });
}

export function highlightLayers() {
  for (const r of rows) {
    r.el.classList.toggle('selected', isSelected(r.ref));
    r.el.classList.toggle('hovered', sameRef(r.ref, state.hover));
  }
}

function walk(frag, parentEl, parentRef, depth) {
  [...parentEl.children].forEach((child, i) => {
    if (HIDDEN_TAGS.has(child.tagName)) return;
    const ref = { artboardId: parentRef.artboardId, path: [...parentRef.path, i] };
    const kids = isLeaf(child) ? [] : visibleChildren(child);
    addRow(frag, ref, depth, describe(child), kids.length > 0);
    if (kids.length && expanded.has(keyOf(ref))) walk(frag, child, ref, depth + 1);
  });
}

function addRow(frag, ref, depth, info, hasKids) {
  const row = document.createElement('div');
  row.className = `layer-row${info.artboard ? ' is-artboard' : ''}`;
  row.style.paddingLeft = `${6 + depth * INDENT}px`;

  const caret = span('layer-caret');
  if (hasKids) {
    caret.innerHTML = CARET;
    caret.classList.toggle('open', expanded.has(keyOf(ref)));
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = keyOf(ref);
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      renderLayers();
    });
  }
  const icon = span('layer-icon');
  icon.innerHTML = ICONS[info.icon];
  row.append(caret, icon, span('layer-name', info.name));
  if (info.meta) row.append(span('layer-meta', info.meta));

  row.addEventListener('pointerenter', () => { if (!drag) setHover(ref); });
  row.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.layer-caret')) return;
    drag = { ref, row, startY: e.clientY, active: false, drop: null, shift: e.shiftKey };
    row.setPointerCapture(e.pointerId);
  });
  row.addEventListener('pointermove', (e) => {
    if (!drag || drag.row !== row) return;
    // Artboard tidak bisa di-drag di sini; hanya elemen di dalamnya.
    if (!drag.active && ref.path.length && Math.abs(e.clientY - drag.startY) > 4) {
      drag.active = true;
      row.classList.add('dragging');
      setHover(null);
    }
    if (drag.active) updateDrop(e.clientY);
  });
  row.addEventListener('pointerup', () => {
    if (!drag || drag.row !== row) return;
    const d = drag;
    endDrag();
    if (!d.active) {
      if (d.shift) toggleSelection(ref);
      else setSelection(ref);
    }
    else if (d.drop) applyDrop(d.ref, d.drop);
  });
  row.addEventListener('pointercancel', endDrag);
  frag.append(row);
  rows.push({ ref, el: row, depth, hasKids, expanded: hasKids && expanded.has(keyOf(ref)) });
}

// ---------- Drag untuk mengubah urutan ----------

// Tentukan posisi drop dari posisi mouse: sebelum, sesudah, atau di dalam layer yang ditunjuk.
function updateDrop(clientY) {
  drag.drop = null;
  dropLine.hidden = true;
  for (const r of rows) r.el.classList.remove('drop-inside');

  const target = rows.find((r) => {
    const b = r.el.getBoundingClientRect();
    return clientY >= b.top && clientY < b.bottom;
  });
  if (!target || target.ref.artboardId !== drag.ref.artboardId || isInside(target.ref, drag.ref)) return;

  const b = target.el.getBoundingClientRect();
  const t = (clientY - b.top) / b.height;
  const isRoot = !target.ref.path.length;
  const canContain = isRoot || CONTAINER_TAGS.has(resolve(target.ref)?.tagName);
  let pos;
  if (isRoot) pos = 'inside';
  else if (canContain) pos = t < 0.25 ? 'before' : t > 0.75 ? 'after' : 'inside';
  else pos = t < 0.5 ? 'before' : 'after';
  // "Sesudah" frame yang sedang terbuka secara visual = anak pertamanya.
  if (pos === 'after' && target.expanded) pos = 'prepend';

  drag.drop = { ref: target.ref, pos };
  if (pos === 'inside') {
    target.el.classList.add('drop-inside');
  } else {
    const depth = pos === 'prepend' ? target.depth + 1 : target.depth;
    dropLine.style.top = `${target.el.offsetTop + (pos === 'before' ? 0 : target.el.offsetHeight) - 1}px`;
    dropLine.style.left = `${6 + depth * INDENT + 18}px`;
    dropLine.hidden = false;
  }
}

// Apakah `ref` sama dengan, atau berada di dalam, `ancestor`?
function isInside(ref, ancestor) {
  return ancestor.path.length <= ref.path.length && ancestor.path.every((v, i) => ref.path[i] === v);
}

function applyDrop(ref, { ref: targetRef, pos }) {
  const el = resolve(ref);
  const target = resolve(targetRef);
  if (!el || !target) return;
  recordDoc(ref.artboardId, 'Pindah layer', () => {
    if (pos === 'before') target.before(el);
    else if (pos === 'after') target.after(el);
    else if (pos === 'prepend') target.prepend(el);
    else target.append(el);
    if (pos === 'inside' || pos === 'prepend') expanded.add(keyOf(targetRef));
    setSelection({ artboardId: ref.artboardId, path: pathOf(el) });
  });
  emit('structure', ref.artboardId);
}

function endDrag() {
  if (drag) drag.row.classList.remove('dragging');
  drag = null;
  dropLine.hidden = true;
  for (const r of rows) r.el.classList.remove('drop-inside');
}

function expandTo(ref) {
  expanded.add(keyOf({ artboardId: ref.artboardId, path: [] }));
  for (let i = 1; i < ref.path.length; i++) {
    expanded.add(keyOf({ artboardId: ref.artboardId, path: ref.path.slice(0, i) }));
  }
}

// Ikon SVG dan instance komponen tampil sebagai satu layer (isinya tidak dibuka).
const isLeaf = (el) => el.tagName.toLowerCase() === 'svg' || el.getAttribute(COMPONENT_ROLE) === 'instance';

// Nama layer ala Figma: layer teks dinamai sesuai isinya, sisanya pakai id/class/tag.
function describe(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute(COMPONENT_ROLE);
  if (role === 'master' || role === 'instance') {
    return { icon: role, name: el.getAttribute(COMPONENT_NAME) || 'Komponen', meta: role === 'master' ? 'master' : '' };
  }
  if (['img', 'svg', 'picture', 'video', 'canvas'].includes(tag)) {
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.id || el.classList[0] || tag;
    return { icon: 'image', name: label, meta: tag };
  }
  if (['input', 'textarea', 'select'].includes(tag)) {
    return { icon: 'input', name: el.getAttribute('placeholder') || el.getAttribute('name') || tag, meta: tag };
  }
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  if (el.children.length === 0 && text) return { icon: 'text', name: text.slice(0, 40), meta: tag };
  const name = el.id || el.classList[0] || tag;
  return { icon: 'frame', name, meta: name === tag ? '' : tag };
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}
