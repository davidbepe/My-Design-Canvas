// Menampilkan artboard di kanvas, masing-masing sebagai iframe dengan ukuran persis.
import { state, emit } from './state.js';

let worldEl;

export function initArtboards(world) {
  worldEl = world;
}

export function renderArtboards() {
  const seen = new Set();
  for (const a of state.artboards) {
    seen.add(a.id);
    let node = state.nodes.get(a.id);
    if (!node) {
      node = createNode(a);
      state.nodes.set(a.id, node);
      worldEl.append(node.el);
    }
    node.label.querySelector('.name').textContent = a.name;
    if (node.file !== a.file) {
      node.file = a.file;
      reloadArtboard(a.id, Date.now());
    }
  }
  for (const [id, node] of state.nodes) {
    if (!seen.has(id)) { node.el.remove(); state.nodes.delete(id); }
  }
  layoutArtboards();
  emit('artboards');
}

// Hanya memperbarui posisi & ukuran. Ringan, dipakai saat artboard sedang di-drag atau di-resize.
export function layoutArtboards() {
  for (const a of state.artboards) {
    const node = state.nodes.get(a.id);
    if (!node) continue;
    Object.assign(node.el.style, {
      left: `${a.x}px`, top: `${a.y}px`, width: `${a.width}px`, height: `${a.height}px`,
    });
    node.el.style.setProperty('--w', a.width);
    node.label.querySelector('.size').textContent = `${a.width} × ${a.height}`;
  }
  emit('layout');
}

function createNode(a) {
  const el = document.createElement('div');
  el.className = 'artboard';
  el.dataset.id = a.id;
  const label = document.createElement('div');
  label.className = 'artboard-label';
  label.innerHTML = '<span class="name"></span><span class="size"></span>';
  el.append(label);
  return { el, label, iframe: null, pending: null, file: null };
}

// Muat versi baru di iframe tersembunyi dulu, lalu tukar setelah selesai dimuat,
// supaya tidak ada kedipan putih saat Claude mengubah desain.
export function reloadArtboard(id, version) {
  const node = state.nodes.get(id);
  if (!node?.file) return;
  const next = document.createElement('iframe');
  next.title = id;
  next.style.visibility = 'hidden';
  next.src = `/designs/${encodeURIComponent(node.file)}?v=${version}`;
  node.pending = next;
  next.addEventListener('load', () => {
    if (node.pending !== next) { next.remove(); return; } // sudah ada versi yang lebih baru
    node.pending = null;
    const old = node.iframe;
    // Beri kesempatan modul lain (undo) mencatat isi lama sebelum ditukar.
    if (old) emit('beforeswap', id);
    const before = old ? serialize(old.contentDocument) : null;
    if (old) old.remove();
    node.iframe = next;
    next.style.visibility = '';
    syncArtboardCorners(id);
    emit('doc', id);
    if (before !== null) emit('external', { id, before });
    // Font web bisa selesai dimuat belakangan dan menggeser layout.
    next.contentDocument?.fonts?.ready.then(() => emit('layout'));
  }, { once: true });
  node.el.append(next);
}

// HTML artboard untuk disimpan. Elemen bantu editor ([data-editor-temp]) tidak ikut tersimpan.
// Radius artboard (border-radius pada <body>) ikut membulatkan kotak artboard di kanvas,
// seperti corner radius pada frame di Figma.
//
// Iframe TIDAK dipotong (dipotong tepat di tepinya akan "memakan" border tipis). Sebagai gantinya,
// latar artboard dibuat transparan dan <body> menggambar sudut, latar putih, dan border-nya sendiri.
// Aturan bantu ini dipasang sebagai stylesheet "adopted", jadi tidak ikut tersimpan ke file.
export function syncArtboardCorners(id) {
  const node = state.nodes.get(id);
  const doc = node?.iframe?.contentDocument;
  if (!doc?.body) return;
  setCornerSheet(doc, null); // baca gaya asli body tanpa aturan bantu
  const cs = doc.defaultView.getComputedStyle(doc.body);
  const radius = cs.borderRadius && cs.borderRadius !== '0px' ? cs.borderRadius : '';
  node.el.style.borderRadius = radius;
  node.el.classList.toggle('rounded', !!radius);
  if (!radius) return;
  const hasBackground = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none';
  // Latar <html> yang (hampir) transparan mencegah latar body "tumpah" ke seluruh kotak iframe,
  // sehingga latar body ikut melengkung mengikuti radius-nya.
  setCornerSheet(doc, `html { background: rgba(255, 255, 255, 0.004) !important; }${hasBackground ? '' : ' body { background-color: #fff; }'}`);
}

function setCornerSheet(doc, css) {
  let sheets = doc.adoptedStyleSheets.filter((s) => !s.editorCorners);
  if (css) {
    const sheet = new doc.defaultView.CSSStyleSheet();
    sheet.replaceSync(css);
    sheet.editorCorners = true;
    sheets = [...sheets, sheet];
  }
  doc.adoptedStyleSheets = sheets;
}

export function serialize(doc) {
  if (!doc) return null;
  let root = doc.documentElement;
  if (root.querySelector('[data-editor-temp]')) {
    root = root.cloneNode(true);
    for (const el of root.querySelectorAll('[data-editor-temp]')) el.remove();
  }
  return `<!doctype html>\n${root.outerHTML}\n`;
}
