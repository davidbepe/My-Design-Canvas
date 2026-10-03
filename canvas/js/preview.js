// Preview responsif: satu artboard ditampilkan berdampingan di beberapa lebar layar.
// Ikut diperbarui setiap kali artboard itu disimpan.
// Prototype sederhana: elemen ber-atribut data-link (diatur di bagian Interaksi panel kanan)
// bisa diklik untuk pindah ke artboard lain; "back" = kembali ke artboard sebelumnya.
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
let trail = []; // artboard yang sudah dilewati, untuk tombol Kembali
let backBtn;

export function initPreview(el) {
  overlay = el;
  body = el.querySelector('.preview-body');
  toggles = el.querySelector('.preview-toggles');
  el.querySelector('.preview-close').addEventListener('click', closePreview);
  backBtn = document.createElement('button');
  backBtn.className = 'small-btn';
  backBtn.textContent = '← Kembali';
  backBtn.hidden = true;
  backBtn.addEventListener('click', () => follow('back'));
  el.querySelector('.preview-title').before(backBtn);
  addEventListener('resize', () => { if (artboardId) layout(); });
  on('saved', (id) => { if (id === artboardId) scheduleReload(); });
  on('doc', (id) => { if (id === artboardId) scheduleReload(); });
  on('tokens', () => { if (artboardId) scheduleReload(); });
}

export const isPreviewOpen = () => !!artboardId;

export function openPreview() {
  const ref = state.selection;
  if (!ref) return toast('Pilih frame (atau elemen di dalamnya) untuk dipreview');
  artboardId = ref.artboardId;
  trail = [];
  overlay.hidden = false;
  renderToggles();
  build();
}

// Pindah artboard karena elemen ber-data-link diklik.
function follow(target) {
  if (target === 'back') {
    if (!trail.length) return;
    artboardId = trail.pop();
  } else {
    if (!getArtboard(target)) return toast('Frame tujuan sudah tidak ada');
    trail.push(artboardId);
    artboardId = target;
  }
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
  overlay.querySelector('.preview-title').textContent = a.name;
  backBtn.hidden = !trail.length;
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
      const doc = iframe.contentDocument;
      if (doc) {
        const style = doc.createElement('style');
        style.textContent = '[data-link] { cursor: pointer; }';
        doc.head.append(style);
        doc.addEventListener('click', (e) => {
          const link = e.target.closest?.('[data-link]');
          if (!link) return;
          e.preventDefault();
          follow(link.getAttribute('data-link'));
        });
      }
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
