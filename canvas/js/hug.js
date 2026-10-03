// Hug untuk frame utama: ukuran frame utama otomatis mengikuti isinya (seperti "Hug contents"
// pada frame paling luar di Figma / pen.dev). Pilihannya disimpan di dokumen frame itu sendiri:
// <html data-hug="width height">, jadi ikut tersimpan, ikut undo, dan terbaca Claude.
import { getArtboard, docOf, visibleChildren } from './state.js';
import * as api from './api.js';
import { boxOf } from './group.js';

export function hugOf(id) {
  const value = docOf(id)?.documentElement.getAttribute('data-hug') ?? '';
  return { width: value.includes('width'), height: value.includes('height') };
}

// Ubah pilihan hug (dipanggil di dalam langkah undo milik pemanggil).
export function setHugFlag(id, axis, on) {
  const html = docOf(id)?.documentElement;
  if (!html) return;
  const flags = new Set((html.getAttribute('data-hug') ?? '').split(/\s+/).filter(Boolean));
  if (on) flags.add(axis); else flags.delete(axis);
  if (flags.size) html.setAttribute('data-hug', [...flags].join(' '));
  else html.removeAttribute('data-hug');
}

// Samakan ukuran frame utama dengan isinya (untuk sisi yang memakai hug).
export function syncHug(id) {
  const a = getArtboard(id);
  const doc = docOf(id);
  if (!a || !doc?.body) return;
  const hug = hugOf(id);
  if (!hug.width && !hug.height) return;
  const kids = visibleChildren(doc.body);
  if (!kids.length) return;
  // Ukur dengan tinggi halaman dilepas (min-height: 100vh dan sejenisnya), supaya isi tersusun
  // rapat dari atas. Aturan sementara ini dipasang sebagai stylesheet "adopted", jadi tidak
  // pernah ikut tersimpan ke file.
  const measure = new doc.defaultView.CSSStyleSheet();
  measure.replaceSync('html, body { min-height: 0 !important; height: auto !important; }');
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, measure];
  const cs = doc.defaultView.getComputedStyle(doc.body);
  let right = 0;
  let bottom = 0;
  for (const kid of kids) {
    const r = boxOf(kid);
    const kcs = doc.defaultView.getComputedStyle(kid);
    right = Math.max(right, r.right + (parseFloat(kcs.marginRight) || 0));
    bottom = Math.max(bottom, r.bottom + (parseFloat(kcs.marginBottom) || 0));
  }
  doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((x) => x !== measure);
  const changes = {};
  const width = Math.max(1, Math.ceil(right + parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)));
  const height = Math.max(1, Math.ceil(bottom + parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth)));
  if (hug.width && width !== a.width) changes.width = width;
  if (hug.height && height !== a.height) changes.height = height;
  if (Object.keys(changes).length) api.patchArtboard(id, changes);
}
