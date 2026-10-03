// Komponen: buat master dari elemen, sisipkan instance, dan sinkronkan instance setiap kali master berubah.
//
// Sinkronisasi berjalan di editor (bukan di server), di semua artboard yang sedang dimuat.
// Instance adalah salinan persis master; untuk membedakan satu instance, lepas (Detach) dulu.
import {
  state, on, emit, docOf, resolve, pathOf, getArtboard, setSelectionList, setSelection, toast,
  COMPONENT_ROLE, COMPONENT_ID, COMPONENT_NAME, demoteMasters,
} from './state.js';
import { recordDoc } from './history.js';
import { scheduleSave } from './persist.js';
import { insertionTarget } from './clipboard.js';
import { fitRect } from './camera.js';
import { rectOf } from './selection.js';

const MASTER = `[${COMPONENT_ROLE}="master"]`;
const INSTANCE = `[${COMPONENT_ROLE}="instance"]`;

let syncTimer;
let syncing = false;

export function initComponents() {
  // Setiap kali isi artboard berubah, cek apakah ada instance yang perlu disamakan dengan master-nya.
  const later = () => {
    if (syncing) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncInstances, 150);
  };
  on('edit', later);
  on('structure', later);
  on('doc', later);
}

// Semua master di semua artboard yang dimuat.
export function listMasters() {
  const masters = [];
  for (const a of state.artboards) {
    const doc = docOf(a.id);
    if (!doc?.body) continue;
    for (const el of doc.body.querySelectorAll(MASTER)) {
      masters.push({ id: el.getAttribute(COMPONENT_ID), name: el.getAttribute(COMPONENT_NAME) || 'Komponen', artboardId: a.id, el });
    }
  }
  return masters;
}

export function findMaster(id) {
  return listMasters().find((m) => m.id === id) ?? null;
}

// Komponen tempat sebuah elemen berada (elemen itu sendiri atau leluhurnya).
export function componentOf(el) {
  const root = el?.closest?.(`[${COMPONENT_ROLE}]`);
  if (!root) return null;
  return { role: root.getAttribute(COMPONENT_ROLE), id: root.getAttribute(COMPONENT_ID), name: root.getAttribute(COMPONENT_NAME) || 'Komponen', root };
}

export function countInstances(id) {
  let n = 0;
  for (const a of state.artboards) n += docOf(a.id)?.querySelectorAll(`${INSTANCE}[${COMPONENT_ID}="${id}"]`).length ?? 0;
  return n;
}

// Ctrl+Alt+K: jadikan elemen terpilih sebagai komponen (master).
export function createComponent() {
  const refs = state.selected.filter((r) => r.path.length);
  if (!refs.length) return toast('Pilih elemen (bukan artboard) untuk dijadikan komponen');
  for (const ref of refs) {
    const el = resolve(ref);
    if (!el) continue;
    if (componentOf(el)) { toast('Elemen ini sudah bagian dari komponen'); continue; }
    recordDoc(ref.artboardId, 'Buat komponen', () => {
      el.setAttribute(COMPONENT_ID, `c-${Math.random().toString(36).slice(2, 8)}`);
      el.setAttribute(COMPONENT_ROLE, 'master');
      el.setAttribute(COMPONENT_NAME, defaultName(el));
    });
    emit('structure', ref.artboardId);
  }
  toast('Komponen dibuat. Sisipkan salinannya dari tab Komponen.');
}

export function insertInstance(id) {
  const master = findMaster(id);
  if (!master) return toast('Master komponen tidak ditemukan');
  const target = insertionTarget();
  if (!target) return toast('Pilih frame, elemen, atau artboard tujuan dulu');
  const doc = target.parent.ownerDocument;
  const instance = demoteMasters(doc.importNode(master.el, true));
  stripIds(instance);
  recordDoc(target.artboardId, 'Sisipkan instance', () => {
    target.parent.insertBefore(instance, target.before);
    setSelectionList([{ artboardId: target.artboardId, path: pathOf(instance) }]);
  });
  emit('structure', target.artboardId);
}

export function detachInstance(ref) {
  const el = resolve(ref);
  const comp = componentOf(el);
  if (!comp || comp.role !== 'instance') return;
  recordDoc(ref.artboardId, 'Detach instance', () => {
    for (const attr of [COMPONENT_ROLE, COMPONENT_ID, COMPONENT_NAME]) comp.root.removeAttribute(attr);
    setSelectionList([{ artboardId: ref.artboardId, path: pathOf(comp.root) }]);
  });
  emit('structure', ref.artboardId);
}

export function goToMaster(id) {
  const master = findMaster(id);
  if (!master) return toast('Master komponen tidak ditemukan');
  const ref = { artboardId: master.artboardId, path: pathOf(master.el) };
  setSelection(ref);
  const rect = rectOf(ref);
  if (rect) fitRect(rect, 2);
}

export function renameComponent(ref, name) {
  const el = resolve(ref);
  if (!el || !name.trim()) return;
  recordDoc(ref.artboardId, 'Ganti nama komponen', () => el.setAttribute(COMPONENT_NAME, name.trim()));
  emit('structure', ref.artboardId);
}

// Samakan setiap instance dengan master-nya (atribut + isi). Tidak masuk riwayat undo,
// karena instance selalu diturunkan dari master: undo di master otomatis ikut memperbaiki instance.
export function syncInstances() {
  const masters = new Map(listMasters().map((m) => [m.id, m.el]));
  if (!masters.size) return;
  const changed = new Set();
  syncing = true;
  try {
    for (const a of state.artboards) {
      const doc = docOf(a.id);
      if (!doc?.body) continue;
      for (const inst of doc.body.querySelectorAll(INSTANCE)) {
        const master = masters.get(inst.getAttribute(COMPONENT_ID));
        if (!master || inst.contains(master) || master.contains(inst)) continue;
        if (applyMaster(inst, master)) changed.add(a.id);
      }
    }
    for (const id of changed) {
      scheduleSave(id);
      emit('structure', id);
    }
  } finally {
    syncing = false;
  }
}

function applyMaster(inst, master) {
  const html = master.innerHTML;
  const attrsSame = sameAttributes(inst, master);
  if (attrsSame && inst.innerHTML === stripIdsHtml(html, inst.ownerDocument)) return false;
  for (const { name } of [...inst.attributes]) {
    if (name !== COMPONENT_ROLE) inst.removeAttribute(name);
  }
  for (const { name, value } of master.attributes) {
    if (name !== COMPONENT_ROLE && name !== 'id') inst.setAttribute(name, value);
  }
  inst.innerHTML = html;
  stripIds(inst);
  return true;
}

function sameAttributes(inst, master) {
  const pick = (el) => [...el.attributes]
    .filter((a) => a.name !== COMPONENT_ROLE && a.name !== 'id')
    .map((a) => `${a.name}=${a.value}`)
    .sort()
    .join('\n');
  return pick(inst) === pick(master);
}

// id harus unik dalam satu halaman, jadi instance tidak membawa id dari master.
function stripIds(root) {
  root.removeAttribute?.('id');
  for (const el of root.querySelectorAll?.('[id]') ?? []) el.removeAttribute('id');
}

function stripIdsHtml(html, doc) {
  if (!html.includes('id=')) return html;
  const tpl = doc.createElement('template');
  tpl.innerHTML = html;
  for (const el of tpl.content.querySelectorAll('[id]')) el.removeAttribute('id');
  return tpl.innerHTML;
}

function defaultName(el) {
  const base = el.getAttribute('aria-label') || el.id || el.classList[0] || el.tagName.toLowerCase();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// ---------- Panel Komponen (tab di panel kiri) ----------

export function renderComponentsPanel(container) {
  const masters = listMasters();
  const frag = document.createDocumentFragment();

  const make = document.createElement('button');
  make.className = 'side-btn';
  make.textContent = 'Jadikan komponen (Ctrl+Alt+K)';
  make.disabled = !state.selected.some((r) => r.path.length);
  make.addEventListener('click', createComponent);
  frag.append(make);

  if (!masters.length) {
    frag.append(note('Belum ada komponen. Pilih elemen (mis. tombol atau kartu), lalu jadikan komponen. Salinannya akan ikut berubah setiap kali master diubah.'));
  } else {
    frag.append(note('Klik untuk menyisipkan salinan ke frame/elemen terpilih.'));
  }
  for (const m of masters) {
    const row = document.createElement('div');
    row.className = 'comp-row';
    const name = document.createElement('span');
    name.className = 'comp-name';
    name.textContent = m.name;
    const meta = document.createElement('span');
    meta.className = 'comp-meta';
    meta.textContent = `${countInstances(m.id)} salinan · ${getArtboard(m.artboardId)?.name ?? ''}`;
    const info = document.createElement('div');
    info.className = 'comp-info';
    info.append(name, meta);
    const go = document.createElement('button');
    go.className = 'icon-text-btn';
    go.title = 'Ke master';
    go.textContent = '→';
    go.addEventListener('click', (e) => { e.stopPropagation(); goToMaster(m.id); });
    row.append(diamond(true), info, go);
    row.title = 'Sisipkan salinan';
    row.addEventListener('click', () => insertInstance(m.id));
    frag.append(row);
  }
  container.replaceChildren(frag);
}

export function diamond(filled) {
  const s = document.createElement('span');
  s.className = `comp-icon${filled ? ' filled' : ''}`;
  return s;
}

function note(text) {
  const p = document.createElement('p');
  p.className = 'side-note';
  p.textContent = text;
  return p;
}
