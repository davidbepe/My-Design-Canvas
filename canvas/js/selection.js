// Interaksi mouse di kanvas: hover, klik untuk memilih, drag & resize artboard, double-click untuk edit.
// Juga menggambar garis biru seleksi dan handle resize.
import {
  state, emit, setHover, setSelection, getArtboard, docOf, resolve, pathOf, sameRef, visibleChildren,
  isEditableTarget, setTool, isSelected, toggleSelection, DRAW_TOOLS, VECTOR_TOOLS, COMPONENT_ROLE,
} from './state.js';
import { toLocal, screenToWorld, worldToScreen, wantsPan, isPanning } from './camera.js';
import { layoutArtboards } from './artboards.js';
import { changeArtboard } from './actions.js';
import { group, captureDoc, snapshot, pushDoc } from './history.js';
import { isTextLeaf, startTextEdit, finishTextEdit, isEditingText, startRename } from './textedit.js';
import { finishDraw, containerRefAt, artboardAt } from './draw.js';
import {
  snapRect, snapMove, artboardBoxes, showGuidesFor, clearGuides, drawGuides,
} from './guides.js';
import {
  vectorDown, vectorMove, vectorUp, vectorDoubleClick, isDrawingVector, redrawVector,
} from './vector.js';
import { isFree, freePosition, rotationOf } from './position.js';
import { isGroup, isMovableGroup, freeLeaves, boxOf } from './group.js';
import {
  isEditingVector, canEditVector, startVectorEdit, stopVectorEdit, vectorEditDown, vectorEditMove, vectorEditUp,
  vectorEditDoubleClick, redrawVectorEdit,
} from './vectoredit.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const DRAG_THRESHOLD = 4;

let hoverBox;
let selBox;
let badge;
let drawBox;
let rotHandle;
const handleEls = {};
let gesture = null;

export function initSelection(viewportEl, overlayEl) {
  hoverBox = makeEl('ov-box');
  selBox = makeEl('ov-box selected');
  badge = makeEl('size-badge');
  drawBox = makeEl('draw-box');
  rotHandle = makeEl('rotate-handle');
  rotHandle.dataset.rotate = '1';
  rotHandle.title = 'Drag untuk memutar (Shift = kelipatan 15°)';
  // Garis hover/seleksi dan handle digambar DI DALAM world (lapisan yang sama dengan artboard),
  // bukan di lapisan terpisah di atasnya. Browser kadang membulatkan posisi lapisan artboard
  // berbeda dari lapisan lain (terutama saat digambar GPU), sehingga garis bisa meleset beberapa
  // piksel dari tepi artboard. Di lapisan yang sama, garis selalu ikut menempel.
  // Tebal garis & ukuran handle dibagi zoom di CSS, jadi di layar tetap 1px / 8px.
  const selLayer = makeEl('sel-layer');
  selLayer.hidden = false;
  document.getElementById('world').append(selLayer);
  selLayer.append(hoverBox, selBox, rotHandle);
  overlayEl.append(badge, drawBox); // kotak putus-putus saat menggambar tetap di lapisan layar

  for (const h of HANDLES) {
    handleEls[h] = makeEl(`handle handle-${h}`);
    handleEls[h].dataset.handle = h;
    selLayer.append(handleEls[h]);
  }

  viewportEl.addEventListener('pointerdown', (e) => onDown(e, viewportEl));
  viewportEl.addEventListener('pointermove', onMove);
  viewportEl.addEventListener('pointerup', onUp);
  viewportEl.addEventListener('pointercancel', () => {
    if (gesture?.kind === 'reorder') endReorder(gesture);
    gesture = null;
  });
  viewportEl.addEventListener('pointerleave', () => { if (!gesture) setHover(null); });
  viewportEl.addEventListener('dblclick', onDoubleClick);
  addEventListener('keydown', onKey);
}

// ---------- Gesture mouse ----------

function onDown(e, viewportEl) {
  if (e.button !== 0 || wantsPan(e)) return;
  if (isEditableTarget(e.target)) return; // sedang mengganti nama artboard
  finishTextEdit();

  // Mode edit titik vector: klik titik/handle/garis ditangani di sana; klik di tempat lain = keluar.
  if (isEditingVector()) {
    if (vectorEditDown(e, toLocal(e))) {
      gesture = { kind: 'vectorEdit' };
      viewportEl.setPointerCapture(e.pointerId);
      return;
    }
    stopVectorEdit();
  }

  if (VECTOR_TOOLS.has(state.tool)) {
    const { sx, sy } = toLocal(e);
    gesture = { kind: 'vector' };
    vectorDown(screenToWorld(sx, sy), e);
    viewportEl.setPointerCapture(e.pointerId);
    return;
  }

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
  if (e.target.dataset?.rotate && sel?.path.length) {
    // Putar elemen: sudut dihitung dari titik tengah elemen ke kursor.
    const el = resolve(sel);
    const r = rectOf(sel);
    const c = worldToScreen(r.x + r.w / 2, r.y + r.h / 2);
    const { sx, sy } = toLocal(e);
    gesture = { kind: 'rotate', ref: sel, el, cx: c.x, cy: c.y, startAngle: angleOf(c, sx, sy), startRot: rotationOf(el) };
  } else if (handle && sel && !sel.path.length) {
    gesture = { kind: 'resize', handle, ...start(e, sel.artboardId) };
  } else {
    const hit = hitTest(e);
    const onLabel = !!labelAt(e);
    const inSelectedArtboard = hit && isSelected({ artboardId: hit.artboardId, path: [] });
    // Artboard bisa digeser lewat namanya, atau dari dalam artboard yang sedang terpilih.
    const movable = hit && (onLabel || inSelectedArtboard) ? hit.artboardId : null;
    // Elemen berposisi bebas (atau yang berada di dalamnya) bisa langsung di-drag.
    const hitEl = !movable && hit?.path.length ? resolve(hit) : null;
    // Prioritas drag: elemen bebas -> geser posisinya; anak auto layout -> ubah urutan; lainnya -> induk bebas.
    const ownFree = hitEl && (isFree(hitEl) || isMovableGroup(hitEl));
    const reorderRef = hitEl && !ownFree && reorderable(hitEl) ? hit : null;
    const freeRef = hitEl && !reorderRef ? freeAncestor(hit) : null;
    gesture = { kind: 'click', hit, movable, freeRef, reorderRef, shift: e.shiftKey, ...start(e, movable) };
  }
  viewportEl.setPointerCapture(e.pointerId);
}

function freeAncestor(ref) {
  let el = resolve(ref);
  while (el && el.tagName !== 'BODY') {
    if (isFree(el) || isMovableGroup(el)) return { artboardId: ref.artboardId, path: pathOf(el) };
    el = el.parentElement;
  }
  return null;
}

// Kotak-kotak acuan untuk snap elemen bebas: induknya dan saudara-saudaranya.
function siblingBoxes(el, ref) {
  const boxes = [];
  const parentBox = rectOf({ artboardId: ref.artboardId, path: ref.path.slice(0, -1) });
  if (parentBox) boxes.push(parentBox);
  for (const child of visibleChildren(el.parentElement)) {
    if (child === el) continue;
    const r = rectOf({ artboardId: ref.artboardId, path: pathOf(child) });
    if (r && r.w && r.h) boxes.push(r);
  }
  return boxes;
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
  if (gesture?.kind === 'vectorEdit') return vectorEditMove(toLocal(e), e);
  if (VECTOR_TOOLS.has(state.tool)) {
    const { sx, sy } = toLocal(e);
    if (isDrawingVector()) vectorMove(screenToWorld(sx, sy), e);
    return;
  }
  if (!gesture) {
    if (!isPanning() && !e.buttons && !isEditingText()) setHover(hoverTarget(e));
    return;
  }

  if (gesture.kind === 'rotate') {
    const { sx, sy } = toLocal(e);
    let deg = gesture.startRot + angleOf({ x: gesture.cx, y: gesture.cy }, sx, sy) - gesture.startAngle;
    deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg * 10) / 10;
    deg = Math.round((((deg % 360) + 540) % 360 - 180) * 10) / 10; // -180..180
    captureDoc(gesture.ref.artboardId, 'Rotasi');
    if (deg) gesture.el.style.rotate = `${deg}deg`;
    else gesture.el.style.removeProperty('rotate');
    emit('edit', gesture.ref.artboardId);
    badge.textContent = `${deg}°`;
    return;
  }

  if (gesture.kind === 'draw') {
    const { sx, sy } = toLocal(e);
    gesture.end = screenToWorld(sx, sy);
    // Frame di luar artboard = artboard baru: sudutnya menempel ke tepi artboard lain.
    if (gesture.tool === 'frame' && !artboardAt(gesture.start.x, gesture.start.y) && !e.ctrlKey) {
      const boxes = artboardBoxes();
      const { dx, dy } = snapRect({ ...gesture.end, w: 0, h: 0 }, boxes, { xEdges: ['l'], yEdges: ['t'] });
      gesture.end = { x: gesture.end.x + (dx ?? 0), y: gesture.end.y + (dy ?? 0) };
      showGuidesFor(drawRect(), boxes, { withSpacing: false });
    }
    drawDrawBox();
    return;
  }
  const z = state.view.zoom;
  const dx = (e.clientX - gesture.px) / z;
  const dy = (e.clientY - gesture.py) / z;

  if (gesture.kind === 'click') {
    if ((!gesture.movable && !gesture.freeRef && !gesture.reorderRef) || Math.hypot(e.clientX - gesture.px, e.clientY - gesture.py) < DRAG_THRESHOLD) return;
    setHover(null);
    if (gesture.reorderRef) {
      startReorder(gesture, e);
    } else if (gesture.freeRef) {
      // Mulai menggeser elemen berposisi bebas.
      const ref = gesture.freeRef;
      if (!isSelected(ref)) setSelection(ref);
      const el = resolve(ref);
      // Group: semua elemen bebas di dalamnya ikut bergeser.
      const items = (isGroup(el) ? freeLeaves(el) : [el]).map((t) => ({ el: t, pos: freePosition(t) }));
      Object.assign(gesture, {
        kind: 'moveEl', ref, items, startRect: rectOf(ref), boxes: siblingBoxes(el, ref),
      });
    } else {
      gesture.kind = 'move';
    }
  }

  if (gesture.kind === 'reorder') return moveReorder(gesture, e);

  if (gesture.kind === 'moveEl') {
    const { ref, items, startRect, boxes } = gesture;
    const rect = { ...startRect, x: startRect.x + dx, y: startRect.y + dy };
    const snap = e.ctrlKey ? { dx: 0, dy: 0 } : snapMove(rect, boxes);
    captureDoc(ref.artboardId, 'Pindah elemen');
    for (const { el, pos } of items) {
      el.style.left = `${Math.round(pos.left + dx + snap.dx)}px`;
      el.style.top = `${Math.round(pos.top + dy + snap.dy)}px`;
    }
    showGuidesFor(rectOf(ref), boxes);
    emit('edit', ref.artboardId);
    return;
  }

  if (gesture.kind === 'move' && !gesture.group) {
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
    const boxes = artboardBoxes(ids);
    const snap = e.ctrlKey ? { dx: 0, dy: 0 } : snapMove(bbox, boxes);
    for (const { id, from } of gesture.group) {
      const b = getArtboard(id);
      if (!b) continue;
      b.x = Math.round(from.x + dx + snap.dx);
      b.y = Math.round(from.y + dy + snap.dy);
    }
    showGuidesFor({ ...bbox, x: bbox.x + Math.round(snap.dx), y: bbox.y + Math.round(snap.dy) }, boxes);
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
    const boxes = artboardBoxes(new Set([a.id]));
    if (!e.ctrlKey) {
      const xEdges = h.includes('e') ? ['r'] : h.includes('w') ? ['l'] : [];
      const yEdges = h.includes('s') ? ['b'] : h.includes('n') ? ['t'] : [];
      const snap = snapRect({ x: a.x, y: a.y, w: a.width, h: a.height }, boxes, { xEdges, yEdges });
      const sx = Math.round(snap.dx ?? 0);
      const sy = Math.round(snap.dy ?? 0);
      if (h.includes('e')) a.width = Math.max(1, a.width + sx);
      if (h.includes('w')) { a.x += sx; a.width = Math.max(1, a.width - sx); }
      if (h.includes('s')) a.height = Math.max(1, a.height + sy);
      if (h.includes('n')) { a.y += sy; a.height = Math.max(1, a.height - sy); }
    }
    showGuidesFor({ x: a.x, y: a.y, w: a.width, h: a.height }, boxes, { withSpacing: false });
  }
  layoutArtboards();
}

function onUp(e) {
  const g = gesture;
  gesture = null;
  if (!g) return;
  if (g.kind === 'vector') return vectorUp();
  if (g.kind === 'vectorEdit') return vectorEditUp();
  if (g.kind === 'reorder') return finishReorder(g);
  clearGuides();
  drawOverlay();
  if (g.kind === 'moveEl' || g.kind === 'rotate') {
    emit('structure', g.ref.artboardId); // perbarui X/Y / rotasi di panel kanan
    return;
  }
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
  const screen = placeOnScreen(drawBox, rect);
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
  if (VECTOR_TOOLS.has(state.tool)) return vectorDoubleClick();
  if (state.tool !== 'select' || isEditableTarget(e.target)) return;
  if (isEditingVector()) return vectorEditDoubleClick(toLocal(e));
  const label = labelAt(e);
  if (label) return startRename(label.parentElement.dataset.id);
  const hit = hitTest(e, true);
  // Double-click elemen terpilih: masuk satu tingkat ke elemen di dalamnya (seperti Figma).
  // Kalau yang dituju teks, langsung edit teksnya.
  const current = resolve(state.selection);
  const hitEl = hit && resolve(hit);
  if (hit?.path.length && current && !sameRef(hit, state.selection) && current.contains(hitEl)) {
    setSelection(hit);
    if (isTextLeaf(hitEl)) startTextEdit(hit);
    return;
  }
  if (hit?.path.length && isTextLeaf(resolve(hit))) {
    setSelection(hit);
    startTextEdit(hit);
  } else if (hit?.path.length && canEditVector(resolve(hit))) {
    startVectorEdit(hit);
  }
}

// Cari elemen di bawah kursor: tentukan artboard-nya, lalu tanya dokumen di dalam iframe.
// deep = double-click: masuk satu tingkat ke dalam elemen yang sedang terpilih.
// Ctrl + klik = langsung elemen terdalam.
function hitTest(e, deep = false) {
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
    if (!e.ctrlKey && !e.metaKey) target = scopedTarget(target, deep);
    const path = pathOf(target);
    return path ? { artboardId: a.id, path } : root;
  }
  return null;
}

// Pemilihan ala Figma: klik memilih elemen paling luar (anak langsung artboard), atau elemen yang
// selevel dengan yang sedang terpilih. Klik di dalam elemen terpilih tetap memilih elemen itu
// (supaya bisa di-drag); double-click masuk satu tingkat ke dalamnya. Berlaku juga untuk group.
function scopedTarget(target, deep) {
  const doc = target.ownerDocument;
  const sel = resolve(state.selection);
  let scope = doc.body;
  if (sel && sel.ownerDocument === doc && sel !== doc.body) {
    if (sel === target || sel.contains(target)) {
      if (!deep) return sel;
      scope = sel;
    } else {
      // Induk terdekat yang memuat elemen terpilih dan elemen yang diklik: pilih di level itu.
      let anc = sel.parentElement;
      while (anc && !anc.contains(target)) anc = anc.parentElement;
      scope = anc ?? doc.body;
    }
  }
  let el = target;
  while (el.parentElement && el.parentElement !== scope) el = el.parentElement;
  return el.parentElement === scope ? el : target;
}

// ---------- Drag untuk mengubah urutan di auto layout ----------
// Seperti Figma/pen.dev: elemen terangkat mengikuti kursor, saudara-saudaranya otomatis bergeser
// memberi tempat, dan urutannya berubah saat dilepas. Selama drag hanya gaya sementara yang dipakai.

function reorderable(el) {
  const parent = el.parentElement;
  if (!parent || el.tagName === 'BODY' || isFree(el)) return false;
  const display = el.ownerDocument.defaultView.getComputedStyle(parent).display;
  return /flex|grid/.test(display) && visibleChildren(parent).length > 1;
}

function startReorder(g, e) {
  const ref = g.reorderRef;
  const el = resolve(ref);
  const a = getArtboard(ref.artboardId);
  if (!isSelected(ref)) setSelection(ref);
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const pt = pointIn(a, e);
  const r = el.getBoundingClientRect();
  Object.assign(g, {
    kind: 'reorder', ref, el, a, parent: el.parentElement,
    before: snapshot(ref.artboardId),
    hadStyle: el.hasAttribute('style'),
    saved: { translate: el.style.translate, position: el.style.position, 'z-index': el.style.zIndex, opacity: el.style.opacity },
    grab: { x: pt.x - r.left, y: pt.y - r.top },
  });
  // Angkat elemen: di atas saudara-saudaranya dan sedikit transparan.
  if (cs.position === 'static') el.style.position = 'relative';
  el.style.zIndex = '1000';
  el.style.opacity = String((Number(cs.opacity) || 1) * 0.85);
}

function moveReorder(g, e) {
  const { el, parent, a } = g;
  const pt = pointIn(a, e);
  const pcs = el.ownerDocument.defaultView.getComputedStyle(parent);
  const flowsInRows = pcs.display.includes('grid') || pcs.flexDirection.startsWith('row');
  const reverse = pcs.flexDirection.endsWith('reverse');
  const sibs = visibleChildren(parent).filter((c) => c !== el);
  // Elemen disisipkan sebelum saudara pertama yang "sesudah" posisi kursor (urutan baca).
  let index = sibs.length;
  for (const [i, sib] of sibs.entries()) {
    const r = sib.getBoundingClientRect();
    const before = flowsInRows
      ? pt.y < r.top || (pt.y < r.bottom && (reverse ? pt.x > r.left + r.width / 2 : pt.x < r.left + r.width / 2))
      : (reverse ? pt.y > r.top + r.height / 2 : pt.y < r.top + r.height / 2);
    if (before) { index = i; break; }
  }
  if (visibleChildren(parent).indexOf(el) !== index) {
    if (index < sibs.length) parent.insertBefore(el, sibs[index]);
    else sibs.at(-1).after(el);
    setSelection({ artboardId: g.ref.artboardId, path: pathOf(el) });
  }
  // Elemen mengikuti kursor dari tempat barunya.
  el.style.translate = '';
  const r = el.getBoundingClientRect();
  el.style.translate = `${round2(pt.x - g.grab.x - r.left)}px ${round2(pt.y - g.grab.y - r.top)}px`;
  emit('layout');
}

function endReorder(g) {
  const { el, saved } = g;
  for (const [prop, value] of Object.entries(saved)) {
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
  }
  if (!g.hadStyle && !el.getAttribute('style')) el.removeAttribute('style');
}

function finishReorder(g) {
  endReorder(g);
  const id = g.ref.artboardId;
  const ref = { artboardId: id, path: pathOf(g.el) };
  pushDoc(id, 'Ubah urutan', g.before, snapshot(id), [g.ref], [ref]);
  setSelection(ref);
  emit('structure', id);
}

// Posisi kursor dalam koordinat artboard (= koordinat di dalam iframe).
function pointIn(a, e) {
  const { sx, sy } = toLocal(e);
  const w = screenToWorld(sx, sy);
  return { x: w.x - a.x, y: w.y - a.y };
}

const round2 = (n) => Math.round(n * 100) / 100;

const angleOf = (c, sx, sy) => (Math.atan2(sy - c.y, sx - c.x) * 180) / Math.PI;

// Shortcut navigasi ala Figma: Esc = batal pilih, Enter = masuk ke anak (atau edit teks),
// Shift+Enter = naik ke induk.
function onKey(e) {
  if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey) return;
  if (e.key === 'Escape' && (DRAW_TOOLS.has(state.tool) || VECTOR_TOOLS.has(state.tool))) { setTool('select'); return; } // batal menggambar
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
    } else if (canEditVector(el)) {
      startVectorEdit(state.selection);
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
  const r = boxOf(el); // group: gabungan kotak isinya
  return { x: a.x + r.left, y: a.y + r.top, w: r.width, h: r.height };
}

function placeOnScreen(boxEl, rect) {
  const p = worldToScreen(rect.x, rect.y);
  const z = state.view.zoom;
  const screen = { x: p.x, y: p.y, w: rect.w * z, h: rect.h * z };
  Object.assign(boxEl.style, {
    left: `${screen.x}px`, top: `${screen.y}px`, width: `${screen.w}px`, height: `${screen.h}px`,
  });
  boxEl.hidden = false;
  return screen;
}

// Handle berukuran tetap (px layar) dengan titik tengah di titik world (x, y).
// - Posisi lewat left/top, sama seperti garis seleksi: browser membulatkan keduanya dengan cara
//   yang sama, jadi handle selalu tepat di pertemuan garis.
// - Ukuran lewat transform scale (bukan width/height dibagi zoom): ukuran yang dibulatkan browser
//   sebelum diperbesar membuat handle jadi persegi panjang di zoom besar.
function placeHandle(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.transform = `scale(${1 / state.view.zoom}) translate(-50%, -50%)`;
}

// Taruh kotak di koordinat world (ikut transform kanvas). Mengembalikan posisinya di layar.
function place(boxEl, rect) {
  if (!rect) { boxEl.hidden = true; return null; }
  Object.assign(boxEl.style, {
    left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px`,
  });
  boxEl.hidden = false;
  const p = worldToScreen(rect.x, rect.y);
  const z = state.view.zoom;
  return { x: p.x, y: p.y, w: rect.w * z, h: rect.h * z };
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
  redrawVector(); // pratinjau Pen/Pencil ikut bergeser saat kanvas di-zoom/pan
  redrawVectorEdit();
  const showHover = !isEditingText() && !measuring && !isSelected(state.hover);
  place(hoverBox, showHover ? rectOf(state.hover) : null);

  const others = state.selected.slice(0, -1);
  others.forEach((ref, i) => place(extraBox(i), rectOf(ref)));
  for (let i = others.length; i < extraBoxes.length; i++) extraBoxes[i].hidden = true;

  const rect = isEditingVector() ? null : rectOf(state.selection); // saat edit titik, kotak seleksi disembunyikan
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
    const x = rect.x + (h.includes('w') ? 0 : h.includes('e') ? rect.w : rect.w / 2);
    const y = rect.y + (h.includes('n') ? 0 : h.includes('s') ? rect.h : rect.h / 2);
    placeHandle(el, x, y);
  }

  // Handle rotasi: satu elemen (bukan artboard/group), di atas kotak seleksi.
  const selEl = screen && state.selected.length === 1 && state.selection.path.length ? resolve(state.selection) : null;
  rotHandle.hidden = !selEl || isGroup(selEl);
  if (!rotHandle.hidden) {
    placeHandle(rotHandle, rect.x + rect.w / 2, rect.y - 18 / state.view.zoom);
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
  const r = ref.path.length ? boxOf(el) : { left: 0, top: 0, width: a.width, height: a.height };
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
