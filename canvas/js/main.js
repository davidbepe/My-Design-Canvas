// Titik masuk editor: menghubungkan semua modul dan koneksi live ke server.
import {
  state, on, setSelectionList, setHover, setTool, resolve, getArtboard, isEditableTarget, docOf,
} from './state.js';
import { initCamera, fitAll, fitRect, zoomCenter, restoreView, updateCursor } from './camera.js';
import { initArtboards, renderArtboards, reloadArtboard } from './artboards.js';
import { initSelection, drawOverlay, describeSelection, rectOf } from './selection.js';
import { initLayers, renderLayers, highlightLayers } from './layers.js';
import { initProperties, renderProperties } from './properties.js';
import { scheduleSave, retryFailed, hasUnsaved } from './persist.js';
import { undo, redo, canUndo, canRedo } from './history.js';
import { duplicateSelection, deleteSelection, selectAll } from './actions.js';
import { initClipboard } from './clipboard.js';
import { initIcons, toggleIcons } from './icons.js';
import { loadTokens, refreshArtboardTokens, applyFontImports } from './tokens.js';
import { initComponents, createComponent, renderComponentsPanel } from './components.js';
import { loadFonts } from './fonts.js';
import { renderVersionsPanel } from './versions.js';
import { initPreview, openPreview, closePreview, isPreviewOpen } from './preview.js';
import { initCodeExport, openCode, closeCode, isCodeOpen } from './codeexport.js';
import { initGuides } from './guides.js';

const $ = (id) => document.getElementById(id);
const viewportEl = $('viewport');
const zoomBtn = $('zoom');
const statusEl = $('status');
const emptyEl = $('empty');
const helpEl = $('help');
const toastEl = $('toast');
const offlineEl = $('offline');

initCamera(viewportEl, $('world'));
initArtboards($('world'));
initSelection(viewportEl, $('overlay'));
initGuides($('overlay'));
initLayers($('layers'));
initProperties($('props'));
initClipboard(viewportEl);
initIcons($('icons'));
initComponents();
initPreview($('preview'));
initCodeExport($('code'));

// ---------- Toolbar ----------
on('tool', () => {
  for (const btn of document.querySelectorAll('[data-tool]')) btn.classList.toggle('active', btn.dataset.tool === state.tool);
  updateCursor();
  setHover(null);
  renderProperties(); // tool Frame menampilkan preset ukuran di panel kanan
});
for (const btn of document.querySelectorAll('[data-tool]')) btn.addEventListener('click', () => setTool(btn.dataset.tool));
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('fit').addEventListener('click', fitAll);
zoomBtn.addEventListener('click', () => zoomCenter(1));
$('help-btn').addEventListener('click', () => { helpEl.hidden = !helpEl.hidden; });
$('help-close').addEventListener('click', () => { helpEl.hidden = true; });
$('icons-btn').addEventListener('click', () => toggleIcons());
$('icons-close').addEventListener('click', () => toggleIcons(false));
$('preview-btn').addEventListener('click', openPreview);
$('code-btn').addEventListener('click', openCode);

function zoomToSelection() {
  const rect = rectOf(state.selection);
  if (rect) fitRect(rect);
}

// ---------- Tab panel kiri: Layers / Komponen / Versi ----------
const TAB_KEY = 'design-canvas:tab';
let activeTab = 'layers';
try { activeTab = localStorage.getItem(TAB_KEY) || 'layers'; } catch {}

function setTab(tab) {
  activeTab = tab;
  try { localStorage.setItem(TAB_KEY, tab); } catch {}
  for (const btn of document.querySelectorAll('[data-tab]')) btn.classList.toggle('on', btn.dataset.tab === tab);
  for (const pane of document.querySelectorAll('[data-pane]')) pane.hidden = pane.dataset.pane !== tab;
  renderSidePanel();
}
for (const btn of document.querySelectorAll('[data-tab]')) btn.addEventListener('click', () => setTab(btn.dataset.tab));

function renderSidePanel() {
  if (activeTab === 'components') renderComponentsPanel($('components'));
  if (activeTab === 'versions') renderVersionsPanel($('versions'));
}

// ---------- Shortcut keyboard ----------
addEventListener('keydown', (e) => {
  if (isEditableTarget(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (key === 'escape' && isPreviewOpen()) return closePreview();
  if (key === 'escape' && isCodeOpen()) return closeCode();
  if (isPreviewOpen() || isCodeOpen()) return; // shortcut kanvas nonaktif selama jendela modal terbuka
  if (mod && e.altKey && key === 'k') { e.preventDefault(); createComponent(); }
  else if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) { e.preventDefault(); redo(); }
  else if (mod && key === 'd') { e.preventDefault(); duplicateSelection(); }
  else if (mod && key === 'a') { e.preventDefault(); selectAll(); }
  else if (mod || e.altKey) return;
  else if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); }
  else if (key === 'v') setTool('select');
  else if (key === 'h') setTool('hand');
  else if (key === 'f') setTool('frame');
  else if (key === 'r') setTool('rect');
  else if (key === 't') setTool('text');
  else if (key === 'i' && e.shiftKey) toggleIcons();
  else if (e.shiftKey && e.code === 'Digit2') zoomToSelection();
  else if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) helpEl.hidden = !helpEl.hidden;
  else if (key === 'escape' && !helpEl.hidden) helpEl.hidden = true;
  else if (key === 'escape' && !$('icons').hidden) toggleIcons(false);
});

// ---------- Reaksi terhadap perubahan ----------
on('view', () => {
  zoomBtn.textContent = `${Math.round(state.view.zoom * 100)}%`;
  drawOverlay();
});

on('artboards', () => {
  emptyEl.hidden = state.artboards.length > 0;
  const valid = state.selected.filter((r) => getArtboard(r.artboardId));
  if (valid.length !== state.selected.length) return setSelectionList(valid);
  renderLayers();
  drawOverlay();
  if (state.selection && !state.selection.path.length) renderProperties();
});

// Isi artboard selesai dimuat (pertama kali, setelah Claude mengubahnya, atau setelah undo).
on('doc', (id) => {
  applyFontImports(docOf(id)); // undo mengganti isi dokumen, jadi pasang lagi link font sementara
  if (state.selected.some((r) => r.artboardId === id)) {
    const valid = state.selected.filter((r) => resolve(r)); // elemen terpilih yang masih ada
    if (valid.length !== state.selected.length) return setSelectionList(valid);
    renderProperties();
    sendSelection();
  }
  renderLayers();
  drawOverlay();
  if (activeTab === 'components') renderSidePanel();
});

on('layout', drawOverlay);
on('textedit', drawOverlay);

on('selection', () => {
  renderLayers({ reveal: true });
  renderProperties();
  drawOverlay();
  sendSelection();
  if (activeTab === 'components') renderSidePanel(); // tombol "Jadikan komponen" aktif/nonaktif
});

on('hover', () => {
  highlightLayers();
  drawOverlay();
});

on('edit', (id) => {
  scheduleSave(id);
  drawOverlay();
  if (!connected) updateOffline();
});

on('structure', (id) => {
  scheduleSave(id);
  if (!connected) updateOffline();
  renderLayers();
  drawOverlay();
  if (state.selection?.artboardId === id) renderProperties();
  if (activeTab === 'components') renderSidePanel();
});

on('toast', (message) => showToast(message));

// Token berubah: panel token (saat tidak ada yang dipilih) dan field yang memakai token ikut diperbarui.
on('tokens', () => renderProperties());

on('saved', (id) => {
  if (state.selection?.artboardId === id) sendSelection();
  updateOffline();
});
on('savefailed', updateOffline);

let toastTimer;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2500);
}

on('history', (info) => {
  $('undo').disabled = !canUndo();
  $('redo').disabled = !canRedo();
  if (info?.label) showToast(`${info.action}: ${info.label}`);
});

// ---------- Koneksi live ke server ----------
let ws = null;
let retry = 500;
let connected = false;

// Banner peringatan saat server mati, supaya editan tidak hilang diam-diam.
function updateOffline() {
  offlineEl.hidden = connected;
  offlineEl.querySelector('.offline-unsaved').hidden = !hasUnsaved();
}

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.addEventListener('open', async () => {
    connected = true;
    statusEl.classList.add('online');
    statusEl.title = 'Terhubung';
    retry = 500;
    updateOffline();
    await retryFailed(); // kirim ulang editan yang gagal tersimpan saat server mati
    load(); // sinkronkan ulang setelah (re)connect
    sendSelection();
    updateOffline();
  });
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'manifest') {
      const wasEmpty = state.artboards.length === 0;
      state.artboards = msg.artboards;
      renderArtboards();
      if (wasEmpty && state.artboards.length) fitAll();
    } else if (msg.type === 'reload') {
      reloadArtboard(msg.id, msg.version);
    } else if (msg.type === 'tokens') {
      // tokens.css diubah (oleh editor, Claude, atau manual)
      loadTokens();
      refreshArtboardTokens();
    }
  });
  ws.addEventListener('close', () => {
    connected = false;
    statusEl.classList.remove('online');
    statusEl.title = 'Terputus, mencoba menyambung lagi…';
    updateOffline();
    setTimeout(connect, retry);
    retry = Math.min(retry * 2, 5000);
  });
}

// Kirim elemen terpilih ke server, supaya Claude bisa membacanya lewat get_selection.
function sendSelection() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'selection', selection: describeSelection() }));
  }
}

async function load() {
  try {
    const res = await fetch('/api/artboards');
    state.artboards = (await res.json()).artboards;
    renderArtboards();
  } catch {
    // server mati: banner offline sudah memberi tahu
  }
}

// ---------- Mulai ----------
setTab(activeTab);
loadTokens().catch(() => {});
loadFonts().catch(() => {});
load().then(() => {
  if (!restoreView()) fitAll();
  connect();
});
