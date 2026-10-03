// Simpan editan ke file HTML di designs/. Ditunda sebentar supaya saat kamu men-drag
// sebuah nilai, file tidak ditulis puluhan kali per detik.
// Kalau server sedang mati, artboard dicatat sebagai "belum tersimpan" dan dikirim ulang saat tersambung lagi.
import { emit, docOf, getArtboard } from './state.js';
import { serialize } from './artboards.js';

const DELAY = 400;
const timers = new Map();
const failed = new Set();

export const hasUnsaved = () => failed.size > 0 || timers.size > 0;

export function scheduleSave(artboardId) {
  clearTimeout(timers.get(artboardId));
  timers.set(artboardId, setTimeout(() => save(artboardId), DELAY));
}

// Simpan sekarang juga kalau ada editan yang masih menunggu (mis. sebelum ekspor PNG).
export async function saveNow(artboardId) {
  if (!timers.has(artboardId) && !failed.has(artboardId)) return;
  clearTimeout(timers.get(artboardId));
  await save(artboardId);
}

// Dipanggil saat koneksi ke server pulih.
export async function retryFailed() {
  for (const id of [...failed]) await save(id);
}

async function save(artboardId) {
  timers.delete(artboardId);
  if (!getArtboard(artboardId)) { failed.delete(artboardId); return; } // artboard sudah dihapus
  const html = serialize(docOf(artboardId));
  if (!html) return;
  try {
    const res = await fetch(`/api/artboards/${encodeURIComponent(artboardId)}/html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: html,
    });
    if (!res.ok) throw new Error(await res.text());
    failed.delete(artboardId);
    emit('saved', artboardId);
  } catch (err) {
    failed.add(artboardId);
    emit('savefailed', artboardId);
    console.error('Gagal menyimpan artboard:', err);
  }
}
