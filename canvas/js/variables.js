// Tab "Variabel": kelola design system (grup, variabel, mode) seperti Variables di Figma / Webflow.
// - Panel kiri: daftar ringkas per grup, edit nilai untuk satu mode.
// - Tabel (tombol ⤢): semua mode berdampingan sebagai kolom.
import { state, docOf, toast } from './state.js';
import { recordDoc, group } from './history.js';
import { data, tokensIn, cloneData, saveVariables, tokenPreview, modeSlug, legacyServer } from './tokens.js';
import { openFontMenu, primaryFamily, fontFamilyValue } from './fonts.js';
import { openColorPicker } from './colorpicker.js';

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TYPES = [['color', 'Warna'], ['size', 'Ukuran (px)'], ['font', 'Font'], ['text', 'Teks bebas']];

let panelMode = null; // mode yang sedang diedit di panel kiri
let modal = null;
let modalFilter = 'all';

// ---------- Panel kiri ----------

export function renderVariablesPanel(container) {
  if (legacyServer) {
    container.replaceChildren(el('p', 'side-note', 'Server masih versi lama, jadi variabel belum bisa dimuat. Di terminal tempat server berjalan, tekan Ctrl+C lalu jalankan lagi "npm.cmd start", kemudian refresh halaman ini.'));
    return;
  }
  if (!data.modes.includes(panelMode)) panelMode = data.modes[0];
  const frag = document.createDocumentFragment();

  const top = el('div', 'var-top');
  if (data.modes.length > 1) {
    const select = el('select', 'var-mode');
    for (const m of data.modes) select.append(new Option(`Mode: ${m}`, m, false, m === panelMode));
    select.addEventListener('change', () => { panelMode = select.value; renderVariablesPanel(container); });
    top.append(select);
  } else {
    top.append(el('span', 'side-note tight', `${Object.keys(data.tokens).length} variabel`));
  }
  const table = el('button', 'small-btn', '⤢ Tabel & mode');
  table.title = 'Buka tabel: semua mode berdampingan, tambah mode (mis. Dark)';
  table.addEventListener('click', openVariablesTable);
  top.append(table);
  frag.append(top);

  for (const g of [...data.groups, { id: 'other', name: 'Lainnya', type: 'text' }]) {
    const names = tokensIn(g.id);
    if (g.id === 'other' && !names.length) continue;
    const section = el('div', 'var-group');
    const head = el('div', 'var-group-head');
    head.append(el('span', 'var-group-name', g.name), el('span', 'var-group-count', String(names.length)));
    if (g.id !== 'other') {
      const add = el('button', 'icon-text-btn', '+');
      add.title = `Tambah variabel ${g.name.toLowerCase()}`;
      add.addEventListener('click', () => section.append(newVariableRow(g, panelMode)));
      head.append(add);
      if (!names.length) {
        const del = el('button', 'icon-text-btn', '×');
        del.title = 'Hapus grup kosong ini';
        del.addEventListener('click', () => deleteGroup(g.id));
        head.append(del);
      }
    }
    section.append(head);
    for (const name of names) section.append(variableRow(name, g, panelMode));
    frag.append(section);
  }

  const addGroup = el('button', 'side-btn', '+ Grup baru');
  addGroup.addEventListener('click', () => addGroup.replaceWith(newGroupForm(() => renderVariablesPanel(container))));
  frag.append(addGroup);
  frag.append(el('p', 'side-note', 'Variabel dipakai desain lewat var(--nama). Ubah nilainya di sini, dan semua desain yang memakainya ikut berubah. Di panel kanan, tombol ◇ memasang variabel ke properti.'));
  container.replaceChildren(frag);
}

function variableRow(name, g, mode) {
  const row = el('div', 'token-row');
  const value = data.tokens[name][mode] ?? '';
  const fallback = data.tokens[name][data.modes[0]];
  // Warna sudah punya kotak pemilih warna, jadi pratinjau tambahan hanya untuk tipe lain.
  if (g.type !== 'color') row.append(tokenPreview(g.id, value || fallback));
  const label = el('span', 'token-name', name);
  label.title = 'Double-click untuk ganti nama';
  label.addEventListener('dblclick', () => startRename(label, name));
  row.append(label);
  row.append(valueEditor(g, value, fallback, (v) => setValue(name, mode, v)));
  const del = el('button', 'token-del', '×');
  del.title = 'Hapus variabel';
  del.addEventListener('click', () => deleteVariable(name));
  row.append(del);
  return row;
}

function newVariableRow(g, mode) {
  const row = el('div', 'token-row');
  const name = el('input', 'token-value grow');
  name.value = `${g.id}-`;
  name.placeholder = `${g.id}-nama`;
  const value = el('input', 'token-value');
  value.placeholder = g.type === 'color' ? '#4f46e5' : g.type === 'size' ? '16px' : g.type === 'font' ? 'Inter, sans-serif' : 'nilai';
  const commit = async () => {
    const n = name.value.trim();
    const v = value.value.trim();
    if (!NAME.test(n)) return toast('Nama variabel: huruf kecil, angka, dan tanda hubung (mis. color-brand)');
    if (data.tokens[n]) return toast(`Variabel "${n}" sudah ada`);
    if (!v) return value.focus();
    const next = cloneData();
    next.tokens[n] = { [data.modes[0]]: v };
    if (mode !== data.modes[0]) next.tokens[n][mode] = v;
    await saveVariables(next, 'Tambah variabel');
  };
  for (const input of [name, value]) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
  row.append(name, value);
  setTimeout(() => { name.focus(); name.setSelectionRange(name.value.length, name.value.length); });
  return row;
}

// Editor nilai sesuai tipe grup: warna (swatch), font (pilih Google Font), atau teks.
function valueEditor(g, value, fallback, onCommit) {
  const wrap = el('div', 'var-value');
  const input = el('input', 'token-value');
  input.value = value;
  input.placeholder = fallback ?? '';
  input.spellcheck = false;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('change', () => onCommit(input.value.trim()));
  if (g.type === 'color') {
    // Color picker ala Figma; nilai disimpan saat picker ditutup (bukan di setiap gerakan drag).
    const swatch = el('button', 'swatch-btn');
    swatch.title = 'Pilih warna';
    swatch.style.setProperty('--sw', value || fallback || '#000000');
    swatch.addEventListener('click', () => openColorPicker(swatch, {
      value: value || fallback || '#000000',
      onInput: (css) => { swatch.style.setProperty('--sw', css); input.value = css; },
      onClose: (css, changed) => { if (changed) onCommit(css); },
    }));
    wrap.append(swatch);
  }
  wrap.append(input);
  if (g.type === 'font') {
    const pick = el('button', 'token-btn', '▾');
    pick.title = 'Pilih Google Font';
    pick.addEventListener('click', () => openFontMenu(pick, primaryFamily(value || fallback || ''), (font) => onCommit(fontFamilyValue(font))));
    wrap.append(pick);
  }
  return wrap;
}

// ---------- Operasi ----------

async function setValue(name, mode, value) {
  const next = cloneData();
  if (!value) {
    if (mode === data.modes[0]) return toast('Mode default harus punya nilai');
    delete next.tokens[name][mode]; // kosong = ikut nilai mode default
  } else {
    next.tokens[name][mode] = value;
  }
  await saveVariables(next, 'Ubah variabel');
}

async function deleteVariable(name) {
  const next = cloneData();
  delete next.tokens[name];
  await saveVariables(next, 'Hapus variabel');
}

async function deleteGroup(id) {
  const next = cloneData();
  next.groups = next.groups.filter((g) => g.id !== id);
  await saveVariables(next, 'Hapus grup');
}

function startRename(label, oldName) {
  const input = el('input', 'token-value grow');
  input.value = oldName;
  label.replaceWith(input);
  input.focus();
  input.select();
  const done = async (save) => {
    input.removeEventListener('blur', onBlur);
    const n = input.value.trim();
    if (!save || n === oldName) return input.replaceWith(label);
    if (!NAME.test(n)) { toast('Nama variabel: huruf kecil, angka, dan tanda hubung'); return input.replaceWith(label); }
    if (data.tokens[n]) { toast(`Variabel "${n}" sudah ada`); return input.replaceWith(label); }
    await renameVariable(oldName, n);
  };
  const onBlur = () => done(true);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
}

// Ganti nama variabel, lalu perbarui semua desain yang memakai var(--nama-lama).
async function renameVariable(oldName, newName) {
  const next = cloneData();
  next.tokens = Object.fromEntries(Object.entries(next.tokens).map(([n, v]) => [n === oldName ? newName : n, v]));
  const source = `var\\(--${oldName}(?=[\\s,)])`;
  const uses = new RegExp(source); // untuk mengecek
  const all = new RegExp(source, 'g'); // untuk mengganti semua kemunculan
  const replacement = `var(--${newName}`;
  let updated = 0;
  await group('Ganti nama variabel', async () => {
    if (!(await saveVariables(next, 'Ganti nama variabel'))) return;
    for (const a of state.artboards) {
      const doc = docOf(a.id);
      if (!doc) continue;
      const styled = [...doc.querySelectorAll('[style]')].filter((e) => uses.test(e.getAttribute('style')));
      const sheets = [...doc.querySelectorAll('style')].filter((s) => uses.test(s.textContent));
      if (!styled.length && !sheets.length) continue;
      recordDoc(a.id, 'Ganti nama variabel', () => {
        for (const e of styled) e.setAttribute('style', e.getAttribute('style').replace(all, replacement));
        for (const s of sheets) s.textContent = s.textContent.replace(all, replacement);
      });
      updated++;
    }
  });
  toast(updated ? `Nama diganti; ${updated} artboard ikut diperbarui` : 'Nama variabel diganti');
}

function newGroupForm(onDone) {
  const form = el('div', 'var-group-form');
  const name = el('input', 'icon-search');
  name.placeholder = 'Nama grup, mis. Elevasi';
  const prefix = el('input', 'icon-search');
  prefix.placeholder = 'Awalan nama variabel, mis. elevation';
  const type = el('select', 'var-mode');
  for (const [v, label] of TYPES) type.append(new Option(`Tipe: ${label}`, v));
  name.addEventListener('input', () => {
    prefix.value = name.value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
  });
  const save = el('button', 'small-btn wide', 'Buat grup');
  save.addEventListener('click', async () => {
    const id = prefix.value.trim();
    if (!name.value.trim() || !/^[a-z0-9]+$/.test(id)) return toast('Isi nama grup dan awalan (huruf kecil/angka, tanpa spasi)');
    if (data.groups.some((g) => g.id === id)) return toast(`Grup dengan awalan "${id}" sudah ada`);
    const next = cloneData();
    next.groups.push({ id, name: name.value.trim(), type: type.value });
    if (await saveVariables(next, 'Tambah grup')) onDone();
  });
  form.append(name, prefix, type, save);
  setTimeout(() => name.focus());
  return form;
}

// ---------- Tabel (semua mode berdampingan) ----------

export const isVariablesOpen = () => !!modal && !modal.hidden;

export function openVariablesTable() {
  modal = document.getElementById('variables-modal');
  modal.hidden = false;
  renderTable();
}

export function closeVariablesTable() {
  if (modal) modal.hidden = true;
}

export function refreshVariablesTable() {
  if (isVariablesOpen()) renderTable();
}

function renderTable() {
  const side = modal.querySelector('.var-side');
  const main = modal.querySelector('.var-main');
  modal.querySelector('.var-add-mode').onclick = addMode;
  modal.querySelector('.var-close').onclick = closeVariablesTable;

  // Sidebar: filter grup
  side.replaceChildren();
  for (const g of [{ id: 'all', name: 'Semua' }, ...data.groups]) {
    const btn = el('button', 'var-side-item', g.name);
    btn.classList.toggle('on', modalFilter === g.id);
    if (g.id !== 'all') btn.append(el('span', 'var-group-count', String(tokensIn(g.id).length)));
    btn.addEventListener('click', () => { modalFilter = g.id; renderTable(); });
    side.append(btn);
  }
  const addGroup = el('button', 'side-btn', '+ Grup baru');
  addGroup.addEventListener('click', () => addGroup.replaceWith(newGroupForm(renderTable)));
  side.append(addGroup);

  // Tabel
  const tableEl = el('table', 'var-table');
  const head = el('tr');
  head.append(el('th', 'var-col-name', 'Nama'));
  data.modes.forEach((m, i) => head.append(modeHeader(m, i)));
  head.append(el('th', 'var-col-del'));
  const thead = el('thead');
  thead.append(head);
  tableEl.append(thead);
  const body = el('tbody');
  const groups = [...data.groups, { id: 'other', name: 'Lainnya', type: 'text' }].filter((g) => modalFilter === 'all' || g.id === modalFilter);
  for (const g of groups) {
    const names = tokensIn(g.id);
    if (g.id === 'other' && !names.length) continue;
    const gr = el('tr', 'var-group-row');
    const cell = el('td');
    cell.colSpan = data.modes.length + 2;
    cell.append(el('span', 'var-group-name', g.name));
    if (g.id !== 'other') {
      const add = el('button', 'small-btn', '+ Variabel');
      add.addEventListener('click', () => gr.after(newTableRow(g)));
      cell.append(add);
    }
    gr.append(cell);
    body.append(gr);
    for (const name of names) body.append(tableRow(name, g));
  }
  tableEl.append(body);
  main.replaceChildren(tableEl);
}

function modeHeader(mode, index) {
  const th = el('th', 'var-col-mode');
  const input = el('input', 'var-mode-name');
  input.value = mode;
  input.title = index === 0 ? 'Mode default (dipakai kalau artboard tidak memilih mode)' : 'Ganti nama mode';
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  input.addEventListener('change', () => renameMode(mode, input.value.trim()));
  th.append(input);
  if (index === 0) th.append(el('span', 'var-default', 'default'));
  else {
    const del = el('button', 'token-del visible', '×');
    del.title = 'Hapus mode';
    del.addEventListener('click', () => deleteMode(mode));
    th.append(del);
  }
  return th;
}

function tableRow(name, g) {
  const tr = el('tr');
  const nameCell = el('td', 'var-col-name');
  const label = el('span', 'token-name', name);
  label.title = 'Double-click untuk ganti nama';
  label.addEventListener('dblclick', () => startRename(label, name));
  nameCell.append(tokenPreview(g.id, data.tokens[name][data.modes[0]]), label);
  tr.append(nameCell);
  for (const m of data.modes) {
    const td = el('td');
    const value = data.tokens[name][m] ?? '';
    td.append(valueEditor(g, value, m === data.modes[0] ? '' : data.tokens[name][data.modes[0]], (v) => setValue(name, m, v)));
    tr.append(td);
  }
  const del = el('td', 'var-col-del');
  const btn = el('button', 'token-del', '×');
  btn.title = 'Hapus variabel';
  btn.addEventListener('click', () => deleteVariable(name));
  del.append(btn);
  tr.append(del);
  return tr;
}

function newTableRow(g) {
  const tr = el('tr');
  const td = el('td');
  td.colSpan = data.modes.length + 2;
  td.append(newVariableRow(g, data.modes[0]));
  tr.append(td);
  return tr;
}

async function addMode() {
  let n = data.modes.length + 1;
  while (data.modes.includes(`Mode ${n}`)) n++;
  const next = cloneData();
  next.modes.push(data.modes.length === 1 ? 'Dark' : `Mode ${n}`);
  if (await saveVariables(next, 'Tambah mode')) {
    toast('Mode ditambahkan. Isi nilai yang berbeda; kolom kosong ikut nilai default. Pilih mode per artboard di panel kanan.');
  }
}

// Mode lama dipakai artboard lewat <html data-mode="slug">, jadi atribut itu ikut diperbarui.
async function renameMode(oldMode, newMode) {
  if (!newMode || newMode === oldMode) return renderTable();
  if (data.modes.some((m) => m !== oldMode && modeSlug(m) === modeSlug(newMode))) { toast('Nama mode sudah dipakai'); return renderTable(); }
  const next = cloneData();
  next.modes = next.modes.map((m) => (m === oldMode ? newMode : m));
  for (const byMode of Object.values(next.tokens)) {
    if (oldMode in byMode) { byMode[newMode] = byMode[oldMode]; delete byMode[oldMode]; }
  }
  await group('Ganti nama mode', async () => {
    if (!(await saveVariables(next, 'Ganti nama mode'))) return;
    updateArtboardModes(modeSlug(oldMode), modeSlug(newMode));
  });
}

async function deleteMode(mode) {
  if (!confirm(`Hapus mode "${mode}" beserta nilainya?`)) return;
  const next = cloneData();
  next.modes = next.modes.filter((m) => m !== mode);
  for (const byMode of Object.values(next.tokens)) delete byMode[mode];
  await group('Hapus mode', async () => {
    if (!(await saveVariables(next, 'Hapus mode'))) return;
    updateArtboardModes(modeSlug(mode), null);
  });
}

function updateArtboardModes(oldSlug, newSlug) {
  for (const a of state.artboards) {
    const root = docOf(a.id)?.documentElement;
    if (root?.getAttribute('data-mode') !== oldSlug) continue;
    recordDoc(a.id, 'Ganti mode artboard', () => {
      if (newSlug) root.setAttribute('data-mode', newSlug);
      else root.removeAttribute('data-mode');
    });
  }
}

// ---------- Helper ----------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

