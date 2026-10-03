// Aksi editor yang bisa di-undo: ubah/duplikat/hapus artboard dan elemen.
// Semua aksi bekerja untuk SEMUA elemen yang terpilih (multi-select).
import {
  state, getArtboard, resolve, pathOf, setSelectionList, visibleChildren, emit, demoteMasters, demoteMastersInHtml,
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
    'Duplikat artboard',
  );
}

async function deleteArtboard(id) {
  const a = getArtboard(id);
  if (!a) return;
  const data = { id: a.id, name: a.name, width: a.width, height: a.height, x: a.x, y: a.y, html: snapshot(id) };
  await api.deleteArtboard(id);
  push({
    label: 'Hapus artboard',
    undo: () => api.createArtboard(data),
    redo: () => api.deleteArtboard(data.id),
  });
}
