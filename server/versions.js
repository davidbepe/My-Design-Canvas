// Riwayat versi: snapshot bernama dari semua artboard + tokens, disimpan di designs/.versions/.
// Berbeda dengan undo, versi tetap ada walaupun browser ditutup.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DESIGNS_DIR, MANIFEST_FILE, listArtboards } from './store.js';
import { TOKENS_FILE } from './tokens.js';

const VERSIONS_DIR = path.join(DESIGNS_DIR, '.versions');
const INDEX_PATH = path.join(VERSIONS_DIR, 'versions.json');

export async function listVersions() {
  try {
    return JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveIndex(versions) {
  await fs.mkdir(VERSIONS_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(versions, null, 2) + '\n', 'utf8');
}

export async function saveVersion(name) {
  const artboards = await listArtboards();
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, '-');
  const dir = path.join(VERSIONS_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const files = [MANIFEST_FILE, TOKENS_FILE, ...artboards.map((a) => a.file)];
  for (const file of files) {
    await fs.copyFile(path.join(DESIGNS_DIR, file), path.join(dir, file)).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }
  const version = { id, name: name?.trim() || 'Tanpa nama', createdAt, artboards: artboards.map((a) => a.name) };
  await saveIndex([version, ...(await listVersions())]);
  return version;
}

// Pulihkan versi. Kondisi saat ini disimpan dulu sebagai versi baru, jadi pemulihan selalu bisa dibatalkan.
export async function restoreVersion(id) {
  const version = (await listVersions()).find((v) => v.id === id);
  if (!version) throw new Error(`Versi "${id}" tidak ditemukan.`);
  const backup = await saveVersion(`Otomatis: sebelum memulihkan "${version.name}"`);

  const dir = path.join(VERSIONS_DIR, id);
  const snapshot = JSON.parse(await fs.readFile(path.join(dir, MANIFEST_FILE), 'utf8')).artboards;
  // Artboard yang tidak ada di versi itu dipindah ke .trash (tidak dibuang).
  const keep = new Set(snapshot.map((a) => a.file));
  const trash = path.join(DESIGNS_DIR, '.trash');
  for (const a of await listArtboards()) {
    if (keep.has(a.file)) continue;
    await fs.mkdir(trash, { recursive: true });
    await fs.rename(path.join(DESIGNS_DIR, a.file), path.join(trash, `${a.id}-${id}.html`)).catch(() => {});
  }
  // Isi HTML & token dulu, daftar artboard terakhir, supaya kanvas memuat isi yang sudah benar.
  for (const a of snapshot) await copyInto(path.join(dir, a.file), path.join(DESIGNS_DIR, a.file));
  await copyInto(path.join(dir, TOKENS_FILE), path.join(DESIGNS_DIR, TOKENS_FILE));
  await copyInto(path.join(dir, MANIFEST_FILE), path.join(DESIGNS_DIR, MANIFEST_FILE));
  return { restored: version, backup };
}

export async function deleteVersion(id) {
  const versions = await listVersions();
  if (!versions.some((v) => v.id === id)) throw new Error(`Versi "${id}" tidak ditemukan.`);
  await fs.rm(path.join(VERSIONS_DIR, id), { recursive: true, force: true });
  await saveIndex(versions.filter((v) => v.id !== id));
}

// Salin lewat file sementara + rename, supaya kanvas tidak membaca file setengah jadi.
async function copyInto(from, to) {
  const tmp = `${to}.${process.pid}.tmp`;
  try {
    await fs.copyFile(from, tmp);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  await fs.rename(tmp, to);
}
