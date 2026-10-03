// Penyimpanan artboard: setiap artboard = satu file HTML di designs/,
// plus designs/artboards.json yang mencatat nama, ukuran, dan posisi di kanvas.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DESIGNS_DIR = path.join(ROOT, 'designs');
export const ASSETS_DIR = path.join(DESIGNS_DIR, 'assets');
export const MANIFEST_FILE = 'artboards.json';
const MANIFEST_PATH = path.join(DESIGNS_DIR, MANIFEST_FILE);
const TOKENS_LINK = '<link rel="stylesheet" href="tokens.css">';

const GAP = 80; // jarak antar artboard di kanvas (px)

export async function ensureDesignsDir() {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
}

// Pastikan semua artboard lama juga ter-link ke tokens.css.
export async function linkTokensInAllArtboards() {
  for (const artboard of await listArtboards()) {
    const file = artboardPath(artboard);
    const html = await fs.readFile(file, 'utf8').catch(() => null);
    if (html === null) continue;
    const linked = withTokensLink(html);
    if (linked !== html) await writeAtomic(file, linked);
  }
}

// Simpan file gambar ke designs/assets/. Nama file diberi potongan hash isinya,
// jadi gambar yang sama tidak tersimpan dua kali. Mengembalikan path relatif untuk <img src>.
const IMAGE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/avif': 'avif',
};
export async function saveAsset(buffer, contentType, originalName = 'gambar') {
  const ext = IMAGE_EXT[contentType];
  if (!ext) throw new Error(`Jenis file tidak didukung: ${contentType}`);
  const base = slugify(originalName.replace(/\.[^.]+$/, '')).slice(0, 40);
  const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 8);
  const filename = `${base}-${hash}.${ext}`;
  await fs.writeFile(path.join(ASSETS_DIR, filename), buffer);
  return `assets/${filename}`;
}

export async function listArtboards() {
  try {
    const data = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    return Array.isArray(data.artboards) ? data.artboards : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function getArtboard(id) {
  const artboard = (await listArtboards()).find((a) => a.id === id);
  if (!artboard) throw new Error(`Artboard "${id}" tidak ditemukan. Pakai list_artboards untuk melihat id yang ada.`);
  return artboard;
}

export function artboardPath(artboard) {
  return path.join(DESIGNS_DIR, artboard.file);
}

export async function readArtboardHtml(id) {
  return fs.readFile(artboardPath(await getArtboard(id)), 'utf8');
}

// x, y, dan id opsional: dipakai editor saat menduplikat atau mengembalikan (undo) artboard.
export async function createArtboard({ name, width, height, html, x, y, id: wantedId }) {
  const artboards = await listArtboards();
  const id = uniqueId(wantedId ?? slugify(name), artboards);
  const last = artboards.at(-1);
  const artboard = {
    id,
    name,
    width,
    height,
    x: x ?? (last ? last.x + last.width + GAP : 0),
    y: y ?? (last ? last.y : 0),
    file: `${id}.html`,
  };
  await writeAtomic(artboardPath(artboard), prepareHtml(html ?? '', name));
  await saveManifest([...artboards, artboard]);
  return artboard;
}

export async function writeArtboardHtml(id, { html, width, height }) {
  const artboards = await listArtboards();
  const artboard = artboards.find((a) => a.id === id);
  if (!artboard) throw new Error(`Artboard "${id}" tidak ditemukan. Pakai list_artboards untuk melihat id yang ada.`);
  await writeAtomic(artboardPath(artboard), prepareHtml(html, artboard.name));
  if (width || height) {
    artboard.width = width ?? artboard.width;
    artboard.height = height ?? artboard.height;
    await saveManifest(artboards);
  }
  return artboard;
}

// Ubah info artboard di kanvas (nama, ukuran, posisi) tanpa menyentuh isi HTML-nya.
export async function updateArtboard(id, changes) {
  const artboards = await listArtboards();
  const artboard = artboards.find((a) => a.id === id);
  if (!artboard) throw new Error(`Artboard "${id}" tidak ditemukan.`);
  for (const key of ['name', 'width', 'height', 'x', 'y']) {
    if (changes[key] !== undefined) artboard[key] = changes[key];
  }
  await saveManifest(artboards);
  return artboard;
}

// Hapus artboard dari kanvas. File HTML-nya tidak dibuang, tapi dipindah ke designs/.trash/
// supaya masih bisa diselamatkan.
export async function deleteArtboard(id) {
  const artboards = await listArtboards();
  const artboard = artboards.find((a) => a.id === id);
  if (!artboard) throw new Error(`Artboard "${id}" tidak ditemukan.`);
  const trashDir = path.join(DESIGNS_DIR, '.trash');
  await fs.mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.rename(artboardPath(artboard), path.join(trashDir, `${artboard.id}-${stamp}.html`)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  await saveManifest(artboards.filter((a) => a.id !== id));
  return artboard;
}

async function saveManifest(artboards) {
  await writeAtomic(MANIFEST_PATH, JSON.stringify({ artboards }, null, 2) + '\n');
}

// Tulis ke file sementara lalu rename, supaya kanvas tidak pernah membaca file setengah jadi.
async function writeAtomic(filePath, content) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

// HTML final yang ditulis ke file: dokumen lengkap yang ter-link ke tokens.css.
export function prepareHtml(html, title) {
  return withTokensLink(toDocument(html, title));
}

function withTokensLink(html) {
  if (html.includes('tokens.css')) return html;
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n${TOKENS_LINK}`);
}

// Kalau Claude hanya mengirim potongan HTML (tanpa <html>), bungkus jadi dokumen lengkap
// supaya file di designs/ selalu bisa dibuka langsung di browser.
function toDocument(html, title) {
  if (/<html[\s>]|<!doctype/i.test(html)) return html;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${TOKENS_LINK}
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: var(--font-sans, system-ui, sans-serif); color: var(--color-text, #111); }
</style>
</head>
<body>
${html}
</body>
</html>
`;
}

function slugify(name) {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'artboard';
}

function uniqueId(base, artboards) {
  const taken = new Set(artboards.map((a) => a.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
