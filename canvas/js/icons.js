// Popup pemilih ikon (pustaka Lucide). Klik ikon untuk menyisipkannya ke frame/elemen terpilih.
import { insertIcon } from './clipboard.js';

let popup;
let input;
let grid;
let timer;
let lastQuery = null;

export function initIcons(popupEl) {
  popup = popupEl;
  input = popup.querySelector('input');
  grid = popup.querySelector('.icon-grid');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(search, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); toggleIcons(false); }
  });
}

export function toggleIcons(show = popup.hidden) {
  popup.hidden = !show;
  if (show) {
    input.focus();
    input.select();
    if (lastQuery === null) search();
  }
}

async function search() {
  const q = input.value.trim();
  if (q === lastQuery) return;
  lastQuery = q;
  const res = await fetch(`/api/icons?q=${encodeURIComponent(q)}&limit=120`);
  const { icons } = await res.json();
  if (q !== lastQuery) return; // sudah ada pencarian yang lebih baru
  grid.replaceChildren(...icons.map(({ name, svg }) => {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.title = name;
    btn.innerHTML = svg; // SVG dari paket lucide-static di server sendiri
    btn.addEventListener('click', () => insertIcon(name, svg));
    return btn;
  }));
  if (!icons.length) grid.textContent = 'Tidak ada ikon yang cocok. Coba kata kunci bahasa Inggris.';
}
