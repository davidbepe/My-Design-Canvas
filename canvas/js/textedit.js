// Edit teks langsung di kanvas (double-click), dan ganti nama artboard (double-click namanya).
import { state, emit, resolve, getArtboard } from './state.js';
import { snapshot, pushDoc } from './history.js';
import { scheduleSave } from './persist.js';
import { changeArtboard } from './actions.js';

const NOT_TEXT = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'HR']);

let editing = null;

export const isEditingText = () => !!editing;

export function isTextLeaf(el) {
  return !!el && el.children.length === 0 && !NOT_TEXT.has(el.tagName.toUpperCase()) && el.textContent.trim() !== '';
}

export function startTextEdit(ref) {
  finishTextEdit();
  const el = resolve(ref);
  const node = state.nodes.get(ref.artboardId);
  if (!isTextLeaf(el) || !node?.iframe) return false;

  const doc = el.ownerDocument;
  const before = snapshot(ref.artboardId);
  const original = el.textContent;
  // Iframe sementara boleh menerima mouse supaya kursor teks bisa ditaruh di mana saja.
  node.iframe.style.pointerEvents = 'auto';
  el.setAttribute('contenteditable', 'plaintext-only');
  el.focus();
  doc.getSelection().selectAllChildren(el);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finishTextEdit(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishTextEdit(); }
  };
  const onInput = () => emit('layout');
  el.addEventListener('keydown', onKey);
  el.addEventListener('input', onInput);
  el.addEventListener('blur', finishTextEdit);
  doc.defaultView.addEventListener('blur', finishTextEdit);

  editing = {
    ref, el, node, before, original,
    cleanup: () => {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('input', onInput);
      el.removeEventListener('blur', finishTextEdit);
      doc.defaultView.removeEventListener('blur', finishTextEdit);
    },
  };
  emit('textedit');
  return true;
}

export function finishTextEdit() {
  if (!editing) return;
  const { ref, el, node, before, original, cleanup } = editing;
  editing = null;
  cleanup();
  el.removeAttribute('contenteditable'); // jangan sampai ikut tersimpan ke file
  el.ownerDocument.getSelection()?.removeAllRanges();
  node.iframe.style.pointerEvents = '';
  focusEditor();
  if (el.textContent !== original) {
    pushDoc(ref.artboardId, 'Edit teks', before, snapshot(ref.artboardId), [ref], [ref]);
    scheduleSave(ref.artboardId);
    emit('structure', ref.artboardId);
  }
  emit('textedit');
}

// Kembalikan fokus keyboard ke editor. Tanpa ini, fokus tertinggal di dalam iframe artboard
// dan shortcut (V, F, Ctrl+Z, ...) tidak berfungsi sampai kanvas diklik.
function focusEditor() {
  document.getElementById('viewport').focus({ preventScroll: true });
}

export function startRename(artboardId) {
  const node = state.nodes.get(artboardId);
  const a = getArtboard(artboardId);
  if (!node || !a) return;
  const nameEl = node.label.querySelector('.name');
  nameEl.setAttribute('contenteditable', 'plaintext-only');
  nameEl.focus();
  getSelection().selectAllChildren(nameEl);

  const done = (save) => {
    nameEl.removeEventListener('keydown', onKey);
    nameEl.removeEventListener('blur', onBlur);
    nameEl.removeAttribute('contenteditable');
    focusEditor();
    const name = nameEl.textContent.trim();
    if (save && name && name !== a.name) changeArtboard(artboardId, { name }, 'Ganti nama frame');
    else nameEl.textContent = a.name;
  };
  const onKey = (e) => {
    e.stopPropagation(); // jangan sampai Enter/Esc juga memicu shortcut kanvas
    if (e.key === 'Enter') { e.preventDefault(); done(true); }
    if (e.key === 'Escape') { e.preventDefault(); done(false); }
  };
  const onBlur = () => done(true);
  nameEl.addEventListener('keydown', onKey);
  nameEl.addEventListener('blur', onBlur);
}
