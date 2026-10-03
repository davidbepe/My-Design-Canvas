// Pustaka ikon Lucide (paket lucide-static, terpasang lokal sehingga jalan tanpa internet).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LUCIDE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'lucide-static');
let tagsPromise = null;

function loadTags() {
  tagsPromise ??= fs.readFile(path.join(LUCIDE_DIR, 'tags.json'), 'utf8').then(JSON.parse);
  return tagsPromise;
}

// Cari ikon berdasarkan nama dan tag. Nama yang cocok persis/di awal diurutkan lebih dulu.
export async function searchIcons(query = '', limit = 60) {
  const tags = await loadTags();
  const q = query.trim().toLowerCase();
  const names = Object.keys(tags);
  if (!q) return names.slice(0, limit);
  const scored = [];
  for (const name of names) {
    let score = -1;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (tags[name].some((t) => t.includes(q))) score = 3;
    if (score >= 0) scored.push([score, name]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, limit).map(([, name]) => name);
}

export async function iconSvg(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Nama ikon tidak valid: ${name}`);
  const raw = await fs.readFile(path.join(LUCIDE_DIR, 'icons', `${name}.svg`), 'utf8');
  return raw
    .replace(/<!--[\s\S]*?-->/g, '') // buang komentar lisensi
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
}
