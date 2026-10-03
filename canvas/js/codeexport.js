// Ekspor ke kode: HTML rapi, komponen React (JSX), dan CSS (tokens + style artboard).
import { state, resolve, getArtboard, docOf, toast, HIDDEN_TAGS } from './state.js';

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const INDENT = '  ';

let overlay;
let codeEl;
let current = { html: '', react: '', css: '' };
let tab = 'html';

export function initCodeExport(el) {
  overlay = el;
  codeEl = el.querySelector('code');
  el.querySelector('.code-close').addEventListener('click', closeCode);
  el.querySelector('.code-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(current[tab]);
      toast('Kode disalin');
    } catch {
      toast('Gagal menyalin. Blok teksnya lalu tekan Ctrl+C.');
    }
  });
  for (const btn of el.querySelectorAll('[data-code-tab]')) {
    btn.addEventListener('click', () => { tab = btn.dataset.codeTab; show(); });
  }
}

export const isCodeOpen = () => overlay && !overlay.hidden;

export async function openCode() {
  const ref = state.selection;
  const el = resolve(ref);
  const a = ref && getArtboard(ref.artboardId);
  if (!el || !a) return toast('Pilih frame atau elemen untuk melihat kodenya');
  const doc = docOf(a.id);
  const tokensCss = await fetch(`/designs/tokens.css?v=${Date.now()}`).then((r) => r.text()).catch(() => '');
  const pageCss = [...doc.querySelectorAll('style')].map((s) => dedent(s.textContent)).join('\n\n');
  const isRoot = !ref.path.length;
  const componentName = pascal(isRoot ? a.name : layerName(el));

  current.css = [tokensCss.trim(), pageCss.trim()].filter(Boolean).join('\n\n/* Style frame utama */\n') + '\n';
  if (isRoot) {
    current.html = standaloneHtml(doc, tokensCss);
    const kids = significantChildren(doc.body, 'jsx');
    current.react = reactComponent(componentName, kids.length === 1 ? kids : null, kids);
  } else {
    current.html = format(el, 0, 'html').join('\n') + '\n';
    current.react = reactComponent(componentName, [el], [el]);
  }
  overlay.querySelector('.code-title').textContent = isRoot ? a.name : `${a.name} › ${layerName(el)}`;
  overlay.hidden = false;
  show();
}

export function closeCode() {
  overlay.hidden = true;
}

function show() {
  codeEl.textContent = current[tab];
  for (const btn of overlay.querySelectorAll('[data-code-tab]')) btn.classList.toggle('on', btn.dataset.codeTab === tab);
}

// Dokumen HTML lengkap yang bisa dibuka sendiri: link tokens.css diganti isi tokennya langsung.
function standaloneHtml(doc, tokensCss) {
  const clone = doc.documentElement.cloneNode(true);
  for (const el of clone.querySelectorAll('[data-editor-temp]')) el.remove();
  for (const link of clone.querySelectorAll('link[href^="tokens.css"]')) {
    const style = doc.createElement('style');
    style.textContent = `\n${tokensCss.trim()}\n`;
    link.replaceWith(style);
  }
  return `<!doctype html>\n${format(clone, 0, 'html').join('\n')}\n`;
}

function reactComponent(name, single, kids) {
  const body = single
    ? format(single[0], 2, 'jsx')
    : [`${INDENT.repeat(2)}<>`, ...kids.flatMap((k) => format(k, 3, 'jsx')), `${INDENT.repeat(2)}</>`];
  return [
    '// CSS (tokens + style artboard) ada di tab CSS: simpan sebagai file .css lalu import.',
    `export default function ${name}() {`,
    `${INDENT}return (`,
    ...body,
    `${INDENT});`,
    '}',
    '',
  ].join('\n');
}

// ---------- Formatter: satu penelusur DOM, dua gaya atribut (HTML / JSX) ----------

function format(node, depth, mode) {
  const pad = INDENT.repeat(depth);
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    return text ? [pad + escapeText(text, mode)] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const tag = tagName(node);
  const attrs = attributes(node, mode);
  const open = `<${tag}${attrs}`;

  if (tag === 'style' || tag === 'script') {
    if (mode === 'jsx') return [];
    const content = dedent(node.textContent).trim();
    if (!content) return [`${pad}${open}></${tag}>`];
    return [`${pad}${open}>`, ...content.split('\n').map((l) => (l ? pad + INDENT + l : '')), `${pad}</${tag}>`];
  }

  const kids = significantChildren(node, mode);
  if (!kids.length) {
    if (mode === 'jsx') return [`${pad}${open} />`];
    return [VOID.has(tag) ? `${pad}${open}>` : `${pad}${open}></${tag}>`];
  }
  // Isi hanya teks pendek → satu baris.
  if (kids.every((k) => k.nodeType === Node.TEXT_NODE)) {
    const text = escapeText(kids.map((k) => k.textContent).join('').replace(/\s+/g, ' ').trim(), mode);
    const line = `${pad}${open}>${text}</${tag}>`;
    if (line.length <= 100) return [line];
  }
  return [`${pad}${open}>`, ...kids.flatMap((k) => format(k, depth + 1, mode)), `${pad}</${tag}>`];
}

function significantChildren(node, mode) {
  return [...node.childNodes].filter((n) => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim() !== '';
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    if (mode === 'jsx' && HIDDEN_TAGS.has(n.tagName)) return false; // <style>, <script>, dll. tidak masuk JSX
    return true;
  });
}

// Tag SVG peka huruf besar-kecil (mis. linearGradient), tag HTML ditulis huruf kecil.
function tagName(el) {
  return el.namespaceURI === 'http://www.w3.org/2000/svg' ? el.tagName : el.tagName.toLowerCase();
}

const JSX_NAMES = {
  class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
  minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autoComplete',
  autofocus: 'autoFocus', contenteditable: 'contentEditable', crossorigin: 'crossOrigin', srcset: 'srcSet',
  'xlink:href': 'xlinkHref', 'xmlns:xlink': 'xmlnsXlink', 'xml:space': 'xmlSpace',
};
const BOOLEAN = new Set(['disabled', 'checked', 'readonly', 'required', 'hidden', 'autofocus', 'multiple', 'selected', 'open']);

function attributes(el, mode) {
  let out = '';
  for (const { name, value } of el.attributes) {
    if (mode === 'html') {
      out += value === '' && BOOLEAN.has(name) ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
      continue;
    }
    if (name.startsWith('on')) continue; // event handler berupa teks tidak berlaku di React
    if (name === 'style') { out += ` style={${styleObject(value)}}`; continue; }
    const jsxName = JSX_NAMES[name]
      ?? (name.startsWith('data-') || name.startsWith('aria-') ? name : name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
    out += value === '' && BOOLEAN.has(name) ? ` ${jsxName}` : ` ${jsxName}="${escapeAttr(value)}"`;
  }
  return out;
}

// "border-radius: 24px; --x: 1" → { borderRadius: '24px', '--x': '1' }
function styleObject(css) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= css.length; i++) {
    const c = css[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ';' && depth === 0) || i === css.length) {
      parts.push(css.slice(start, i));
      start = i + 1;
    }
  }
  const entries = parts.map((p) => {
    const idx = p.indexOf(':');
    if (idx < 0) return null;
    const prop = p.slice(0, idx).trim();
    const value = p.slice(idx + 1).trim();
    if (!prop || !value) return null;
    const key = prop.startsWith('--')
      ? `'${prop}'`
      : prop.replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return `${key}: '${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }).filter(Boolean);
  return `{ ${entries.join(', ')} }`;
}

function escapeText(text, mode) {
  const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return mode === 'jsx' ? html.replace(/[{}]/g, (c) => `{'${c}'}`) : html;
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function dedent(text) {
  const lines = text.replace(/^\n+|\s+$/g, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

function layerName(el) {
  return el.getAttribute('data-component-name') || el.getAttribute('aria-label') || el.id || el.classList[0] || el.tagName.toLowerCase();
}

function pascal(text) {
  const name = text.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, ' ').trim()
    .split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return /^[A-Z]/.test(name) ? name : `Komponen${name}`;
}
