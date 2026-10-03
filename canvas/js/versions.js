// Tab "Versi": simpan snapshot bernama dari semua artboard + tokens, dan pulihkan kapan saja.
import { toast } from './state.js';

const timeFormat = new Intl.RelativeTimeFormat('id', { numeric: 'auto' });

export async function renderVersionsPanel(container) {
  const form = document.createElement('div');
  form.className = 'version-form';
  const input = document.createElement('input');
  input.className = 'icon-search';
  input.placeholder = 'Nama versi, mis. "Sebelum revisi klien"';
  const save = document.createElement('button');
  save.className = 'side-btn';
  save.textContent = 'Simpan versi sekarang';
  const doSave = async () => {
    save.disabled = true;
    const ok = await request('/api/versions', 'POST', { name: input.value });
    save.disabled = false;
    if (!ok) return;
    toast('Versi tersimpan');
    renderVersionsPanel(container);
  };
  save.addEventListener('click', doSave);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
  form.append(input, save);

  const list = document.createElement('div');
  const note = document.createElement('p');
  note.className = 'side-note';
  note.textContent = 'Versi menyimpan semua frame dan design tokens. Berbeda dengan undo, versi tetap ada walaupun browser ditutup.';
  container.replaceChildren(form, note, list);

  const data = await request('/api/versions', 'GET');
  if (!data) return;
  if (!data.versions.length) {
    list.append(Object.assign(document.createElement('p'), { className: 'side-note', textContent: 'Belum ada versi tersimpan.' }));
    return;
  }
  for (const v of data.versions) list.append(versionRow(v, container));
}

function versionRow(v, container) {
  const row = document.createElement('div');
  row.className = 'version-row';
  const info = document.createElement('div');
  info.className = 'comp-info';
  const name = document.createElement('span');
  name.className = 'comp-name';
  name.textContent = v.name;
  const meta = document.createElement('span');
  meta.className = 'comp-meta';
  meta.textContent = `${relativeTime(v.createdAt)} · ${v.artboards.length} frame`;
  meta.title = new Date(v.createdAt).toLocaleString('id-ID');
  info.append(name, meta);

  const restore = document.createElement('button');
  restore.className = 'small-btn';
  restore.textContent = 'Pulihkan';
  restore.addEventListener('click', async () => {
    if (!confirm(`Pulihkan versi "${v.name}"?\n\nKondisi sekarang otomatis disimpan dulu sebagai versi baru, jadi bisa dikembalikan.`)) return;
    const res = await request(`/api/versions/${encodeURIComponent(v.id)}/restore`, 'POST');
    if (!res) return;
    toast(`Versi "${v.name}" dipulihkan`);
    renderVersionsPanel(container);
  });

  const del = document.createElement('button');
  del.className = 'token-del';
  del.textContent = '×';
  del.title = 'Hapus versi';
  del.addEventListener('click', async () => {
    if (!confirm(`Hapus versi "${v.name}"? Ini tidak bisa dibatalkan.`)) return;
    if (await request(`/api/versions/${encodeURIComponent(v.id)}`, 'DELETE')) renderVersionsPanel(container);
  });

  row.append(info, restore, del);
  return row;
}

function relativeTime(iso) {
  const seconds = (new Date(iso) - Date.now()) / 1000;
  const steps = [[60, 'second'], [3600, 'minute', 60], [86400, 'hour', 3600], [604800, 'day', 86400], [Infinity, 'week', 604800]];
  for (const [limit, unit, div = 1] of steps) {
    if (Math.abs(seconds) < limit) return timeFormat.format(Math.round(seconds / div), unit);
  }
  return '';
}

async function request(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return await res.json();
  } catch (err) {
    toast(`Gagal: ${err.message}`);
    return null;
  }
}
