// Panel Properti: baca style elemen terpilih, lalu ubah lewat inline style saat diedit.
// Kalau beberapa elemen terpilih, nilai yang ditampilkan dari elemen utama (terakhir dipilih),
// tapi editan berlaku ke SEMUA elemen yang terpilih.
import { state, emit, resolve, getArtboard, setSelection, setTool, toast } from './state.js';
import { captureDoc, group } from './history.js';
import { changeArtboard, createArtboardWithHistory } from './actions.js';
import { fitRect } from './camera.js';
import { selectorOf } from './selection.js';
import { saveNow } from './persist.js';
import { renderTokensPanel, openTokenMenu } from './tokens.js';
import { componentOf, countInstances, goToMaster, detachInstance, renameComponent } from './components.js';
import { openFontMenu, primaryFamily, fontFamilyValue, ensureFontInDoc } from './fonts.js';
import { openCode } from './codeexport.js';
import { openPreview } from './preview.js';

const FRAME_PRESETS = [
  ['iPhone 16', 393, 852],
  ['iPhone SE', 375, 667],
  ['Android', 360, 800],
  ['iPad', 820, 1180],
  ['Laptop', 1280, 832],
  ['Desktop', 1440, 900],
];

const DISPLAYS = ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'];
const JUSTIFY = [['normal', 'Normal'], ['flex-start', 'Start'], ['center', 'Center'], ['flex-end', 'End'],
  ['space-between', 'Space between'], ['space-around', 'Space around'], ['space-evenly', 'Space evenly']];
const ALIGN = [['normal', 'Normal'], ['stretch', 'Stretch'], ['flex-start', 'Start'], ['center', 'Center'],
  ['flex-end', 'End'], ['baseline', 'Baseline']];
const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];
const WEIGHTS = [['100', '100 Thin'], ['200', '200 Extra light'], ['300', '300 Light'], ['400', '400 Regular'],
  ['500', '500 Medium'], ['600', '600 Semibold'], ['700', '700 Bold'], ['800', '800 Extra bold'], ['900', '900 Black']];
const TEXT_ALIGN = [['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan'], ['justify', 'Rata']];

let panel;
let exportScale = '2';

export function initProperties(el) {
  panel = el;
}

export function renderProperties() {
  panel.replaceChildren();
  const ref = state.selection;
  if (state.tool === 'frame') return renderFramePresets();
  if (!ref) return renderTokensPanel(panel);
  const artboard = getArtboard(ref.artboardId);
  const el = resolve(ref);
  if (!artboard || !el) {
    panel.append(div('props-empty', 'Memuat…'));
    return;
  }

  const isRoot = ref.path.length === 0;
  const tag = el.tagName.toLowerCase();
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);

  // Editan berlaku ke semua yang terpilih dan sejenis (semua elemen, atau semua artboard).
  // Isi instance komponen diatur oleh master-nya, jadi tidak ikut diedit di sini.
  const targets = state.selected
    .filter((r) => !r.path.length === isRoot)
    .map((r) => ({ ref: r, el: resolve(r) }))
    .filter((t) => t.el && componentOf(t.el)?.role !== 'instance');
  const artboardIds = [...new Set(targets.map((t) => t.ref.artboardId))];
  const set = (prop, value, { rerender = false, before } = {}) => {
    artboardIds.forEach((id) => captureDoc(id)); // catat untuk undo
    for (const t of targets) {
      before?.(t.el);
      if (value === '' || value == null) t.el.style.removeProperty(prop);
      else t.el.style.setProperty(prop, value);
    }
    artboardIds.forEach((id) => emit('edit', id));
    if (rerender) renderProperties();
  };
  // Field yang bisa memakai token: tampilkan nama token kalau nilainya var(--...).
  const tok = (prop, groupName) => ({
    linked: linkedToken(el, prop),
    tokenGroup: groupName,
    onToken: (v) => set(prop, v, { rerender: true }),
  });

  // Judul: tag + nama
  const header = div('props-header');
  header.append(span('tag-pill', targets.length > 1 ? `${targets.length} dipilih` : isRoot ? 'artboard' : tag));
  const name = isRoot ? artboard.name : el.id ? `#${el.id}` : el.classList.length ? `.${[...el.classList].join('.')}` : '';
  if (name) header.append(span('props-name', name));
  panel.append(header);

  // Komponen
  const comp = componentOf(el);
  if (comp?.role === 'instance') return renderInstance(comp, ref);
  if (comp?.role === 'master' && comp.root === el) {
    const s = section('Komponen · master');
    row(s, textField({ label: 'Nama', value: comp.name, onCommit: (v) => renameComponent(ref, v) }));
    const n = countInstances(comp.id);
    s.append(div('props-hint', n
      ? `Perubahan di master otomatis diterapkan ke ${n} salinan.`
      : 'Belum ada salinan. Sisipkan dari tab Komponen di panel kiri.'));
  }

  // Ukuran
  if (isRoot) {
    const s = section('Artboard');
    if (targets.length === 1) {
      row(s, textField({ label: 'Nama', value: artboard.name, onCommit: (v) => v.trim() && changeArtboard(artboard.id, { name: v.trim() }, 'Ganti nama artboard') }));
    }
    const sizeCommit = (key) => (_css, n) => {
      if (!Number.isInteger(n) || n < 1) return;
      group('Ubah ukuran artboard', () => {
        for (const t of targets) changeArtboard(t.ref.artboardId, { [key]: n }, 'Ubah ukuran artboard');
      });
    };
    row(s,
      numberField({ label: 'W', value: artboard.width, onCommit: sizeCommit('width') }),
      numberField({ label: 'H', value: artboard.height, onCommit: sizeCommit('height') }));
  } else {
    const s = section('Ukuran');
    row(s,
      numberField({ label: 'W', value: px(cs.width), unit: 'px', onCommit: (v) => set('width', v) }),
      numberField({ label: 'H', value: px(cs.height), unit: 'px', onCommit: (v) => set('height', v) }));
  }

  // Ikon (SVG): ukuran, warna, ketebalan garis
  if (tag === 'svg') {
    const s = section('Ikon');
    row(s,
      numberField({ label: 'Size', value: px(cs.width), unit: 'px', onCommit: (v) => {
        set('width', v);
        set('height', v);
      } }),
      numberField({ label: 'Stroke', value: px(cs.strokeWidth), step: 0.25, onCommit: (_css, n) => {
        if (Number.isFinite(n)) set('stroke-width', String(n));
      } }));
    row(s, colorField({ value: cs.color, onCommit: (v) => set('color', v), ...tok('color', 'color') }));
  }

  // Layout (auto-layout = flexbox)
  const layout = section('Layout');
  row(layout, selectField({ label: 'Display', value: cs.display, options: DISPLAYS, onChange: (v) => set('display', v, { rerender: true }) }));
  const isFlex = cs.display.includes('flex');
  const isGrid = cs.display.includes('grid');
  if (isFlex) {
    row(layout, segmented({
      value: cs.flexDirection.startsWith('column') ? 'column' : 'row',
      options: [['row', '→ Horizontal'], ['column', '↓ Vertikal']],
      onChange: (v) => set('flex-direction', v, { rerender: true }),
    }));
    row(layout,
      selectField({ label: 'Justify', value: cs.justifyContent, options: JUSTIFY, onChange: (v) => set('justify-content', v) }),
      selectField({ label: 'Align', value: cs.alignItems, options: ALIGN, onChange: (v) => set('align-items', v) }));
  }
  if (isFlex || isGrid) {
    row(layout, numberField({
      label: 'Gap', value: px(cs.rowGap === 'normal' ? '0px' : cs.rowGap), unit: 'px',
      onCommit: (v) => set('gap', v), ...tok('gap', 'space'),
    }));
  }

  // Spacing
  const spacing = section('Padding & margin');
  for (const kind of ['padding', 'margin']) {
    row(spacing, ...['top', 'right', 'bottom', 'left'].map((side, i) => {
      const prop = `${kind}-${side}`;
      return numberField({
        label: kind[0].toUpperCase() + '↑→↓←'[i], value: px(cs.getPropertyValue(prop)), unit: 'px',
        onCommit: (v) => set(prop, v), ...tok(prop, 'space'),
      });
    }));
  }

  // Fill
  const fill = section('Fill');
  row(fill, colorField({ value: cs.backgroundColor, onCommit: (v) => set('background-color', v), ...tok('background-color', 'color') }));
  row(fill, numberField({ label: 'Opacity', value: round(Number(cs.opacity) * 100), step: 5, onCommit: (_css, n) => {
    if (Number.isFinite(n)) set('opacity', String(Math.min(100, Math.max(0, n)) / 100));
  } }));

  // Border
  const border = section('Border');
  row(border,
    numberField({ label: 'W', value: px(cs.borderTopWidth), unit: 'px', onCommit: (v, n) => {
      // Ketebalan tanpa gaya garis tidak terlihat, jadi otomatis jadikan solid.
      set('border-width', v, {
        rerender: true,
        before: (t) => {
          const style = t.ownerDocument.defaultView.getComputedStyle(t).borderTopStyle;
          if (n > 0 && style === 'none') t.style.setProperty('border-style', 'solid');
        },
      });
    } }),
    selectField({ value: cs.borderTopStyle, options: BORDER_STYLES, onChange: (v) => set('border-style', v, { rerender: true }) }));
  if (cs.borderTopStyle !== 'none') {
    row(border, colorField({ value: cs.borderTopColor, onCommit: (v) => set('border-color', v), ...tok('border-color', 'color') }));
  }
  row(border, numberField({
    label: 'Radius', value: px(cs.borderTopLeftRadius), unit: 'px',
    onCommit: (v) => set('border-radius', v), ...tok('border-radius', 'radius'),
  }));

  // Teks: tampil kalau elemen punya teks sendiri, atau artboard (untuk font dasar).
  if (tag !== 'svg' && (isRoot || hasOwnText(el))) {
    const t = section('Teks');
    if (!isRoot && el.children.length === 0 && targets.length === 1) {
      row(t, textArea({ value: el.textContent, onCommit: (v) => {
        captureDoc(ref.artboardId, 'Edit teks');
        el.textContent = v;
        emit('structure', ref.artboardId);
      } }));
    }
    row(t, fontField({
      value: cs.fontFamily,
      onCommit: (v) => set('font-family', v),
      // Pilih Google Font: set font-family dan pastikan artboard memuat font itu.
      onPickFont: (font) => set('font-family', fontFamilyValue(font), {
        rerender: true,
        before: (t) => ensureFontInDoc(t.ownerDocument, font),
      }),
      ...tok('font-family', 'font'),
    }));
    row(t,
      numberField({ label: 'Size', value: px(cs.fontSize), unit: 'px', onCommit: (v) => set('font-size', v), ...tok('font-size', 'text') }),
      selectField({ value: String(cs.fontWeight), options: WEIGHTS, onChange: (v) => set('font-weight', v) }));
    row(t,
      numberField({ label: 'LH', value: px(cs.lineHeight), unit: 'px', onCommit: (v) => set('line-height', v) }),
      numberField({ label: 'LS', value: px(cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing), unit: 'px', step: 0.1, onCommit: (v) => set('letter-spacing', v) }));
    row(t, colorField({ value: cs.color, onCommit: (v) => set('color', v), ...tok('color', 'color') }));
    row(t, segmented({ value: cs.textAlign === 'start' ? 'left' : cs.textAlign, options: TEXT_ALIGN, onChange: (v) => set('text-align', v, { rerender: true }) }));
  }

  // Efek
  const fx = section('Efek');
  row(fx, textField({ label: 'Shadow', value: cs.boxShadow, onCommit: (v) => set('box-shadow', v), ...tok('box-shadow', 'shadow') }));

  renderExport();
}

// ---------- Ekspor PNG ----------

function renderExport() {
  const s = section('Ekspor');
  const btn = document.createElement('button');
  btn.className = 'primary-btn';
  const count = state.selected.length;
  btn.textContent = count > 1 ? `Ekspor ${count} PNG` : 'Ekspor PNG';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Mengekspor…';
    try {
      for (const ref of state.selected) await exportPng(ref, exportScale);
    } catch (err) {
      toast(`Ekspor gagal: ${err.message}`);
    }
    btn.disabled = false;
    btn.textContent = count > 1 ? `Ekspor ${count} PNG` : 'Ekspor PNG';
  });
  row(s,
    selectField({ value: exportScale, options: [['1', '1x'], ['2', '2x'], ['3', '3x']], onChange: (v) => { exportScale = v; } }),
    btn);
  const code = document.createElement('button');
  code.className = 'small-btn wide';
  code.textContent = '</> Lihat kode';
  code.addEventListener('click', openCode);
  const preview = document.createElement('button');
  preview.className = 'small-btn wide';
  preview.textContent = 'Preview responsif';
  preview.addEventListener('click', openPreview);
  row(s, code, preview);
}

// Instance komponen: isinya mengikuti master, jadi panel hanya menawarkan ke master atau detach.
function renderInstance(comp, ref) {
  const s = section('Komponen · salinan');
  s.append(div('props-hint', `Salinan dari "${comp.name}". Isinya otomatis mengikuti master, jadi edit master-nya untuk mengubah semua salinan. Detach kalau salinan ini perlu dibuat berbeda.`));
  const go = document.createElement('button');
  go.className = 'small-btn wide';
  go.textContent = 'Edit master';
  go.addEventListener('click', () => goToMaster(comp.id));
  const detach = document.createElement('button');
  detach.className = 'small-btn wide';
  detach.textContent = 'Detach';
  detach.addEventListener('click', () => detachInstance(ref));
  row(s, go, detach);
  renderExport();
}

async function exportPng(ref, scale) {
  const a = getArtboard(ref.artboardId);
  const el = resolve(ref);
  if (!a || !el) return;
  await saveNow(a.id); // pastikan editan terakhir sudah tersimpan sebelum dirender
  const params = new URLSearchParams({ id: a.id, scale });
  if (ref.path.length) params.set('selector', selectorOf(ref));
  const res = await fetch(`/api/export?${params}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  const blob = await res.blob();
  const label = ref.path.length ? `-${el.id || el.classList[0] || el.tagName.toLowerCase()}` : '';
  const filename = `${a.name}${label}@${scale}x.png`.replace(/[\\/:*?"<>|]+/g, '-');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

// Saat tool Frame aktif: pilih ukuran layar siap pakai, seperti di Figma.
function renderFramePresets() {
  const s = section('Frame');
  s.append(div('props-hint', 'Drag di kanvas untuk menggambar frame, atau pilih ukuran layar:'));
  for (const [name, width, height] of FRAME_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset';
    btn.append(span('', name), span('preset-size', `${width} × ${height}`));
    btn.addEventListener('click', async () => {
      const created = await createArtboardWithHistory({ name, width, height }, 'Buat artboard');
      if (!created) return;
      setTool('select');
      setSelection({ artboardId: created.id, path: [] });
      fitRect({ x: created.x, y: created.y, w: created.width, h: created.height }, 1);
    });
    s.append(btn);
  }
}

// ---------- Komponen field ----------

// Tombol kecil ◇ di ujung field untuk memilih design token.
function addTokenButton(wrap, { tokenGroup, onToken }) {
  if (!tokenGroup) return;
  const btn = document.createElement('button');
  btn.className = 'token-btn';
  btn.title = 'Pakai design token';
  btn.textContent = '◇';
  btn.addEventListener('click', () => openTokenMenu(btn, tokenGroup, onToken));
  wrap.append(btn);
}

function showLinked(input, linked) {
  if (!linked) return;
  input.value = linked;
  input.classList.add('linked');
  input.title = `Token: var(--${linked}). Ketik nilai lain untuk melepas token.`;
}

// Angka: ketik nilai (angka polos = px, atau nilai CSS seperti "auto"/"50%"),
// ↑/↓ untuk +1/-1 (Shift = 10), atau drag label ke kiri/kanan seperti di Figma.
function numberField({ label, value, unit = '', step = 1, onCommit, linked, tokenGroup, onToken }) {
  const wrap = div('field');
  const lab = span('field-label scrub', label);
  const input = document.createElement('input');
  input.className = 'field-input';
  input.value = value;
  input.spellcheck = false;
  showLinked(input, linked);
  let current = parseFloat(value);

  const commit = (raw) => {
    raw = String(raw).trim();
    const isNum = /^-?\d*\.?\d+$/.test(raw);
    const n = isNum ? Number(raw) : NaN;
    if (isNum) current = n;
    onCommit(isNum ? `${round(n)}${unit}` : raw, n);
  };
  const nudge = (delta) => {
    const next = round((Number.isFinite(current) ? current : 0) + delta);
    input.value = next;
    input.classList.remove('linked');
    commit(next);
  };

  input.addEventListener('change', () => commit(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') { input.value = linked ?? value; input.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudge((e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
    }
  });

  lab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    lab.setPointerCapture(e.pointerId);
    const base = Number.isFinite(current) ? current : 0;
    let acc = 0;
    const move = (ev) => {
      acc += ev.movementX;
      const next = round(base + Math.round(acc / 2) * step * (ev.shiftKey ? 10 : 1));
      if (String(next) !== input.value) {
        input.value = next;
        input.classList.remove('linked');
        commit(next);
      }
    };
    const up = () => {
      lab.removeEventListener('pointermove', move);
      lab.removeEventListener('pointerup', up);
      lab.removeEventListener('pointercancel', up);
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
    lab.addEventListener('pointercancel', up);
  });

  wrap.append(lab, input);
  addTokenButton(wrap, { tokenGroup, onToken });
  return wrap;
}

function colorField({ value, onCommit, linked, tokenGroup, onToken }) {
  const { hex, alpha } = parseColor(value);
  const wrap = div('field');
  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'swatch';
  swatch.value = hex;
  const input = document.createElement('input');
  input.className = 'field-input';
  input.spellcheck = false;
  input.style.paddingLeft = '8px';
  input.value = alpha === 0 ? 'transparent' : alpha < 1 ? value : hex.toUpperCase();
  showLinked(input, linked);

  swatch.addEventListener('input', () => {
    input.value = swatch.value.toUpperCase();
    input.classList.remove('linked');
    onCommit(swatch.value);
  });
  input.addEventListener('change', () => {
    onCommit(input.value.trim());
    if (/^#[0-9a-f]{6}$/i.test(input.value.trim())) swatch.value = input.value.trim();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });

  wrap.append(swatch, input);
  addTokenButton(wrap, { tokenGroup, onToken });
  return wrap;
}

function selectField({ label, value, options, onChange }) {
  const wrap = div('field');
  if (label) wrap.append(span('field-label', label));
  const select = document.createElement('select');
  select.className = 'field-input';
  const pairs = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  if (!pairs.some(([v]) => v === value)) pairs.unshift([value, value]);
  for (const [v, text] of pairs) select.append(new Option(text, v, false, v === value));
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(select);
  return wrap;
}

function segmented({ value, options, onChange }) {
  const wrap = div('segmented');
  for (const [v, text] of options) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.classList.toggle('active', v === value);
    btn.addEventListener('click', () => onChange(v));
    wrap.append(btn);
  }
  return wrap;
}

function textField({ label, value, onCommit, linked, tokenGroup, onToken }) {
  const wrap = div('field');
  if (label) wrap.append(span('field-label', label));
  const input = document.createElement('input');
  input.className = 'field-input';
  input.spellcheck = false;
  input.value = value;
  showLinked(input, linked);
  input.addEventListener('change', () => onCommit(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  wrap.append(input);
  addTokenButton(wrap, { tokenGroup, onToken });
  return wrap;
}

// Font: ketik bebas, ▾ untuk memilih Google Font, ◇ untuk memakai token font.
function fontField({ value, onCommit, onPickFont, linked, tokenGroup, onToken }) {
  const wrap = textField({ label: 'Font', value, onCommit, linked });
  const pick = document.createElement('button');
  pick.className = 'token-btn';
  pick.title = 'Pilih Google Font';
  pick.textContent = '▾';
  pick.addEventListener('click', () => openFontMenu(pick, primaryFamily(value), onPickFont));
  wrap.append(pick);
  addTokenButton(wrap, { tokenGroup, onToken });
  return wrap;
}

function textArea({ value, onCommit }) {
  const wrap = div('field tall');
  const area = document.createElement('textarea');
  area.className = 'field-input';
  area.value = value;
  area.addEventListener('change', () => onCommit(area.value));
  wrap.append(area);
  return wrap;
}

// ---------- Helper ----------

function section(title) {
  const s = div('prop-section');
  s.append(div('prop-title', title));
  panel.append(s);
  return s;
}

function row(sectionEl, ...fields) {
  const r = div('prop-row');
  r.append(...fields);
  sectionEl.append(r);
}

function hasOwnText(el) {
  return [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
}

// Nama token kalau inline style elemen berisi var(--nama), mis. "color-primary".
function linkedToken(el, prop) {
  return el.style.getPropertyValue(prop).trim().match(/^var\(--([\w-]+)\)$/)?.[1] ?? null;
}

// "12.5px" -> 12.5, nilai lain ("auto", "normal") dibiarkan apa adanya.
function px(v) {
  return v.endsWith('px') ? round(parseFloat(v)) : v;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function parseColor(value) {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return { hex: '#000000', alpha: 1 };
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const hex = '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
  return { hex, alpha: a };
}

function div(className, text) {
  const el = document.createElement('div');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}

function span(className, text) {
  const el = document.createElement('span');
  el.className = className;
  if (text) el.textContent = text;
  return el;
}
