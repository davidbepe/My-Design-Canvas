// Preview responsif: satu artboard ditampilkan berdampingan di beberapa lebar layar.
// Ikut diperbarui setiap kali artboard itu disimpan.
import { state, on, getArtboard, toast } from './state.js';

const BREAKPOINTS = [
  ['Mobile', 375],
  ['Tablet', 768],
  ['Laptop', 1280],
  ['Desktop', 1440],
];
const enabled = new Set([375, 768, 1440]);

let overlay;
let body;
let toggles;
let artboardId = null;
let reloadTimer;

export function initPreview(el) {
  overlay = el;
  body = el.querySelector('.preview-body');
  toggles = el.querySelector('.preview-toggles');
  el.querySelector('.preview-close').addEventListener('click', closePreview);
  addEventListener('resize', () => { if (artboardId) layout(); });
  on('saved', (id) => { if (id === artboardId) scheduleReload(); });
  on('doc', (id) => { if (id === artboardId) scheduleReload(); });
  on('tokens', () => { if (artboardId) scheduleReload(); });
}

export const isPreviewOpen = () => !!artboardId;

export function openPreview() {
  const ref = state.selection;
  if (!ref) return toast('Pilih artboard (atau elemen di dalamnya) untuk dipreview');
  artboardId = ref.artboardId;
  overlay.hidden = false;
  overlay.querySelector('.preview-title').textContent = getArtboard(artboardId)?.name ?? '';
  renderToggles();
  build();
}

export function closePreview() {
  artboardId = null;
  overlay.hidden = true;
  body.replaceChildren();
}

function renderToggles() {
  toggles.replaceChildren(...BREAKPOINTS.map(([name, width]) => {
    const btn = document.createElement('button');
    btn.className = 'small-btn';
    btn.classList.toggle('on', enabled.has(width));
    btn.textContent = `${name} ${width}`;
    btn.addEventListener('click', () => {
      if (enabled.has(width) && enabled.size > 1) enabled.delete(width);
      else enabled.add(width);
      renderToggles();
      build();
    });
    return btn;
  }));
}

function build() {
  const a = getArtboard(artboardId);
  if (!a) return closePreview();
  body.replaceChildren(...BREAKPOINTS.filter(([, w]) => enabled.has(w)).map(([name, width]) => {
    const frame = document.createElement('div');
    frame.className = 'preview-frame';
    frame.dataset.width = width;
    const label = document.createElement('div');
    label.className = 'preview-label';
    label.textContent = `${name} · ${width}px`;
    const clip = document.createElement('div');
    clip.className = 'preview-clip';
    const iframe = document.createElement('iframe');
    iframe.style.width = `${width}px`;
    iframe.style.height = `${a.height}px`;
    iframe.src = `/designs/${encodeURIComponent(a.file)}?v=${Date.now()}`;
    // Tinggi mengikuti isi halaman di lebar itu (desain responsif bisa jadi lebih tinggi).
    iframe.addEventListener('load', () => {
      const h = iframe.contentDocument?.documentElement.scrollHeight;
      if (h) iframe.style.height = `${Math.max(h, 200)}px`;
      layout();
    });
    clip.append(iframe);
    frame.append(label, clip);
    return frame;
  }));
  layout();
}

// Skala semua frame dengan angka yang sama supaya muat di layar dan bisa dibandingkan.
function layout() {
  const frames = [...body.querySelectorAll('.preview-frame')];
  if (!frames.length) return;
  const gap = 32;
  const availW = body.clientWidth - gap * (frames.length + 1);
  const availH = body.clientHeight - 60;
  const totalW = frames.reduce((s, f) => s + Number(f.dataset.width), 0);
  const maxH = Math.max(...frames.map((f) => parseFloat(f.querySelector('iframe').style.height)));
  const scale = Math.min(1, availW / totalW, availH / maxH);
  for (const f of frames) {
    const iframe = f.querySelector('iframe');
    const clip = f.querySelector('.preview-clip');
    iframe.style.transform = `scale(${scale})`;
    clip.style.width = `${Number(f.dataset.width) * scale}px`;
    clip.style.height = `${parseFloat(iframe.style.height) * scale}px`;
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(build, 300);
}
