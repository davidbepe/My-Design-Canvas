// Aksi editor yang bisa di-undo: ubah/duplikat/hapus artboard dan elemen.
// Semua aksi bekerja untuk SEMUA elemen yang terpilih (multi-select).
import {
  state, getArtboard, resolve, pathOf, setSelection, setSelectionList, visibleChildren, emit, demoteMasters, demoteMastersInHtml,
  docOf,
} from './state.js';
import { push, group, recordDoc, snapshot } from './history.js';
import * as api from './api.js';

const GAP = 80;

// Ubah nama/posisi/ukuran artboard. `before` diisi kalau tampilan sudah diubah duluan (mis. saat drag).
export function changeArtboard(id, after, label, before) {
  const a = getArtboard(id);
  if (!a) return;
  before ??= Object.fromEntries(Object.keys(after).map((k) => [k, a[k]]));
  if (Object.keys(after).every((k) => before[k] === after[k])) return;
  api.patchArtboard(id, after);
  push({
    label,
    undo: () => api.patchArtboard(id, before),
    redo: () => api.patchArtboard(id, after),
  });
}

// Pisahkan seleksi jadi artboard (path kosong) dan elemen, dikelompokkan per artboard.
function splitSelection() {
  const artboardIds = [];
  const elementsByArtboard = new Map();
  for (const ref of state.selected) {
    if (!ref.path.length) { artboardIds.push(ref.artboardId); continue; }
    if (!elementsByArtboard.has(ref.artboardId)) elementsByArtboard.set(ref.artboardId, []);
    elementsByArtboard.get(ref.artboardId).push(ref);
  }
  return { artboardIds, elementsByArtboard };
}

export async function duplicateSelection() {
  if (!state.selected.length) return;
  const { artboardIds, elementsByArtboard } = splitSelection();
  const clones = []; // { artboardId, el }
  const newArtboards = [];
  await group('Duplikat', async () => {
    for (const [artboardId, refs] of elementsByArtboard) {
      const els = refs.map(resolve).filter(Boolean);
      recordDoc(artboardId, 'Duplikat elemen', () => {
        for (const el of els) {
          const clone = demoteMasters(el.cloneNode(true)); // salinan master = instance
          clone.removeAttribute('id'); // id harus unik dalam satu halaman
          el.after(clone);
          clones.push({ artboardId, el: clone });
        }
        // Path dihitung setelah semua klon masuk, karena klon menggeser posisi saudaranya.
        setSelectionList(clones.map((c) => ({ artboardId: c.artboardId, path: pathOf(c.el) })));
      });
      emit('structure', artboardId);
    }
    for (const id of artboardIds) {
      const created = await duplicateArtboard(id);
      if (created) newArtboards.push({ artboardId: created.id, path: [] });
    }
  });
  setSelectionList([...clones.map((c) => ({ artboardId: c.artboardId, path: pathOf(c.el) })), ...newArtboards]);
}

export async function deleteSelection() {
  if (!state.selected.length) return;
  const { artboardIds, elementsByArtboard } = splitSelection();
  await group('Hapus', async () => {
    for (const [artboardId, refs] of elementsByArtboard) {
      // Ambil semua elemennya dulu, baru dihapus, supaya path yang lain tidak bergeser.
      const els = refs.map(resolve).filter(Boolean);
      recordDoc(artboardId, 'Hapus elemen', () => {
        els.forEach((el) => el.remove());
        setSelectionList(state.selected.filter((r) => r.artboardId !== artboardId || !r.path.length));
      });
      emit('structure', artboardId);
    }
    for (const id of artboardIds) {
      setSelectionList(state.selected.filter((r) => r.artboardId !== id));
      await deleteArtboard(id);
    }
  });
}

// Ctrl+A: pilih semua elemen sejajar (satu induk), atau semua artboard.
export function selectAll() {
  const ref = state.selection;
  if (!ref || !ref.path.length) {
    return setSelectionList(state.artboards.map((a) => ({ artboardId: a.id, path: [] })));
  }
  const parent = resolve({ artboardId: ref.artboardId, path: ref.path.slice(0, -1) });
  if (!parent) return;
  setSelectionList(visibleChildren(parent).map((el) => ({ artboardId: ref.artboardId, path: pathOf(el) })));
}

// Buat artboard baru dan catat di riwayat. Tanpa x/y, server menaruhnya di kanan artboard terakhir.
export async function createArtboardWithHistory(data, label) {
  const created = await api.createArtboard(data);
  if (!created) return null;
  const recreate = { ...data, id: created.id, x: created.x, y: created.y };
  push({
    label,
    undo: () => {
      setSelectionList(state.selected.filter((r) => r.artboardId !== created.id));
      return api.deleteArtboard(created.id);
    },
    redo: () => api.createArtboard(recreate),
  });
  return created;
}

function duplicateArtboard(id) {
  const a = getArtboard(id);
  if (!a) return null;
  const maxRight = Math.max(...state.artboards.map((b) => b.x + b.width));
  return createArtboardWithHistory(
    { name: `${a.name} copy`, width: a.width, height: a.height, x: maxRight + GAP, y: a.y, html: demoteMastersInHtml(snapshot(id)) },
    'Duplikat frame',
  );
}

export async function deleteArtboard(id) {
  const a = getArtboard(id);
  if (!a) return;
  const data = { id: a.id, name: a.name, width: a.width, height: a.height, x: a.x, y: a.y, html: snapshot(id) };
  await api.deleteArtboard(id);
  push({
    label: 'Hapus frame',
    undo: () => api.createArtboard(data),
    redo: () => api.deleteArtboard(data.id),
  });
}

// Frame utama -> <div> frame biasa di dokumen `doc`: gaya <body>-nya, ukurannya, dan isinya ikut.
// Dipakai saat frame utama dimasukkan ke frame lain, atau dibungkus auto layout (Shift+A).
export function frameFromArtboard(srcId, doc) {
  const src = getArtboard(srcId);
  const srcDoc = docOf(srcId);
  const frame = doc.createElement('div');
  frame.className = 'frame';
  frame.setAttribute('data-name', src.name);
  frame.style.cssText = srcDoc.body.getAttribute('style') ?? '';
  if (frame.style.minHeight === '100vh') frame.style.removeProperty('min-height'); // khusus halaman, bukan frame
  frame.style.width = `${src.width}px`;
  frame.style.height = `${src.height}px`;
  frame.style.flexShrink = '0';
  frame.style.boxSizing = 'border-box';
  const cs = srcDoc.defaultView.getComputedStyle(srcDoc.body);
  if (cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none') frame.style.background = '#ffffff'; // frame utama = latar putih
  frame.innerHTML = srcDoc.body.innerHTML;
  return frame;
}

// Shift+A pada frame utama yang sudah auto layout (seperti Figma): buat frame utama baru ber-auto
// layout di posisi yang sama, lalu frame lama masuk ke dalamnya. Satu langkah undo.
export async function wrapArtboardInAutoLayout(id) {
  const src = getArtboard(id);
  if (!src || !docOf(id)?.body) return;
  const doc = new DOMParser().parseFromString(snapshot(id), 'text/html');
  const name = nextFrameName();
  doc.title = name;
  doc.body.setAttribute('style', 'display: flex; flex-direction: column; gap: 8px; min-height: 100vh;');
  doc.body.replaceChildren(frameFromArtboard(id, doc));
  const html = `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
  let created = null;
  await group('Bungkus dengan auto layout', async () => {
    created = await createArtboardWithHistory({ name, width: src.width, height: src.height, x: src.x, y: src.y, html }, 'Bungkus dengan auto layout');
    if (created) await deleteArtboard(id);
  });
  if (created) {
    setSelection({ artboardId: created.id, path: [] });
    // Buka frame utama baru dan frame lama di dalamnya di panel Layers.
    emit('expand-layers', [{ artboardId: created.id, path: [] }, { artboardId: created.id, path: [0] }]);
  }
}

// Nama "Frame N" berikutnya. Nama frame yang sudah masuk ke frame lain (data-name) juga dihitung,
// supaya tidak ada dua frame bernama sama, mis. Frame 1 di dalam Frame 1.
export function nextFrameName(alsoTaken = []) {
  const taken = new Set([...state.artboards.map((a) => a.name), ...alsoTaken]);
  for (const a of state.artboards) {
    for (const el of docOf(a.id)?.querySelectorAll('[data-name]') ?? []) taken.add(el.getAttribute('data-name'));
  }
  let n = 1;
  while (taken.has(`Frame ${n}`)) n++;
  return `Frame ${n}`;
}
