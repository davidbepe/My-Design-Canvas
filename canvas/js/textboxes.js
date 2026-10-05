// "Kotak berisi teks" -> frame + layer teks, seperti tombol di Figma (frame auto layout berisi teks).
//
// Di HTML, tombol sering ditulis <button>Masuk</button>: teksnya menempel langsung di kotaknya,
// sehingga editor menganggapnya teks dan panel Layout / Fill / Hug tidak muncul. Di sini teks
// langsung milik kotak seperti itu dibungkus <span>. Tampilannya tidak berubah (span ikut mewarisi
// font & warna), tapi strukturnya jadi Kotak › Teks, jadi kotaknya bisa diatur sebagai frame dan
// teksnya sebagai teks.
import { COMPONENT_ROLE } from './state.js';

// Tag yang bisa berupa kotak. Paragraf & judul (p, h1, ...) tetap dianggap teks.
const BOX_TAGS = new Set([
  'BUTTON', 'A', 'LABEL', 'DIV', 'SPAN', 'SECTION', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'MAIN', 'ARTICLE',
  'FIGURE', 'LI', 'TD', 'TH', 'SUMMARY', 'FORM',
]);

function isBox(el) {
  if (el.tagName === 'BUTTON') return true;
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  if (/flex|grid/.test(cs.display)) return true;
  if (cs.backgroundImage !== 'none') return true;
  if (!/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.backgroundColor)) return true;
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  if (sides.some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none')) return true;
  return sides.some((s) => parseFloat(cs[`padding${s}`]) > 0);
}

// Bungkus teks langsung milik kotak-kotak di dokumen. Mengembalikan true kalau ada yang berubah.
export function normalizeTextBoxes(doc) {
  if (!doc?.body) return false;
  let changed = false;
  for (const el of doc.body.querySelectorAll('*')) {
    if (!BOX_TAGS.has(el.tagName) || el.isContentEditable) continue;
    if (el.closest(`[${COMPONENT_ROLE}="instance"], svg`)) continue; // isi instance diatur master-nya
    const texts = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (!texts.length || !isBox(el)) continue;
    for (const t of texts) {
      const span = doc.createElement('span');
      el.replaceChild(span, t);
      span.append(t); // dipindah apa adanya: spasi di sekitarnya tetap tampil sama
    }
    changed = true;
  }
  for (const input of doc.body.querySelectorAll('input, textarea')) {
    if (wrapField(input)) changed = true;
  }
  return changed;
}

// ---------- Kolom isian -> frame auto layout berisi input ----------
// <input> tidak bisa berisi elemen lain, jadi kotaknya (border, radius, fill, padding, shadow) dipindah
// ke <div data-field> auto layout, dan input-nya jadi lapisan teks transparan yang mengisi frame itu.
// Tampilannya sama, input tetap bisa diketik, dan frame-nya bisa diberi ikon (mis. ikon mata).

const TEXT_INPUTS = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'time']);
const BOX_PROPS = [
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'background-image', 'box-shadow', 'opacity',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'flex-grow', 'flex-shrink', 'flex-basis', 'align-self',
];

function wrapField(input) {
  if (input.parentElement?.hasAttribute('data-field')) return false; // sudah dibungkus
  if (input.closest(`[${COMPONENT_ROLE}="instance"]`) || input.isContentEditable) return false;
  if (input.tagName === 'INPUT' && !TEXT_INPUTS.has((input.getAttribute('type') || 'text').toLowerCase())) return false;
  const doc = input.ownerDocument;
  const cs = doc.defaultView.getComputedStyle(input);
  if (cs.display === 'none' || !isBox(input)) return false;
  const r = input.getBoundingClientRect();
  const frame = doc.createElement('div');
  frame.setAttribute('data-field', '');
  frame.setAttribute('data-name', 'Field');
  const styles = BOX_PROPS.map((p) => `${p}: ${cs.getPropertyValue(p)}`);
  styles.push('display: flex', 'align-items: center', 'gap: 8px', 'box-sizing: border-box', `height: ${Math.round(r.height)}px`);
  // Lebar: ikut lebar input kalau ditulis langsung, atau kalau input-nya tidak melebar mengikuti induk.
  const parentCs = doc.defaultView.getComputedStyle(input.parentElement);
  const stretched = /flex|grid/.test(parentCs.display) || cs.display === 'block';
  if (input.style.width) styles.push(`width: ${input.style.width}`);
  else if (!stretched) styles.push(`width: ${Math.round(r.width)}px`);
  if (cs.position === 'absolute' || cs.position === 'fixed') {
    styles.push(`position: ${cs.position}`, `left: ${cs.left}`, `top: ${cs.top}`);
    for (const p of ['position', 'left', 'top', 'right', 'bottom']) input.style.removeProperty(p);
  }
  frame.style.cssText = styles.join('; ');
  // Input: hanya tulisannya. Kotaknya sudah dipegang frame.
  const plain = {
    border: '0', padding: '0', margin: '0', background: 'transparent', 'box-shadow': 'none', 'border-radius': '0',
    outline: 'none', flex: '1 1 0', 'min-width': '0', width: 'auto', height: 'auto', 'align-self': 'stretch', opacity: '1',
  };
  for (const [p, v] of Object.entries(plain)) input.style.setProperty(p, v);
  input.parentElement.insertBefore(frame, input);
  frame.append(input);
  return true;
}
