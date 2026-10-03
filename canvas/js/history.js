// Undo/redo. Setiap langkah menyimpan cara membatalkan (undo) dan mengulang (redo).
//
// Untuk isi artboard, kita simpan "foto" HTML sebelum & sesudah. Perubahan beruntun
// (mis. men-drag nilai padding) digabung jadi satu langkah supaya Ctrl+Z tidak perlu ditekan 50 kali.
// Aksi pada beberapa elemen sekaligus (multi-select) digabung lewat group().
import { state, on, emit, docOf, resolve, getArtboard, setSelectionList } from './state.js';
import { serialize } from './artboards.js';
import { scheduleSave } from './persist.js';

const LIMIT = 200;
const COALESCE_MS = 500;
const undoStack = [];
const redoStack = [];
const pending = new Map(); // artboardId -> { before, selBefore, timer, label }
let groupBuffer = null;

export const canUndo = () => undoStack.length > 0 || pending.size > 0;
export const canRedo = () => redoStack.length > 0;

export function push(entry) {
  if (groupBuffer) { groupBuffer.push(entry); return; }
  undoStack.push(entry);
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  emit('history');
}

// Jalankan beberapa aksi, lalu catat semuanya sebagai SATU langkah undo.
export async function group(label, fn) {
  if (groupBuffer) return fn(); // sudah di dalam grup
  groupBuffer = [];
  try {
    await fn();
  } finally {
    const entries = groupBuffer;
    groupBuffer = null;
    if (entries.length === 1) push(entries[0]);
    else if (entries.length > 1) {
      push({
        label,
        undo: async () => { for (const e of [...entries].reverse()) await e.undo(); },
        redo: async () => { for (const e of entries) await e.redo(); },
      });
    }
  }
}

export function snapshot(id) {
  return serialize(docOf(id));
}

const selectionNow = () => [...state.selected];

// Panggil SEBELUM mengubah isi artboard lewat panel properti.
export function captureDoc(id, label = 'Ubah properti') {
  let p = pending.get(id);
  if (!p) {
    p = { before: snapshot(id), selBefore: selectionNow(), label };
    pending.set(id, p);
    emit('history');
  }
  clearTimeout(p.timer);
  p.timer = setTimeout(() => commit(id), COALESCE_MS);
}

// Untuk aksi tunggal (hapus, duplikat, paste): foto sebelum, jalankan, foto sesudah.
export function recordDoc(id, label, fn) {
  commit(id);
  const before = snapshot(id);
  const selBefore = selectionNow();
  fn();
  const after = snapshot(id);
  if (before && after && before !== after) push(docEntry(id, label, before, after, selBefore, selectionNow()));
  scheduleSave(id);
}

export function pushDoc(id, label, before, after, selBefore, selAfter) {
  commit(id);
  if (before && after && before !== after) push(docEntry(id, label, before, after, selBefore, selAfter));
}

function commit(id) {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  const after = snapshot(id);
  if (p.before && after && after !== p.before) {
    push(docEntry(id, p.label, p.before, after, p.selBefore, selectionNow()));
  } else {
    emit('history');
  }
}

function flush() {
  for (const id of [...pending.keys()]) commit(id);
}

function docEntry(id, label, before, after, selBefore, selAfter) {
  return {
    label,
    undo: () => { applyDoc(id, before); restoreSelection(selBefore); },
    redo: () => { applyDoc(id, after); restoreSelection(selAfter); },
  };
}

// Ganti seluruh isi artboard dengan HTML dari riwayat, tanpa memuat ulang iframe.
function applyDoc(id, html) {
  const doc = docOf(id);
  if (!doc) return;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  doc.replaceChild(doc.importNode(parsed.documentElement, true), doc.documentElement);
  emit('doc', id);
  scheduleSave(id);
}

function restoreSelection(refs) {
  setSelectionList((refs ?? []).filter((r) => getArtboard(r.artboardId) && resolve(r)));
}

export async function undo() {
  flush();
  const entry = undoStack.pop();
  if (!entry) return;
  redoStack.push(entry);
  await entry.undo();
  emit('history', { action: 'Undo', label: entry.label });
}

export async function redo() {
  flush();
  const entry = redoStack.pop();
  if (!entry) return;
  undoStack.push(entry);
  await entry.redo();
  emit('history', { action: 'Redo', label: entry.label });
}

// Perubahan dari Claude, pemulihan versi, atau file yang diedit manual juga dicatat, jadi bisa di-undo.
on('beforeswap', (id) => commit(id));
on('external', ({ id, before }) => {
  const after = snapshot(id);
  if (before && after && before !== after) {
    push(docEntry(id, 'Perubahan dari luar editor', before, after, selectionNow(), selectionNow()));
  }
});
