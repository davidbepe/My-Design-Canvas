// Copy / cut / paste (Ctrl+C / X / V) memakai clipboard sistem, plus gambar (paste & drag-drop) dan ikon.
//
// Yang di-copy ditulis sebagai HTML ke clipboard, jadi bisa di-paste ke VS Code, dan sebaliknya:
// HTML atau teks biasa dari luar bisa di-paste ke kanvas.
import {
  state, emit, resolve, pathOf, getArtboard, setSelectionList, isEditableTarget, toast, CONTAINER_TAGS,
  demoteMasters, demoteMastersInHtml,
} from './state.js';
import { recordDoc, group, snapshot } from './history.js';
import { createArtboardWithHistory, deleteSelection } from './actions.js';
import { isEditingText } from './textedit.js';
import { insertionAt } from './draw.js';
import { screenToWorld, toLocal } from './camera.js';

const GAP = 80;
let internal = null; // { text, items } dari copy terakhir di editor ini

export function initClipboard(viewportEl) {
  document.addEventListener('copy', (e) => onCopy(e, false));
  document.addEventListener('cut', (e) => onCopy(e, true));
  document.addEventListener('paste', onPaste);

  // Drag-drop file gambar dari Explorer ke kanvas.
  viewportEl.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  viewportEl.addEventListener('drop', async (e) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const { sx, sy } = toLocal(e);
    const point = screenToWorld(sx, sy);
    await group('Tambah gambar', async () => {
      for (const file of files) await insertImageFile(file, point);
    });
  });
}

// ---------- Copy / cut ----------

// Jendela kode/preview terbuka, atau ada teks yang sedang diblok: biarkan copy-paste bawaan browser.
const nativeClipboard = () => !!document.querySelector('.modal:not([hidden])') || !getSelection().isCollapsed;

function onCopy(e, cut) {
  if (isEditableTarget(e.target) || isEditingText() || nativeClipboard() || !state.selected.length) return;
  const items = [];
  for (const ref of state.selected) {
    if (!ref.path.length) {
      const a = getArtboard(ref.artboardId);
      if (a) items.push({ type: 'artboard', html: snapshot(a.id), data: { name: a.name, width: a.width, height: a.height } });
    } else {
      const el = resolve(ref);
      if (el) items.push({ type: 'element', html: el.outerHTML });
    }
  }
  if (!items.length) return;
  e.preventDefault();
  const text = items.map((i) => i.html).join('\n');
  e.clipboardData.setData('text/plain', text);
  internal = { text, items };
  toast(`${items.length} item ${cut ? 'dipotong' : 'disalin'}`);
  if (cut) deleteSelection();
}

// ---------- Paste ----------

async function onPaste(e) {
  if (isEditableTarget(e.target) || isEditingText() || document.querySelector('.modal:not([hidden])')) return;
  const dt = e.clipboardData;
  const images = [...dt.files].filter((f) => f.type.startsWith('image/'));
  const text = dt.getData('text/plain');
  if (!images.length && !text.trim()) return;
  e.preventDefault();

  if (images.length) {
    return group('Paste gambar', async () => {
      for (const file of images) await insertImageFile(file);
    });
  }
  if (internal && text === internal.text) return pasteItems(internal.items);
  // Dari luar editor: HTML kalau diawali "<", selain itu teks biasa jadi paragraf.
  const html = text.trim().startsWith('<') ? text : `<p>${escapeHtml(text.trim())}</p>`;
  pasteItems([{ type: 'element', html }]);
}

async function pasteItems(items) {
  const elements = items.filter((i) => i.type === 'element');
  const artboards = items.filter((i) => i.type === 'artboard');
  const target = elements.length ? insertionTarget(elements) : null;
  if (elements.length && !target) {
    toast('Pilih frame, elemen, atau artboard tujuan dulu');
    if (!artboards.length) return;
  }

  const pasted = [];
  await group('Paste', async () => {
    if (target) {
      const doc = target.parent.ownerDocument;
      const nodes = elements.flatMap((i) => parseNodes(doc, i.html));
      recordDoc(target.artboardId, 'Paste', () => {
        for (const n of nodes) target.parent.insertBefore(n, target.before);
        for (const n of nodes) pasted.push({ artboardId: target.artboardId, path: pathOf(n) });
        setSelectionList(pasted);
      });
      emit('structure', target.artboardId);
    }
    let x = Math.max(0, ...state.artboards.map((a) => a.x + a.width)) + GAP;
    for (const item of artboards) {
      const created = await createArtboardWithHistory(
        { ...item.data, name: `${item.data.name} copy`, x, y: 0, html: demoteMastersInHtml(item.html) }, 'Paste artboard',
      );
      if (created) {
        pasted.push({ artboardId: created.id, path: [] });
        x += created.width + GAP;
      }
    }
  });
  setSelectionList(pasted);
}

// Tujuan paste/sisip berdasarkan seleksi utama:
// frame/artboard → masuk ke dalamnya; elemen biasa → tepat setelahnya.
export function insertionTarget(items = []) {
  const ref = state.selection;
  const el = resolve(ref);
  if (!el) return null;
  // Paste elemen yang baru di-copy saat elemen itu sendiri masih terpilih → taruh di sebelahnya.
  const isSelf = items.some((i) => i.html === el.outerHTML);
  if ((!ref.path.length || CONTAINER_TAGS.has(el.tagName)) && !isSelf) {
    return { artboardId: ref.artboardId, parent: el, before: null };
  }
  return { artboardId: ref.artboardId, parent: el.parentElement, before: el.nextSibling };
}

function parseNodes(doc, html) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  const nodes = [...tpl.content.children];
  for (const n of nodes) {
    demoteMasters(n); // paste sebuah master = instance-nya
    // id harus unik dalam satu halaman
    for (const withId of [n, ...n.querySelectorAll('[id]')]) {
      if (withId.id && doc.getElementById(withId.id)) withId.removeAttribute('id');
    }
  }
  return nodes;
}

// ---------- Gambar ----------

async function uploadImage(file) {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name || 'gambar') },
    body: file,
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).src; // mis. "assets/foto-1a2b3c4d.png"
}

function naturalSize(url) {
  return new Promise((done) => {
    const img = new Image();
    img.onload = () => done({ w: img.naturalWidth || 200, h: img.naturalHeight || 200 });
    img.onerror = () => done({ w: 200, h: 200 });
    img.src = url;
  });
}

// Sisipkan gambar: di titik drop (point), di tujuan seleksi, atau jadi artboard baru kalau di luar artboard.
async function insertImageFile(file, point) {
  let src;
  try {
    src = await uploadImage(file);
  } catch (err) {
    return toast(`Gagal mengunggah gambar: ${err.message}`);
  }
  const { w, h } = await naturalSize(`/designs/${src}`);
  const alt = (file.name || 'gambar').replace(/\.[^.]+$/, '');
  const target = point ? insertionAt(point.x, point.y) : insertionTarget();

  if (!target) {
    const width = Math.min(w, 1440);
    const created = await createArtboardWithHistory({
      name: alt,
      width,
      height: Math.max(1, Math.round((h * width) / w)),
      x: point ? Math.round(point.x) : undefined,
      y: point ? Math.round(point.y) : undefined,
      html: `<img src="${src}" alt="${escapeHtml(alt)}" style="display: block; width: 100%; height: auto;">`,
    }, 'Tambah gambar');
    if (created) setSelectionList([{ artboardId: created.id, path: [] }]);
    return;
  }

  const doc = target.parent.ownerDocument;
  const cs = doc.defaultView.getComputedStyle(target.parent);
  const room = target.parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const img = doc.createElement('img');
  img.src = src;
  img.alt = alt;
  img.style.cssText = `display: block; width: ${Math.round(Math.min(w, Math.max(40, room)))}px; `
    + 'max-width: 100%; height: auto; flex-shrink: 0;';
  recordDoc(target.artboardId, 'Tambah gambar', () => {
    target.parent.insertBefore(img, target.before);
    setSelectionList([{ artboardId: target.artboardId, path: pathOf(img) }]);
  });
  emit('structure', target.artboardId);
  img.addEventListener('load', () => emit('layout'), { once: true });
}

// ---------- Ikon ----------

export function insertIcon(name, svgMarkup) {
  const target = insertionTarget();
  if (!target) return toast('Pilih frame, elemen, atau artboard tujuan dulu');
  const doc = target.parent.ownerDocument;
  const [svg] = parseNodes(doc, svgMarkup);
  if (!svg) return;
  svg.setAttribute('aria-label', name); // jadi nama layer
  svg.style.cssText = 'width: 24px; height: 24px; flex-shrink: 0;';
  recordDoc(target.artboardId, 'Tambah ikon', () => {
    target.parent.insertBefore(svg, target.before);
    setSelectionList([{ artboardId: target.artboardId, path: pathOf(svg) }]);
  });
  emit('structure', target.artboardId);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
