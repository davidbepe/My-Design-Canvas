// Google Fonts: daftar font populer, menu pemilih font, dan memastikan artboard memuat font yang dipakai.
// Daftar font (dan ketebalan yang tersedia) diambil dari server, jadi hanya ada di satu tempat.
let fonts = []; // [nama, kategori, ketebalan]
let previewLoaded = false;
let menu = null;

export async function loadFonts() {
  const res = await fetch('/api/fonts');
  fonts = (await res.json()).fonts;
}

export function primaryFamily(fontFamily) {
  return fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
}

const findFont = (name) => fonts.find((f) => f[0].toLowerCase() === name.toLowerCase());

export function fontFamilyValue(name) {
  const f = findFont(name);
  return f ? `"${f[0]}", ${f[1]}` : name;
}

function googleFontsUrl(names) {
  const families = [...new Set(names)]
    .map(findFont)
    .filter(Boolean)
    .map(([name, , weights]) => `family=${name.replace(/ /g, '+')}:wght@${weights}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null;
}

// Tambahkan font ke <link data-google-fonts> di <head> artboard (satu link untuk semua font artboard itu).
export function ensureFontInDoc(doc, name) {
  if (!findFont(name)) return;
  let link = doc.head.querySelector('link[data-google-fonts]');
  const current = link ? [...link.href.matchAll(/family=([^:&]+)/g)].map((m) => decodeURIComponent(m[1].replace(/\+/g, ' '))) : [];
  if (current.some((n) => n.toLowerCase() === name.toLowerCase())) return;
  if (!link) {
    link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-google-fonts', '');
    doc.head.append(link);
  }
  link.href = googleFontsUrl([...current, name]);
}

// Menu pemilih font: setiap nama ditampilkan dalam font-nya sendiri.
export function openFontMenu(anchor, current, onPick) {
  closeFontMenu();
  if (!previewLoaded) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googleFontsUrl(fonts.map((f) => f[0]));
    document.head.append(link);
    previewLoaded = true;
  }
  menu = document.createElement('div');
  menu.className = 'token-menu font-menu';
  const search = document.createElement('input');
  search.className = 'icon-search';
  search.placeholder = 'Cari font…';
  const list = document.createElement('div');
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren(...fonts.filter(([n]) => n.toLowerCase().includes(q)).map(([name, category]) => {
      const item = document.createElement('button');
      item.className = 'token-menu-item';
      item.classList.toggle('active', name.toLowerCase() === current.toLowerCase());
      const label = document.createElement('span');
      label.className = 'font-sample';
      label.textContent = name;
      label.style.fontFamily = `"${name}", ${category}`;
      const cat = document.createElement('span');
      cat.className = 'token-menu-value';
      cat.textContent = category;
      item.append(label, cat);
      item.addEventListener('click', () => { closeFontMenu(); onPick(name); });
      return item;
    }));
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFontMenu(); });
  render();
  menu.append(search, list);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  search.focus();
  setTimeout(() => addEventListener('pointerdown', outside, true));
}

function outside(e) {
  if (!menu?.contains(e.target)) closeFontMenu();
}

export function closeFontMenu() {
  menu?.remove();
  menu = null;
  removeEventListener('pointerdown', outside, true);
}
