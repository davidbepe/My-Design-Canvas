// Data variabel (design tokens) di editor: memuat, menyimpan (dengan undo), dan menerapkan ke artboard.
// Tampilan pengelolaannya ada di variables.js (tab Variabel + tabel).
import { state, emit, toast } from './state.js';
import { push } from './history.js';

// { modes: ['Default', ...], groups: [{ id, name, type }], tokens: { nama: { Mode: nilai } }, slugs: { Mode: slug } }
export let data = { modes: ['Default'], groups: [], tokens: {}, slugs: { Default: 'default' } };
// Nilai mode default saja (dipakai menu token di panel properti).
export let tokens = {};

export async function loadTokens() {
  const res = await fetch('/api/tokens');
  setData(await res.json());
}

// true kalau server masih versi lama (belum di-restart setelah update), yang belum mengenal mode/grup.
export let legacyServer = false;

function setData(next) {
  legacyServer = !Array.isArray(next.modes);
  if (legacyServer) {
    toast('Server masih versi lama. Restart server (Ctrl+C lalu npm.cmd start) supaya fitur Variabel berfungsi.');
    next = { modes: ['Default'], groups: [], tokens: {} };
  }
  const slugs = next.slugs ?? {};
  data = { modes: next.modes, groups: next.groups, tokens: next.tokens };
  data.slugs = Object.fromEntries(data.modes.map((m) => [m, slugs[m] ?? modeSlug(m)]));
  tokens = Object.fromEntries(Object.entries(data.tokens).map(([n, byMode]) => [n, byMode[data.modes[0]]]));
  emit('tokens');
}

export function modeSlug(mode) {
  return mode.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mode';
}

// Grup sebuah variabel: awalan terpanjang yang cocok (mis. "text-" untuk "text-lg").
export function groupOf(name) {
  let best = null;
  for (const g of data.groups) {
    if (name.startsWith(`${g.id}-`) && (!best || g.id.length > best.id.length)) best = g;
  }
  return best?.id ?? 'other';
}

export function groupInfo(id) {
  return data.groups.find((g) => g.id === id) ?? { id: 'other', name: 'Lainnya', type: 'text' };
}

export function tokensIn(groupId) {
  return Object.keys(data.tokens).filter((n) => groupOf(n) === groupId);
}

// Salinan data untuk diubah lalu disimpan.
export function cloneData() {
  return JSON.parse(JSON.stringify({ modes: data.modes, groups: data.groups, tokens: data.tokens }));
}

// Simpan variabel (dengan undo). Mengembalikan false kalau server menolak.
export async function saveVariables(next, label = 'Ubah variabel') {
  const before = cloneData();
  if (!(await write(next))) return false;
  push({ label, undo: () => write(before), redo: () => write(next) });
  return true;
}

async function write(next) {
  let res;
  try {
    res = await fetch('/api/tokens', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
  } catch {
    toast('Server terputus: variabel belum tersimpan');
    return false;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(`Gagal menyimpan variabel: ${(err.error ?? '').slice(0, 120)}`);
    return false;
  }
  setData(next);
  await refreshArtboardTokens();
  return true;
}

// Terapkan tokens.css terbaru ke semua artboard tanpa memuat ulang dan tanpa mengubah HTML-nya
// (stylesheet "adopted" tidak ikut tersimpan ke file).
export async function refreshArtboardTokens() {
  const css = await fetch(`/designs/tokens.css?v=${Date.now()}`).then((r) => r.text());
  // Stylesheet "adopted" tidak mendukung @import, jadi font Google dari token dimuat lewat
  // <link data-editor-temp> yang dibuang lagi saat artboard disimpan.
  fontImports = [...css.matchAll(/@import\s+url\(["']?([^"')]+)["']?\)\s*;/g)].map((m) => m[1]);
  const rules = css.replace(/@import[^;]+;/g, '');
  for (const node of state.nodes.values()) applyTo(node.iframe, rules);
}

let fontImports = [];

function applyTo(iframe, css) {
  const win = iframe?.contentWindow;
  if (!win?.document) return;
  const sheet = new win.CSSStyleSheet();
  sheet.replaceSync(css);
  // Pertahankan aturan bantu sudut artboard (lihat syncArtboardCorners).
  win.document.adoptedStyleSheets = [sheet, ...win.document.adoptedStyleSheets.filter((s) => s.editorCorners)];
  applyFontImports(win.document);
}

export function applyFontImports(doc) {
  if (!doc?.head) return;
  for (const url of fontImports) {
    if ([...doc.head.querySelectorAll('link[data-editor-temp]')].some((l) => l.getAttribute('href') === url)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-editor-temp', '');
    doc.head.append(link);
  }
}

// ---------- Pratinjau kecil nilai variabel ----------

export function tokenPreview(groupId, value) {
  const type = groupInfo(groupId).type;
  const p = document.createElement('span');
  p.className = 'token-preview';
  if (type === 'color') p.style.background = value;
  else if (type === 'font') { p.textContent = 'Aa'; p.style.fontFamily = value; }
  else if (groupId === 'radius') { p.classList.add('outline'); p.style.borderRadius = value; }
  else if (groupId === 'shadow') { p.classList.add('light'); p.style.boxShadow = value; }
  else if (groupId === 'text') p.textContent = 'A';
  else if (type === 'size') { p.classList.add('space'); p.style.width = `min(${value}, 16px)`; }
  else p.textContent = '·';
  return p;
}

// ---------- Pemilih variabel untuk field properti ----------

let menu = null;

// Tampilkan variabel yang cocok untuk field: grup `preferred` dulu, lalu grup lain yang tipenya sama.
// onPick menerima "var(--nama)".
export function openTokenMenu(anchor, preferred, onPick) {
  closeTokenMenu();
  const type = groupInfo(preferred).type;
  const groups = [...data.groups.filter((g) => g.id === preferred), ...data.groups.filter((g) => g.id !== preferred && g.type === type)];
  menu = el('div', 'token-menu');
  let count = 0;
  for (const g of groups) {
    const names = tokensIn(g.id);
    if (!names.length) continue;
    menu.append(el('div', 'token-menu-group', g.name));
    for (const name of names) {
      const item = el('button', 'token-menu-item');
      item.append(tokenPreview(g.id, tokens[name]), el('span', 'token-name', name), el('span', 'token-menu-value', tokens[name]));
      item.addEventListener('click', () => { closeTokenMenu(); onPick(`var(--${name})`); });
      menu.append(item);
      count++;
    }
  }
  if (!count) menu.append(el('div', 'token-menu-empty', 'Belum ada variabel yang cocok. Tambahkan di tab Variabel.'));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  setTimeout(() => addEventListener('pointerdown', outside, true));
}

function outside(e) {
  if (!menu?.contains(e.target)) closeTokenMenu();
}

export function closeTokenMenu() {
  menu?.remove();
  menu = null;
  removeEventListener('pointerdown', outside, true);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}
