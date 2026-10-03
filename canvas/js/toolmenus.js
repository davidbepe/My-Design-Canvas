// Tombol tool dengan menu dropdown (Bentuk, Pen/Pencil), seperti tombol Shape di toolbar Figma.
// Tombol utama memakai pilihan terakhir; ▾ membuka menu untuk memilih yang lain.
import { state, on, setTool } from './state.js';

const ICONS = {
  rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="0.5"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="5.5" ry="5.5"/>',
  triangle: '<path d="M8 2.5l6 11H2z"/>',
  polygon: '<path d="M8 2l5.7 4.1-2.2 6.7h-7L2.3 6.1z"/>',
  star: '<path d="M8 2.2l1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z"/>',
  line: '<path d="M3 13L13 3"/>',
  arrow: '<path d="M3 13L13 3M7.5 3H13v5.5"/>',
  pen: '<path d="M8 2l4 6-4 6-4-6z"/><circle cx="8" cy="9" r="1.2"/><path d="M8 2v5.8"/>',
  pencil: '<path d="M2.5 12.5c2-.5 2.5-4.5 5-4.5s2 3 3.5 2.5 1.5-3 2.5-3.5"/>',
};

const GROUPS = {
  shape: [
    ['rect', 'Rectangle', 'R'], ['ellipse', 'Ellipse', 'O'], ['triangle', 'Segitiga', ''], ['polygon', 'Polygon', ''],
    ['star', 'Bintang', ''], ['line', 'Garis', 'L'], ['arrow', 'Panah', 'Shift+L'],
  ],
  vector: [['pen', 'Pen', 'P'], ['pencil', 'Pencil', 'Shift+P']],
};

let menu = null;

export const toolIcon = (tool) => `<svg viewBox="0 0 16 16">${ICONS[tool]}</svg>`;

export function initToolMenus() {
  for (const groupEl of document.querySelectorAll('.tool-group')) {
    const items = GROUPS[groupEl.dataset.group];
    const main = groupEl.querySelector('.tool');
    setMain(main, items, main.dataset.tool);
    main.addEventListener('click', () => setTool(main.dataset.tool));
    groupEl.querySelector('.tool-caret').addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu) return closeMenu();
      openMenu(groupEl, items, main);
    });
  }
  // Tool dipilih lewat shortcut: tombol utama grupnya ikut berganti.
  on('tool', () => {
    for (const groupEl of document.querySelectorAll('.tool-group')) {
      const items = GROUPS[groupEl.dataset.group];
      if (items.some(([t]) => t === state.tool)) setMain(groupEl.querySelector('.tool'), items, state.tool);
    }
  });
}

function setMain(button, items, tool) {
  const [, label, key] = items.find(([t]) => t === tool);
  button.dataset.tool = tool;
  button.innerHTML = toolIcon(tool);
  button.title = key ? `${label} (${key})` : label;
  button.classList.toggle('active', state.tool === tool);
}

function openMenu(groupEl, items, main) {
  menu = document.createElement('div');
  menu.className = 'tool-menu';
  for (const [tool, label, key] of items) {
    const item = document.createElement('button');
    item.className = 'tool-menu-item';
    item.classList.toggle('on', state.tool === tool);
    item.innerHTML = `${toolIcon(tool)}<span>${label}</span><kbd>${key}</kbd>`;
    item.addEventListener('click', () => {
      closeMenu();
      setMain(main, items, tool);
      setTool(tool);
    });
    menu.append(item);
  }
  document.body.append(menu);
  const r = groupEl.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.top = `${r.bottom + 6}px`;
  setTimeout(() => addEventListener('pointerdown', outside, true));
}

function outside(e) {
  if (!menu?.contains(e.target)) closeMenu();
}

function closeMenu() {
  menu?.remove();
  menu = null;
  removeEventListener('pointerdown', outside, true);
}
