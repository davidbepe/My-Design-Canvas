// Panel Layers: struktur elemen setiap artboard, seperti panel Layers di Figma.
// Layer bisa di-drag untuk mengubah urutan atau memindahkannya ke dalam frame lain.
import {
  state, emit, on, setHover, setSelection, toggleSelection, isSelected, docOf, resolve, pathOf, sameRef, visibleChildren,
  HIDDEN_TAGS, CONTAINER_TAGS, COMPONENT_ROLE, COMPONENT_NAME,
} from './state.js';
import { recordDoc } from './history.js';
import { changeArtboard } from './actions.js';
import { renameComponent } from './components.js';
import { SHAPE_LABELS } from './shapes.js';

const ICONS = {
  artboard: '<svg viewBox="0 0 14 14"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11"/></svg>',
  frame: '<svg viewBox="0 0 14 14"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11"/></svg>',
  'auto-v': '<svg viewBox="0 0 14 14"><rect x="3" y="1.5" width="8" height="3" rx=".6"/><rect x="3" y="5.5" width="8" height="3" rx=".6"/><rect x="3" y="9.5" width="8" height="3" rx=".6"/></svg>',
  'auto-h': '<svg viewBox="0 0 14 14"><rect x="1.5" y="3" width="3" height="8" rx=".6"/><rect x="5.5" y="3" width="3" height="8" rx=".6"/><rect x="9.5" y="3" width="3" height="8" rx=".6"/></svg>',
  grid: '<svg viewBox="0 0 14 14"><rect x="2" y="2" width="4" height="4" rx=".6"/><rect x="8" y="2" width="4" height="4" rx=".6"/><rect x="2" y="8" width="4" height="4" rx=".6"/><rect x="8" y="8" width="4" height="4" rx=".6"/></svg>',
  text: '<svg viewBox="0 0 14 14"><path d="M3 3.5h8M7 3.5v8"/></svg>',
  image: '<svg viewBox="0 0 14 14"><rect x="2" y="2.5" width="10" height="9" rx="1"/><path d="M2.5 10l3-3 2.5 2.5 1.5-1.5 2 2"/></svg>',
  input: '<svg viewBox="0 0 14 14"><rect x="1.5" y="4" width="11" height="6" rx="1"/><path d="M4 5.8v2.4"/></svg>',
  shape: '<svg viewBox="0 0 14 14"><path d="M7 2l5 9H2z"/></svg>',
  vector: '<svg viewBox="0 0 14 14"><path d="M2 11c2-1 2.5-5 5-5s3 3 5 1"/><circle cx="2" cy="11" r="1"/><circle cx="12" cy="7" r="1"/></svg>',
  group: '<svg viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="1" stroke-dasharray="2 1.6"/></svg>',
  master: '<svg viewBox="0 0 14 14" class="comp"><path d="M7 1.5L12.5 7 7 12.5 1.5 7z" fill="currentColor"/></svg>',
  instance: '<svg viewBox="0 0 14 14" class="comp"><path d="M7 1.8L12.2 7 7 12.2 1.8 7z"/></svg>',
};
const CARET = '<svg viewBox="0 0 8 8"><path d="M2 1l4 3-4 3z"/></svg>';

const INDENT = 14;

let container;
let dropLine;
let rows = [];
let drag = null; // { ref, row, startY, active, drop }
let lastClick = null; // { key, time }: untuk mengenali double-click (baris digambar ulang di antara klik)
const DOUBLE_CLICK_MS = 400;
const expanded = new Set();
const knownArtboards = new Set();

const keyOf = (ref) => `${ref.artboardId}:${ref.path.join('.')}`;

export function initLayers(el) {
  container = el;
  // Buka layer tertentu di panel (mis. setelah Shift+A membungkus elemen), supaya hasilnya terlihat.
  on('expand-layers', (refs) => {
    for (const ref of refs) expanded.add(keyOf(ref));
    renderLayers();
  });
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
    // Ikon frame utama juga menunjukkan jenisnya: # (frame biasa) atau tumpukan (auto layout).
    const info = { icon: body ? layoutIcon(body) : 'frame', name: a.name, meta: `${a.width}×${a.height}`, artboard: true };
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
    if (e.button !== 0 || e.target.closest('.layer-caret') || e.target.isContentEditable) return;
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
      // Double-click = ganti nama. Dicek manual, karena klik pertama memilih layer dan panel digambar
      // ulang, sehingga browser tidak selalu mengenali dua klik itu sebagai double-click.
      const key = keyOf(ref);
      const now = performance.now();
      if (!d.shift && lastClick?.key === key && now - lastClick.time < DOUBLE_CLICK_MS) {
        lastClick = null;
        startLayerRename(ref, row);
        return;
      }
      lastClick = { key, time: now };
      if (d.shift) toggleSelection(ref);
      else setSelection(ref);
    }
    else if (d.drop) applyDrop(d.ref, d.drop);
  });
  row.addEventListener('pointercancel', endDrag);
  frag.append(row);
  rows.push({ ref, el: row, depth, hasKids, expanded: hasKids && expanded.has(keyOf(ref)) });
}

// ---------- Ganti nama (double-click) ----------
// Frame utama: nama di manifest. Master komponen: nama komponen. Elemen lain: atribut data-name.
function startLayerRename(ref, row) {
  const el = ref.path.length ? resolve(ref) : null;
  if (el?.getAttribute(COMPONENT_ROLE) === 'instance') return; // nama salinan mengikuti master
  const nameEl = row.querySelector('.layer-name');
  const original = nameEl.textContent;
  nameEl.setAttribute('contenteditable', 'plaintext-only');
  nameEl.classList.add('editing');
  nameEl.focus();
  getSelection().selectAllChildren(nameEl);
  const done = (save) => {
    nameEl.removeEventListener('keydown', onKey);
    nameEl.removeEventListener('blur', onBlur);
    nameEl.removeAttribute('contenteditable');
    nameEl.classList.remove('editing');
    const name = nameEl.textContent.trim();
    if (!save || !name || name === original) {
      nameEl.textContent = original;
      return;
    }
    if (!el) {
      changeArtboard(ref.artboardId, { name }, 'Ganti nama frame');
    } else if (el.getAttribute(COMPONENT_ROLE) === 'master') {
      renameComponent(ref, name);
    } else {
      recordDoc(ref.artboardId, 'Ganti nama layer', () => el.setAttribute('data-name', name));
      emit('structure', ref.artboardId);
    }
  };
  const onKey = (e) => {
    e.stopPropagation(); // Enter/Esc/Delete jangan ikut memicu shortcut kanvas
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  };
  const onBlur = () => done(true);
  nameEl.addEventListener('keydown', onKey);
  nameEl.addEventListener('blur', onBlur);
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
const isLeaf = (el) => el.tagName.toLowerCase() === 'svg' || el.getAttribute(COMPONENT_ROLE) === 'instance' || isRichText(el);

// Teks bercampur gaya, mis. <p>Belum punya akun? <a>Daftar</a></p>: satu layer teks (seperti teks
// dengan gaya campuran di Figma), bukan frame berisi potongan-potongannya.
const INLINE_TAGS = new Set(['A', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'SMALL', 'MARK', 'CODE', 'SPAN', 'SUB', 'SUP', 'BR', 'ABBR', 'TIME']);
function isRichText(el) {
  if (!el.children.length) return false;
  const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  return ownText && [...el.children].every((c) => INLINE_TAGS.has(c.tagName) && !c.children.length);
}

// Nama layer ala Figma: layer teks dinamai sesuai isinya, sisanya pakai id/class/tag.
function describe(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute(COMPONENT_ROLE);
  if (role === 'master' || role === 'instance') {
    return { icon: role, name: el.getAttribute(COMPONENT_NAME) || 'Komponen', meta: role === 'master' ? 'master' : '' };
  }
  if (el.hasAttribute('data-group')) return { icon: 'group', name: 'Group', meta: '' };
  const shape = el.getAttribute('data-shape');
  if (shape) return { icon: 'shape', name: SHAPE_LABELS[shape] ?? 'Shape', meta: 'svg' };
  if (el.getAttribute('data-vector')) return { icon: 'vector', name: 'Vector', meta: el.getAttribute('data-vector') };
  if (tag === 'div' && (el.classList.contains('rect') || el.classList.contains('ellipse'))) {
    return { icon: 'shape', name: el.classList.contains('ellipse') ? 'Ellipse' : 'Rectangle', meta: 'div' };
  }
  if (['img', 'svg', 'picture', 'video', 'canvas'].includes(tag)) {
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.id || el.classList[0] || tag;
    return { icon: 'image', name: label, meta: tag };
  }
  if (['input', 'textarea', 'select'].includes(tag)) {
    return { icon: 'input', name: el.getAttribute('placeholder') || el.getAttribute('name') || tag, meta: tag };
  }
  const text = el.textContent.trim().replace(/\s+/g, ' ');
  if ((el.children.length === 0 || isRichText(el)) && text) return { icon: 'text', name: text.slice(0, 40), meta: tag };
  // Nama: data-name (mis. nama artboard yang dimasukkan), id, atau class. Frame tanpa nama khusus
  // dinamai sesuai jenisnya, supaya frame biasa dan auto layout mudah dibedakan.
  const icon = layoutIcon(el);
  const cls = el.classList[0];
  const generic = !el.id && (!cls || cls === 'frame') && tag === 'div';
  const name = el.getAttribute('data-name') || (generic ? LAYOUT_NAMES[icon] : el.id || cls || tag);
  return { icon, name, meta: name === tag ? '' : tag };
}

const LAYOUT_NAMES = { frame: 'Frame', 'auto-v': 'Auto layout', 'auto-h': 'Auto layout', grid: 'Grid' };

// Frame biasa (#) atau auto layout (tumpukan vertikal/horizontal), seperti ikon layer di Figma.
function layoutIcon(el) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  if (cs.display.includes('grid')) return 'grid';
  if (cs.display.includes('flex')) return cs.flexDirection.startsWith('row') ? 'auto-h' : 'auto-v';
  return 'frame';
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}
