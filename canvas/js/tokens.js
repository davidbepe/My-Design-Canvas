// Design tokens: editor token (panel kanan saat tidak ada yang dipilih) dan pemilih token untuk field properti.
// Sumbernya file designs/tokens.css; setiap artboard me-link file itu.
import { state, emit, toast } from './state.js';
import { push } from './history.js';
import { openFontMenu, primaryFamily, fontFamilyValue } from './fonts.js';

export let tokens = {};
let groups = [];

export async function loadTokens() {
  const res = await fetch('/api/tokens');
  ({ tokens, groups } = await res.json());
  emit('tokens');
}

export function groupOf(name) {
  return groups.find(([prefix]) => name.startsWith(`${prefix}-`))?.[0] ?? 'other';
}

export function tokensIn(group) {
  return Object.keys(tokens).filter((n) => groupOf(n) === group);
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
  win.document.adoptedStyleSheets = [sheet];
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

async function saveTokens(next, label = 'Ubah token') {
  const before = { ...tokens };
  await write(next);
  push({ label, undo: () => write(before), redo: () => write(next) });
}

async function write(next) {
  let res;
  try {
    res = await fetch('/api/tokens', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: next }),
    });
  } catch {
    return toast('Server terputus: token belum tersimpan');
  }
  if (!res.ok) return toast('Gagal menyimpan token. Nilai tidak boleh mengandung ; { }');
  tokens = next;
  emit('tokens');
  await refreshArtboardTokens();
}

// ---------- Panel token ----------

export function renderTokensPanel(panel) {
  const head = el('div', 'props-header');
  head.append(el('span', 'tag-pill', 'tokens'), el('span', 'props-name', 'designs/tokens.css'));
  panel.append(head);
  panel.append(el('div', 'props-hint pad', 'Token dipakai semua artboard lewat var(--nama). Ubah di sini, semua desain ikut berubah. Pilih elemen untuk mengedit propertinya.'));

  for (const [prefix, title] of [...groups, ['other', 'Lainnya']]) {
    const names = tokensIn(prefix);
    if (prefix === 'other' && !names.length) continue;
    const section = el('div', 'prop-section');
    const titleRow = el('div', 'prop-title token-title');
    titleRow.append(el('span', '', title));
    if (prefix !== 'other') {
      const add = el('button', 'icon-text-btn', '+');
      add.title = `Tambah token ${title.toLowerCase()}`;
      add.addEventListener('click', () => section.append(newTokenRow(prefix)));
      titleRow.append(add);
    }
    section.append(titleRow);
    for (const name of names) section.append(tokenRow(name, prefix));
    panel.append(section);
  }
}

function tokenRow(name, prefix) {
  const row = el('div', 'token-row');
  row.append(preview(prefix, tokens[name]));
  row.append(el('span', 'token-name', name));
  const input = el('input', 'token-value');
  input.value = tokens[name];
  input.spellcheck = false;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('change', () => {
    const value = input.value.trim();
    if (value && value !== tokens[name]) saveTokens({ ...tokens, [name]: value });
  });
  row.append(input);
  // Token font: pilih dari Google Fonts (font-nya otomatis dimuat lewat tokens.css).
  if (prefix === 'font') {
    const pick = el('button', 'token-btn', '▾');
    pick.title = 'Pilih Google Font';
    pick.addEventListener('click', () => openFontMenu(pick, primaryFamily(tokens[name]), (font) => {
      saveTokens({ ...tokens, [name]: fontFamilyValue(font) }, 'Ganti font token');
    }));
    row.append(pick);
  }
  const del = el('button', 'token-del', '×');
  del.title = 'Hapus token';
  del.addEventListener('click', () => {
    const next = { ...tokens };
    delete next[name];
    saveTokens(next, 'Hapus token');
  });
  row.append(del);
  return row;
}

function newTokenRow(prefix) {
  const row = el('div', 'token-row');
  const name = el('input', 'token-value');
  name.placeholder = `${prefix}-nama`;
  name.value = `${prefix}-`;
  const value = el('input', 'token-value');
  value.placeholder = prefix === 'color' ? '#4f46e5' : prefix === 'font' ? 'Inter, sans-serif' : '16px';
  const commit = () => {
    const n = name.value.trim();
    const v = value.value.trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n)) return toast('Nama token: huruf kecil, angka, dan tanda hubung');
    if (!v) return;
    saveTokens({ ...tokens, [n]: v }, 'Tambah token');
  };
  value.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
  row.append(name, value);
  setTimeout(() => { name.focus(); name.setSelectionRange(name.value.length, name.value.length); });
  return row;
}

function preview(prefix, value) {
  const p = el('span', 'token-preview');
  if (prefix === 'color') p.style.background = value;
  else if (prefix === 'radius') { p.classList.add('outline'); p.style.borderRadius = value; }
  else if (prefix === 'shadow') { p.classList.add('light'); p.style.boxShadow = value; }
  else if (prefix === 'font') { p.textContent = 'Aa'; p.style.fontFamily = value; }
  else if (prefix === 'text') { p.textContent = 'A'; }
  else if (prefix === 'space') { p.classList.add('space'); p.style.width = `min(${value}, 20px)`; }
  return p;
}

// ---------- Pemilih token untuk field properti ----------

let menu = null;

// Tampilkan daftar token satu grup di bawah tombol; onPick menerima "var(--nama)".
export function openTokenMenu(anchor, group, onPick) {
  closeTokenMenu();
  const names = tokensIn(group);
  menu = el('div', 'token-menu');
  if (!names.length) menu.append(el('div', 'token-menu-empty', 'Belum ada token di grup ini'));
  for (const name of names) {
    const item = el('button', 'token-menu-item');
    item.append(preview(group, tokens[name]), el('span', 'token-name', name), el('span', 'token-menu-value', tokens[name]));
    item.addEventListener('click', () => { closeTokenMenu(); onPick(`var(--${name})`); });
    menu.append(item);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
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
