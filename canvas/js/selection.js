// Interaksi mouse di kanvas: hover, klik untuk memilih, drag & resize artboard, double-click untuk edit.
// Juga menggambar garis biru seleksi dan handle resize.
import {
  state, emit, setHover, setSelection, getArtboard, docOf, resolve, pathOf, sameRef, visibleChildren,
  isEditableTarget, setTool, isSelected, toggleSelection, DRAW_TOOLS, COMPONENT_ROLE,
} from './state.js';
import { toLocal, screenToWorld, worldToScreen, wantsPan, isPanning } from './camera.js';
import { layoutArtboards } from './artboards.js';
import { changeArtboard } from './actions.js';
import { group } from './history.js';
import { isTextLeaf, startTextEdit, finishTextEdit, isEditingText, startRename } from './textedit.js';
import { finishDraw, containerRefAt, artboardAt } from './draw.js';
import { snapRect, showGuidesFor, clearGuides, drawGuides } from './guides.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const DRAG_THRESHOLD = 4;

let hoverBox;
let selBox;
let badge;
let drawBox;
const handleEls = {};
let gesture = null;

export function initSelection(viewportEl, overlayEl) {
  hoverBox = makeEl('ov-box');
  selBox = makeEl('ov-box selected');
  badge = makeEl('size-badge');
  drawBox = makeEl('draw-box');
  overlayEl.append(hoverBox, selBox, badge, drawBox);
  for (const h of HANDLES) {
    handleEls[h] = makeEl(`handle handle-${h}`);
    handleEls[h].dataset.handle = h;
    overlayEl.append(handleEls[h]);
  }

  viewportEl.addEventListener('pointerdown', (e) => onDown(e, viewportEl));
  viewportEl.addEventListener('pointermove', onMove);
  viewportEl.addEventListener('pointerup', onUp);
  viewportEl.addEventListener('pointercancel', () => { gesture = null; });
  viewportEl.addEventListener('pointerleave', () => { if (!gesture) setHover(null); });
  viewportEl.addEventListener('dblclick', onDoubleClick);
  addEventListener('keydown', onKey);
}

// ---------- Gesture mouse ----------

function onDown(e, viewportEl) {
  if (e.button !== 0 || wantsPan(e)) return;
  if (isEditableTarget(e.target)) return; // sedang mengganti nama artboard
  finishTextEdit();

  if (DRAW_TOOLS.has(state.tool)) {
    const { sx, sy } = toLocal(e);
    const p = screenToWorld(sx, sy);
    gesture = { kind: 'draw', tool: state.tool, px: e.clientX, py: e.clientY, start: p, end: p };
    setHover(null);
    viewportEl.setPointerCapture(e.pointerId);
    return;
  }

  const sel = state.selection;
  const handle = e.target.dataset?.handle;
  if (handle && sel && !sel.path.length) {
    gesture = { kind: 'resize', handle, ...start(e, sel.artboardId) };
  } else {
    const hit = hitTest(e);
    const onLabel = !!labelAt(e);
    const inSelectedArtboard = hit && isSelected({ artboardId: hit.artboardId, path: [] });
    // Artboard bisa digeser lewat namanya, atau dari dalam artboard yang sedang terpilih.
    const movable = hit && (onLabel || inSelectedArtboard) ? hit.artboardId : null;
    gesture = { kind: 'click', hit, movable, shift: e.shiftKey, ...start(e, movable) };
  }
  viewportEl.setPointerCapture(e.pointerId);
}

function start(e, artboardId) {
  const a = artboardId && getArtboard(artboardId);
  return {
    px: e.clientX,
    py: e.clientY,
    artboardId,
    from: a ? { x: a.x, y: a.y, width: a.width, height: a.height } : null,
  };
}

function onMove(e) {
  if (!gesture) {
    if (!isPanning() && !e.buttons && !isEditingText()) setHover(hoverTarget(e));
    return;
  }

  if (gesture.kind === 'draw') {
    const { sx, sy } = toLocal(e);
    gesture.end = screenToWorld(sx, sy);
    // Frame di luar artboard = artboard baru: sudutnya menempel ke tepi artboard lain.
    if (gesture.tool === 'frame' && !artboardAt(gesture.start.x, gesture.start.y) && !e.ctrlKey) {
      const { dx, dy } = snapRect({ ...gesture.end, w: 0, h: 0 }, new Set(), { xEdges: ['l'], yEdges: ['t'] });
      gesture.end = { x: gesture.end.x + dx, y: gesture.end.y + dy };
      showGuidesFor(drawRect(), new Set());
    }
    drawDrawBox();
    return;
  }
  const z = state.view.zoom;
  const dx = (e.clientX - gesture.px) / z;
  const dy = (e.clientY - gesture.py) / z;

  if (gesture.kind === 'click') {
    if (!gesture.movable || Math.hypot(e.clientX - gesture.px, e.clientY - gesture.py) < DRAG_THRESHOLD) return;
    gesture.kind = 'move';
    setHover(null);
    // Kalau artboard yang di-drag ikut terpilih bersama artboard lain, geser semuanya.
    const root = { artboardId: gesture.movable, path: [] };
    if (!isSelected(root)) setSelection(root);
    gesture.group = state.selected
      .filter((r) => !r.path.length)
      .map((r) => getArtboard(r.artboardId))
      .filter(Boolean)
      .map((b) => ({ id: b.id, from: { x: b.x, y: b.y }, w: b.width, h: b.height }));
  }

  if (gesture.kind === 'move') {
    // Kotak gabungan semua artboard yang digeser, lalu tempelkan ke tepi/tengah artboard lain.
    const ids = new Set(gesture.group.map((g) => g.id));
    const x0 = Math.min(...gesture.group.map((g) => g.from.x)) + dx;
    const y0 = Math.min(...gesture.group.map((g) => g.from.y)) + dy;
    const bbox = {
      x: Math.round(x0),
      y: Math.round(y0),
      w: Math.max(...gesture.group.map((g) => g.from.x + g.w)) + dx - x0,
      h: Math.max(...gesture.group.map((g) => g.from.y + g.h)) + dy - y0,
    };
    const snap = e.ctrlKey ? { dx: 0, dy: 0 } : snapRect(bbox, ids);
    for (const { id, from } of gesture.group) {
      const b = getArtboard(id);
      if (!b) continue;
      b.x = Math.round(from.x + dx + snap.dx);
      b.y = Math.round(from.y + dy + snap.dy);
    }
    showGuidesFor({ ...bbox, x: bbox.x + Math.round(snap.dx), y: bbox.y + Math.round(snap.dy) }, ids);
    layoutArtboards();
    return;
  }

  const a = getArtboard(gesture.artboardId);
  if (!a) return;
  const f = gesture.from;
  if (gesture.kind === 'resize') {
    const h = gesture.handle;
    if (h.includes('e')) a.width = Math.max(1, Math.round(f.width + dx));
    if (h.includes('s')) a.height = Math.max(1, Math.round(f.height + dy));
    if (h.includes('w')) {
      a.width = Math.max(1, Math.round(f.width - dx));
      a.x = f.x + f.width - a.width;
    }
    if (h.includes('n')) {
      a.height = Math.max(1, Math.round(f.height - dy));
      a.y = f.y + f.height - a.height;
    }
    // Hanya tepi yang sedang ditarik yang menempel ke artboard lain.
    const ids = new Set([a.id]);
    if (!e.ctrlKey) {
      const xEdges = h.includes('e') ? ['r'] : h.includes('w') ? ['l'] : [];
      const yEdges = h.includes('s') ? ['b'] : h.includes('n') ? ['t'] : [];
      const snap = snapRect({ x: a.x, y: a.y, w: a.width, h: a.height }, ids, { xEdges, yEdges });
      const sx = Math.round(snap.dx);
      const sy = Math.round(snap.dy);
      if (h.includes('e')) a.width = Math.max(1, a.width + sx);
      if (h.includes('w')) { a.x += sx; a.width = Math.max(1, a.width - sx); }
      if (h.includes('s')) a.height = Math.max(1, a.height + sy);
      if (h.includes('n')) { a.y += sy; a.height = Math.max(1, a.height - sy); }
    }
    showGuidesFor({ x: a.x, y: a.y, w: a.width, h: a.height }, ids);
  }
  layoutArtboards();
}

function onUp(e) {
  const g = gesture;
  gesture = null;
  if (!g) return;
  clearGuides();
  drawOverlay();
  if (g.kind === 'draw') {
    drawBox.hidden = true;
    const dragged = Math.hypot(e.clientX - g.px, e.clientY - g.py) >= DRAG_THRESHOLD;
    finishDraw(g.tool, g.start, g.end, dragged);
    return;
  }
  if (g.kind === 'click') {
    if (g.shift) toggleSelection(g.hit);
    else setSelection(g.hit);
    return;
  }
  if (g.kind === 'move') {
    group('Pindah artboard', () => {
      for (const { id, from } of g.group) {
        const b = getArtboard(id);
        if (b) changeArtboard(id, { x: b.x, y: b.y }, 'Pindah artboard', from);
      }
    });
    emit('artboards');
    return;
  }
  const a = getArtboard(g.artboardId);
  if (!a) return;
  const keys = ['x', 'y', 'width', 'height'];
  const before = Object.fromEntries(keys.map((k) => [k, g.from[k]]));
  const after = Object.fromEntries(keys.map((k) => [k, a[k]]));
  changeArtboard(a.id, after, 'Ubah ukuran artboard', before);
  emit('artboards');
}

function hoverTarget(e) {
  if (state.tool === 'select') return hitTest(e);
  if (DRAW_TOOLS.has(state.tool)) {
    const { sx, sy } = toLocal(e);
    const p = screenToWorld(sx, sy);
    return containerRefAt(p.x, p.y); // tandai wadah tempat elemen baru akan masuk
  }
  return null;
}

function drawRect() {
  const { start, end } = gesture;
  return {
    x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y),
  };
}

// Kotak putus-putus selama menggambar, plus ukurannya.
function drawDrawBox() {
  const rect = drawRect();
  drawGuides(rectOf);
  const screen = place(drawBox, rect);
  badge.hidden = false;
  badge.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  badge.style.left = `${screen.x + screen.w / 2}px`;
  badge.style.top = `${screen.y + screen.h + 8}px`;
}

// Saat mouse ditekan, kanvas "menangkap" pointer (supaya drag mulus), sehingga e.target
// untuk click/dblclick selalu kanvas. Jadi cari label langsung dari posisi mouse.
function labelAt(e) {
  return document.elementFromPoint(e.clientX, e.clientY)?.closest('.artboard-label') ?? null;
}

function onDoubleClick(e) {
  if (state.tool !== 'select' || isEditableTarget(e.target)) return;
  const label = labelAt(e);
  if (label) return startRename(label.parentElement.dataset.id);
  const hit = hitTest(e);
  if (hit?.path.length && isTextLeaf(resolve(hit))) {
    setSelection(hit);
    startTextEdit(hit);
  }
}

// Cari elemen di bawah kursor: tentukan artboard-nya, lalu tanya dokumen di dalam iframe.
function hitTest(e) {
  const label = labelAt(e);
  if (label) return { artboardId: label.parentElement.dataset.id, path: [] };

  const { sx, sy } = toLocal(e);
  const p = screenToWorld(sx, sy);
  for (let i = state.artboards.length - 1; i >= 0; i--) {
    const a = state.artboards[i];
    if (p.x < a.x || p.y < a.y || p.x > a.x + a.width || p.y > a.y + a.height) continue;
    const root = { artboardId: a.id, path: [] };
    const doc = docOf(a.id);
    let target = doc?.elementFromPoint(p.x - a.x, p.y - a.y);
    if (!target || target === doc.body || target === doc.documentElement) return root;
    target = target.closest('svg') ?? target; // ikon SVG dipilih utuh, bukan per garis
    target = target.closest(`[${COMPONENT_ROLE}="instance"]`) ?? target; // instance komponen dipilih utuh
    const path = pathOf(target);
    return path ? { artboardId: a.id, path } : root;
  }
  return null;
}

// Shortcut navigasi ala Figma: Esc = batal pilih, Enter = masuk ke anak (atau edit teks),
// Shift+Enter = naik ke induk.
function onKey(e) {
  if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey) return;
  if (e.key === 'Escape' && DRAW_TOOLS.has(state.tool)) { setTool('select'); return; } // batal menggambar
  if (!state.selection) return;
  const { artboardId, path } = state.selection;
  if (e.key === 'Escape') {
    setSelection(path.length ? { artboardId, path: path.slice(0, -1) } : null);
  } else if (e.key === 'Enter' && e.shiftKey) {
    if (path.length) setSelection({ artboardId, path: path.slice(0, -1) });
  } else if (e.key === 'Enter') {
    const el = resolve(state.selection);
    if (path.length && isTextLeaf(el)) {
      startTextEdit(state.selection);
    } else {
      // Jangan masuk ke dalam ikon SVG atau instance komponen (isinya diatur oleh master).
      const leaf = el && (el.tagName.toLowerCase() === 'svg' || el.getAttribute(COMPONENT_ROLE) === 'instance');
      const child = el && !leaf ? visibleChildren(el)[0] : null;
      if (child) setSelection({ artboardId, path: [...path, [...el.children].indexOf(child)] });
    }
  } else {
    return;
  }
  e.preventDefault();
}

// ---------- Overlay ----------

// Kotak elemen dalam koordinat "world" (koordinat kanvas sebelum zoom).
export function rectOf(ref) {
  if (!ref) return null;
  const a = getArtboard(ref.artboardId);
  if (!a) return null;
  if (!ref.path.length) return { x: a.x, y: a.y, w: a.width, h: a.height };
  const el = resolve(ref);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: a.x + r.left, y: a.y + r.top, w: r.width, h: r.height };
}

function place(boxEl, rect) {
  if (!rect) { boxEl.hidden = true; return null; }
  const p = worldToScreen(rect.x, rect.y);
  const z = state.view.zoom;
  const screen = { x: p.x, y: p.y, w: rect.w * z, h: rect.h * z };
  Object.assign(boxEl.style, {
    left: `${screen.x}px`, top: `${screen.y}px`, width: `${screen.w}px`, height: `${screen.h}px`,
  });
  boxEl.hidden = false;
  return screen;
}

// Kotak biru untuk elemen terpilih tambahan (multi-select). Dibuat sesuai kebutuhan.
const extraBoxes = [];
function extraBox(i) {
  if (!extraBoxes[i]) {
    extraBoxes[i] = makeEl('ov-box selected');
    selBox.before(extraBoxes[i]);
  }
  return extraBoxes[i];
}

export function drawOverlay() {
  // Garis merah (smart guides / pengukur Alt). Saat mengukur, kotak hover biru diganti kotak merah.
  const measuring = drawGuides(rectOf);
  const showHover = !isEditingText() && !measuring && !isSelected(state.hover);
  place(hoverBox, showHover ? rectOf(state.hover) : null);

  const others = state.selected.slice(0, -1);
  others.forEach((ref, i) => place(extraBox(i), rectOf(ref)));
  for (let i = others.length; i < extraBoxes.length; i++) extraBoxes[i].hidden = true;

  const rect = rectOf(state.selection);
  const screen = place(selBox, rect);
  badge.hidden = !screen;
  if (screen) {
    const count = state.selected.length;
    badge.textContent = count > 1 ? `${count} dipilih` : `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
    badge.style.left = `${screen.x + screen.w / 2}px`;
    badge.style.top = `${screen.y + screen.h + 8}px`;
  }

  // Handle resize hanya untuk satu artboard (elemen di dalamnya diatur lewat layout).
  const showHandles = screen && state.selected.length === 1 && !state.selection.path.length;
  for (const h of HANDLES) {
    const el = handleEls[h];
    el.hidden = !showHandles;
    if (!showHandles) continue;
    const x = screen.x + (h.includes('w') ? 0 : h.includes('e') ? screen.w : screen.w / 2);
    const y = screen.y + (h.includes('n') ? 0 : h.includes('s') ? screen.h : screen.h / 2);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  for (const [id, node] of state.nodes) {
    node.el.classList.toggle('is-selected', isSelected({ artboardId: id, path: [] }));
  }
}

// Ringkasan semua elemen terpilih untuk Claude (tool get_selection).
export function describeSelection() {
  return state.selected.map(describeRef).filter(Boolean);
}

function describeRef(ref) {
  const a = getArtboard(ref.artboardId);
  const el = resolve(ref);
  if (!a || !el) return null;
  const r = ref.path.length ? el.getBoundingClientRect() : { left: 0, top: 0, width: a.width, height: a.height };
  let html = el.outerHTML;
  if (html.length > 6000) html = `${html.slice(0, 6000)}\n<!-- …dipotong, pakai get_dom untuk lengkapnya -->`;
  return {
    artboardId: a.id,
    artboardName: a.name,
    selector: selectorOf(ref),
    tag: el.tagName.toLowerCase(),
    text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 200),
    box: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
    html,
  };
}

export function selectorOf(ref) {
  let el = docOf(ref.artboardId).body;
  const parts = ['body'];
  for (const i of ref.path) {
    el = el.children[i];
    parts.push(`${el.tagName.toLowerCase()}:nth-child(${i + 1})`);
  }
  return parts.join(' > ');
}

function makeEl(className) {
  const el = document.createElement('div');
  el.className = className;
  el.hidden = true;
  return el;
}
