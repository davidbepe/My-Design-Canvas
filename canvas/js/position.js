// Posisi elemen: "Ikut layout" (normal, diatur auto layout/flow) atau "Bebas" (position: absolute,
// bisa di-drag di kanvas dan diatur lewat X/Y). Ini setara "Absolute position" di Figma.

export function isFree(el) {
  const pos = el.ownerDocument.defaultView.getComputedStyle(el).position;
  return pos === 'absolute' || pos === 'fixed';
}

// Jadikan bebas tanpa berpindah tempat di layar: hitung posisinya relatif ke induk.
export function makeFree(el) {
  const doc = el.ownerDocument;
  const parent = el.parentElement;
  if (doc.defaultView.getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const r = el.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  // Kunci ukurannya dulu supaya tidak menyusut/melebar setelah keluar dari layout.
  if (!el.style.width) el.style.width = `${round(r.width)}px`;
  if (!el.style.height) el.style.height = `${round(r.height)}px`;
  el.style.position = 'absolute';
  el.style.margin = '0';
  el.style.left = `${round(r.left - pr.left - parent.clientLeft + parent.scrollLeft)}px`;
  el.style.top = `${round(r.top - pr.top - parent.clientTop + parent.scrollTop)}px`;
}

export function makeFlow(el) {
  for (const p of ['position', 'left', 'top', 'right', 'bottom']) el.style.removeProperty(p);
}

// Posisi left/top saat ini dalam px (dari inline style, atau hasil hitungan browser).
export function freePosition(el) {
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  return { left: parseFloat(el.style.left || cs.left) || 0, top: parseFloat(el.style.top || cs.top) || 0 };
}

const round = (n) => Math.round(n * 100) / 100;
