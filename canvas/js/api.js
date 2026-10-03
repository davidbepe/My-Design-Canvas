// Permintaan ke server untuk mengubah daftar artboard. Tampilan diperbarui langsung
// (tanpa menunggu server) supaya terasa instan.
import { state, getArtboard, toast } from './state.js';
import { renderArtboards } from './artboards.js';

export async function patchArtboard(id, changes) {
  const a = getArtboard(id);
  if (a) {
    Object.assign(a, changes);
    renderArtboards();
  }
  await request(`/api/artboards/${encodeURIComponent(id)}`, 'PATCH', changes);
}

export async function createArtboard(data) {
  const artboard = await request('/api/artboards', 'POST', data);
  if (artboard && !getArtboard(artboard.id)) {
    state.artboards.push(artboard);
    renderArtboards();
  }
  return artboard;
}

export async function deleteArtboard(id) {
  state.artboards = state.artboards.filter((a) => a.id !== id);
  renderArtboards();
  await request(`/api/artboards/${encodeURIComponent(id)}`, 'DELETE');
}

async function request(url, method, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    toast('Server terputus: perubahan frame ini belum tersimpan');
    return null;
  }
  if (!res.ok) {
    console.error(`${method} ${url} gagal:`, await res.text());
    return null;
  }
  return res.json();
}
