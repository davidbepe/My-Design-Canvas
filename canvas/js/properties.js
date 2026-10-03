// Panel Properti: baca style elemen terpilih, lalu ubah lewat inline style saat diedit.
// Kalau beberapa elemen terpilih, nilai yang ditampilkan dari elemen utama (terakhir dipilih),
// tapi editan berlaku ke SEMUA elemen yang terpilih.
import { state, emit, resolve, getArtboard, setSelection, setTool, toast } from './state.js';
import { captureDoc, group } from './history.js';
import { changeArtboard, createArtboardWithHistory } from './actions.js';
import { fitRect } from './camera.js';
import { selectorOf } from './selection.js';
import { saveNow } from './persist.js';
import { openTokenMenu, data as varData, tokens as tokenValues } from './tokens.js';
import { componentOf, countInstances, goToMaster, detachInstance, renameComponent } from './components.js';
import { openFontMenu, primaryFamily, fontFamilyValue, ensureFontInDoc } from './fonts.js';
import { openCode } from './codeexport.js';
import { openPreview } from './preview.js';
import {
  addAutoLayout, removeAutoLayout, alignmentOf, alignmentStyles, sizeModeOf, sizeModeStyles, fixedSizeCleanup,
} from './autolayout.js';
import { isFree, makeFree, makeFlow, freePosition } from './position.js';
import { SHAPE_LABELS, setShapeCount } from './shapes.js';
import { canvasColor, applyCanvasColor, CANVAS_PRESETS, DEFAULT_CANVAS } from './canvasbg.js';
import { openColorPicker, rememberColor } from './colorpicker.js';

const FRAME_PRESETS = [
  ['iPhone 16', 393, 852],
  ['iPhone SE', 375, 667],
  ['Android', 360, 800],
  ['iPad', 820, 1180],
  ['Laptop', 1280, 832],
  ['Desktop', 1440, 900],
];

const DISPLAYS = ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'];
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
  if (!ref) return renderNothingSelected();
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
  // Beberapa properti sekaligus, dihitung per elemen (mis. resizing yang bergantung pada induknya).
  // Nilai null = hapus properti itu.
  const setStyles = (stylesFor, { rerender = true } = {}) => {
    artboardIds.forEach((id) => captureDoc(id));
    for (const t of targets) {
      for (const [prop, value] of Object.entries(stylesFor(t.el))) {
        if (value == null) t.el.style.removeProperty(prop);
        else t.el.style.setProperty(prop, value);
      }
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
    // Mode variabel (mis. Light/Dark) untuk artboard ini: <html data-mode="...">
    if (varData.modes.length > 1) {
      const root = el.ownerDocument.documentElement;
      const current = varData.modes.find((m) => varData.slugs[m] === root.getAttribute('data-mode')) ?? varData.modes[0];
      row(s, selectField({
        label: 'Mode', value: current, options: varData.modes,
        onChange: (m) => {
          artboardIds.forEach((id) => captureDoc(id, 'Ganti mode artboard'));
          for (const t of targets) {
            const html = t.el.ownerDocument.documentElement;
            if (m === varData.modes[0]) html.removeAttribute('data-mode');
            else html.setAttribute('data-mode', varData.slugs[m]);
          }
          artboardIds.forEach((id) => emit('edit', id));
        },
      }));
    }
  } else {
    const s = section('Ukuran & resizing');
    // Mengetik angka = ukuran tetap (Fixed), jadi Fill dari auto layout dilepas.
    const sizeCommit = (axis) => (v) => setStyles((t) => ({ ...(/px$/.test(v) ? fixedSizeCleanup(t, axis) : {}), [axis]: v }), { rerender: false });
    row(s,
      numberField({ label: 'W', value: px(cs.width), unit: 'px', onCommit: sizeCommit('width') }),
      numberField({ label: 'H', value: px(cs.height), unit: 'px', onCommit: sizeCommit('height') }));
    // Resizing ala Figma: Fixed (ukuran tetap), Hug (selebar isinya), Fill (mengisi ruang induk).
    const MODES = [['fixed', 'Fixed'], ['hug', 'Hug'], ['fill', 'Fill']];
    row(s,
      selectField({ label: '↔', value: sizeModeOf(el, 'width'), options: MODES, onChange: (m) => setStyles((t) => sizeModeStyles(t, 'width', m)) }),
      selectField({ label: '↕', value: sizeModeOf(el, 'height'), options: MODES, onChange: (m) => setStyles((t) => sizeModeStyles(t, 'height', m)) }));
  }

  // Posisi: ikut layout, atau bebas (absolut) dengan X/Y dan bisa di-drag di kanvas
  if (!isRoot) {
    const free = isFree(el);
    const ps = section('Posisi');
    row(ps, segmented({
      value: free ? 'free' : 'flow',
      options: [['flow', 'Ikut layout'], ['free', 'Bebas']],
      onChange: (v) => {
        artboardIds.forEach((id) => captureDoc(id, 'Ubah posisi'));
        for (const t of targets) (v === 'free' ? makeFree : makeFlow)(t.el);
        artboardIds.forEach((id) => emit('edit', id));
        renderProperties();
      },
    }));
    if (free) {
      const p = freePosition(el);
      row(ps,
        numberField({ label: 'X', value: round(p.left), unit: 'px', onCommit: (v) => set('left', v) }),
        numberField({ label: 'Y', value: round(p.top), unit: 'px', onCommit: (v) => set('top', v) }));
      ps.append(div('props-hint', 'Drag elemen ini di kanvas untuk memindahkannya. Garis merah = sejajar, garis pink = jarak sama.'));
    }
  }

  // Shape (segitiga, polygon, bintang, garis, panah) dan vector (pen/pencil): fill & stroke
  const shapeKind = el.getAttribute('data-shape');
  const vectorKind = el.getAttribute('data-vector');
  const drawnSvg = tag === 'svg' && !!(shapeKind || vectorKind);
  if (drawnSvg) {
    const lineLike = shapeKind === 'line' || shapeKind === 'arrow';
    const s = section(vectorKind ? 'Vector' : SHAPE_LABELS[shapeKind] ?? 'Shape');
    if (!lineLike) row(s, colorField({ label: 'Fill', value: cs.fill, onCommit: (v) => set('fill', v), ...tok('fill', 'color') }));
    // Kepala panah mengikuti "color", jadi untuk garis/panah warna stroke disalin ke sana.
    row(s, colorField({
      label: 'Stroke', value: cs.stroke,
      onCommit: (v) => { set('stroke', v); if (lineLike) set('color', v); },
      linked: linkedToken(el, 'stroke'), tokenGroup: 'color',
      onToken: (v) => { set('stroke', v); if (lineLike) set('color', v); renderProperties(); },
    }));
    row(s,
      numberField({ label: 'Tebal', value: px(cs.strokeWidth), unit: 'px', step: 0.5, onCommit: (v) => set('stroke-width', v) }),
      numberField({ label: 'Opacity', value: round(Number(cs.opacity) * 100), step: 5, onCommit: (_css, n) => {
        if (Number.isFinite(n)) set('opacity', String(Math.min(100, Math.max(0, n)) / 100));
      } }));
    if (shapeKind === 'polygon' || shapeKind === 'star') {
      row(s, numberField({
        label: shapeKind === 'star' ? 'Titik' : 'Sisi', value: Number(el.getAttribute('data-count')) || 5,
        onCommit: (_css, n) => {
          if (!Number.isFinite(n)) return;
          artboardIds.forEach((id) => captureDoc(id, 'Ubah jumlah sisi'));
          for (const t of targets) if (t.el.getAttribute('data-shape') === shapeKind) setShapeCount(t.el, n);
          artboardIds.forEach((id) => emit('edit', id));
        },
      }));
    }
  } else if (tag === 'svg') {
    // Ikon (SVG): ukuran, warna, ketebalan garis
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

  // Auto layout (= CSS flexbox), dengan kontrol ala Figma. SVG tidak punya isi untuk disusun.
  if (tag !== 'svg') renderAutoLayout();
  function renderAutoLayout() {
  const isFlex = cs.display.includes('flex');
  const isGrid = cs.display.includes('grid');
  const refs = targets.map((t) => t.ref);
  const al = section('Auto layout', isFlex
    ? { label: '−', title: 'Hapus auto layout', onClick: () => removeAutoLayout(refs) }
    : { label: '+', title: 'Tambah auto layout (Shift+A)', onClick: () => addAutoLayout(refs) });
  const gapField = () => numberField({
    label: 'Gap', value: px(cs.rowGap === 'normal' ? '0px' : cs.rowGap), unit: 'px',
    onCommit: (v) => set('gap', v), ...tok('gap', 'space'),
  });
  if (!isFlex) {
    al.append(div('props-hint', 'Klik + (atau Shift+A) supaya isi tersusun otomatis: arah, jarak antar-elemen, dan perataan diatur dari sini.'));
    if (isGrid) row(al, gapField());
  } else {
    const isRow = cs.flexDirection.startsWith('row');
    row(al, segmented({
      value: isRow ? 'row' : 'column',
      options: [['column', '↓ Vertikal'], ['row', '→ Horizontal']],
      onChange: (v) => set('flex-direction', v, { rerender: true }),
    }));
    // Kotak perataan 3×3 di kiri, gap & opsi di kanan (seperti panel Figma).
    const autoGap = cs.justifyContent === 'space-between';
    const grid = alignGrid(alignmentOf(cs), (h, v) => setStyles((t) => alignmentStyles(t.ownerDocument.defaultView.getComputedStyle(t), h, v)));
    const side = div('al-col');
    side.append(gapField());
    const opts = div('al-opts');
    opts.append(toggleButton('Auto', autoGap, 'Jarak dibagi rata (space-between)', () => set('justify-content', autoGap ? 'flex-start' : 'space-between', { rerender: true })));
    if (isRow) {
      const wrapped = cs.flexWrap === 'wrap';
      opts.append(toggleButton('Wrap', wrapped, 'Pindah ke baris baru kalau tidak muat', () => set('flex-wrap', wrapped ? 'nowrap' : 'wrap', { rerender: true })));
    }
    side.append(opts);
    const layoutRow = div('al-row');
    layoutRow.append(grid, side);
    al.append(layoutRow);
  }
  row(al, selectField({ label: 'Display', value: cs.display, options: DISPLAYS, onChange: (v) => set('display', v, { rerender: true }) }));
  }

  // Spacing: diagram kotak ala Webflow (margin di luar, padding di dalam, ukuran di tengah)
  const spacing = section('Spacing');
  spacing.append(boxModel({ el, cs, set }));
  spacing.append(div('props-hint', 'Padding = jarak isi ke tepi elemen. Margin = jarak elemen ke elemen lain. Klik angka untuk mengubah (bisa ketik nama variabel, mis. space-4), atau drag ke kiri/kanan.'));

  // Fill & Border mengatur kotak elemen; untuk shape/vector SVG sudah diganti bagian Shape di atas.
  if (!drawnSvg) renderFillBorder();
  function renderFillBorder() {
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
  // Radius. Seperti frame di Figma, isi frame ikut terpotong mengikuti sudutnya ("Clip isi"):
  // otomatis dinyalakan saat radius diberikan ke elemen yang punya isi.
  const autoClip = (t, n) => (!isRoot && n > 0 && t.children.length
    && t.ownerDocument.defaultView.getComputedStyle(t).overflow === 'visible' ? { overflow: 'hidden' } : {});
  const clipped = ['hidden', 'clip'].includes(cs.overflow);
  row(border,
    numberField({
      label: 'Radius', value: px(cs.borderTopLeftRadius), unit: 'px',
      onCommit: (v, n) => setStyles((t) => ({ 'border-radius': v, ...autoClip(t, n) }), { rerender: true }),
      ...tok('border-radius', 'radius'),
    }),
    ...(isRoot ? [] : [toggleButton('Clip isi', clipped, 'Potong isi yang keluar dari kotak/sudut elemen (Clip content di Figma)',
      () => set('overflow', clipped ? 'visible' : 'hidden', { rerender: true }))]));
  }

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

// ---------- Tidak ada yang dipilih: pengaturan kanvas ----------

function renderNothingSelected() {
  // Warna latar kanvas (area di belakang artboard), seperti "Page" di Figma.
  const s = section('Kanvas');
  const apply = (color) => {
    if (!applyCanvasColor(color)) return toast('Warna tidak dikenali. Contoh: #2c2c2c');
    renderProperties();
  };
  // Dari color picker: diterapkan langsung tanpa membangun ulang panel di setiap gerakan.
  row(s, colorField({
    label: 'Warna', value: canvasColor(),
    onCommit: (color) => { if (!applyCanvasColor(color)) toast('Warna tidak dikenali. Contoh: #2c2c2c'); },
  }));
  const presets = div('canvas-presets');
  for (const [color, name] of CANVAS_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'canvas-swatch';
    btn.classList.toggle('on', color === canvasColor());
    btn.style.background = color;
    btn.title = name;
    btn.addEventListener('click', () => { rememberColor(color); apply(color); });
    presets.append(btn);
  }
  const reset = document.createElement('button');
  reset.className = 'small-btn';
  reset.textContent = 'Reset';
  reset.title = 'Kembali ke warna bawaan';
  reset.addEventListener('click', () => apply(DEFAULT_CANVAS));
  presets.append(reset);
  s.append(presets);

  panel.append(div('props-empty', 'Pilih elemen di kanvas atau di panel Layers untuk mengedit propertinya.'));
  const open = document.createElement('button');
  open.className = 'small-btn props-cta';
  open.textContent = 'Kelola variabel (design system)';
  open.addEventListener('click', () => emit('open-tab', 'variables'));
  panel.append(open);
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

function colorField({ label, value, onCommit, linked, tokenGroup, onToken }) {
  const { hex, alpha } = parseColor(value);
  const wrap = div('field');
  if (label) wrap.append(span('field-label', label));
  // Kotak warna: klik untuk membuka color picker ala Figma (colorpicker.js).
  const swatch = document.createElement('button');
  swatch.className = 'swatch-btn';
  swatch.title = 'Pilih warna';
  swatch.style.setProperty('--sw', value === 'none' ? 'transparent' : value);
  const input = document.createElement('input');
  input.className = 'field-input';
  input.spellcheck = false;
  input.style.paddingLeft = '8px';
  input.value = value === 'none' ? 'none' : alpha === 0 ? 'transparent' : alpha < 1 ? value : hex.toUpperCase();
  showLinked(input, linked);

  swatch.addEventListener('click', () => openColorPicker(swatch, {
    value: getComputedColor(swatch),
    // Perubahan langsung diterapkan selama di-drag (undo menggabungkannya jadi satu langkah).
    onInput: (css) => {
      swatch.style.setProperty('--sw', css);
      input.value = css.startsWith('#') ? css.toUpperCase() : css;
      input.classList.remove('linked');
      onCommit(css);
    },
    onToken: onToken && ((v) => onToken(v)),
  }));
  input.addEventListener('change', () => {
    onCommit(input.value.trim());
    rememberColor(input.value.trim()); // masuk "Warna terakhir" di color picker
    swatch.style.setProperty('--sw', input.value.trim());
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

// action (opsional): tombol kecil di kanan judul, mis. + untuk menambah auto layout.
function section(title, action) {
  const s = div('prop-section');
  const head = div('prop-title token-title');
  head.append(span('', title));
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'icon-text-btn';
    btn.textContent = action.label;
    btn.title = action.title;
    btn.addEventListener('click', action.onClick);
    head.append(btn);
  }
  s.append(head);
  panel.append(s);
  return s;
}

// Diagram spacing ala Webflow: kotak luar = margin, kotak dalam = padding, tengah = ukuran elemen.
// Setiap angka berada di sisi yang diaturnya. Klik untuk mengetik, drag kiri/kanan untuk menggeser nilai.
function boxModel({ el, cs, set }) {
  const r = el.getBoundingClientRect();
  const margin = div('bm-margin');
  const padding = div('bm-padding');
  margin.append(span('bm-caption', 'MARGIN'));
  padding.append(span('bm-caption', 'PADDING'));
  padding.append(div('bm-content', `${round(r.width)} × ${round(r.height)}`));
  for (const side of ['top', 'right', 'bottom', 'left']) {
    margin.append(spacingValue({ el, cs, set, prop: `margin-${side}`, side }));
    padding.append(spacingValue({ el, cs, set, prop: `padding-${side}`, side }));
  }
  margin.append(padding);
  const box = div('box-model');
  box.append(margin);
  return box;
}

function spacingValue({ el, cs, set, prop, side }) {
  const computed = px(cs.getPropertyValue(prop));
  const linked = linkedToken(el, prop);
  const btn = document.createElement('button');
  btn.className = `bm-value bm-${side}`;
  btn.textContent = linked ? (px(tokenValues[linked] ?? '') || linked) : computed;
  btn.title = `${prop}${linked ? `: var(--${linked}) = ${tokenValues[linked]}` : ''}`;
  btn.classList.toggle('linked', !!linked);
  btn.classList.toggle('zero', !linked && Number(computed) === 0);

  // Tekan lalu geser = ubah nilai; tekan lalu lepas tanpa geser = ketik nilai.
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.setPointerCapture(e.pointerId);
    const base = parseFloat(computed) || 0;
    let moved = false;
    const move = (ev) => {
      const dx = ev.clientX - e.clientX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const next = Math.max(prop.startsWith('padding') ? 0 : -999, round(base + Math.round(dx / 2) * (ev.shiftKey ? 10 : 1)));
      btn.textContent = next;
      btn.classList.remove('linked', 'zero');
      set(prop, `${next}px`);
    };
    const up = () => {
      btn.removeEventListener('pointermove', move);
      btn.removeEventListener('pointerup', up);
      if (moved) renderProperties();
      else editSpacing(btn, { prop, side, set, value: linked ?? computed });
    };
    btn.addEventListener('pointermove', move);
    btn.addEventListener('pointerup', up);
  });
  return btn;
}

function editSpacing(btn, { prop, side, set, value }) {
  const input = document.createElement('input');
  input.className = `bm-input bm-${side}`;
  input.value = value;
  input.spellcheck = false;
  btn.hidden = true;
  btn.after(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const raw = input.value.trim();
    if (!save || raw === String(value)) { input.remove(); btn.hidden = false; return; }
    // Angka = px, nama variabel = var(--nama), kosong = hapus, selain itu nilai CSS apa adanya (mis. auto).
    let css = raw;
    if (raw === '') css = '';
    else if (/^-?\d*\.?\d+$/.test(raw)) css = `${raw}px`;
    else if (tokenValues[raw] !== undefined) css = `var(--${raw})`;
    else if (tokenValues[raw.replace(/^--/, '')] !== undefined) css = `var(--${raw.replace(/^--/, '')})`;
    set(prop, css, { rerender: true });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const n = (parseFloat(input.value) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      input.value = n;
      set(prop, `${n}px`);
    }
  });
  input.addEventListener('blur', () => commit(true));
}

// Kotak perataan 3×3: klik titik untuk menaruh isi di posisi itu.
function alignGrid(current, onPick) {
  const NAMES = { start: ['kiri', 'atas'], center: ['tengah', 'tengah'], end: ['kanan', 'bawah'] };
  const grid = div('align-grid');
  for (const v of ['start', 'center', 'end']) {
    for (const h of ['start', 'center', 'end']) {
      const cell = document.createElement('button');
      cell.className = 'align-cell';
      cell.classList.toggle('active', current.h === h && current.v === v);
      cell.title = `Rata ${NAMES[v][1]} ${NAMES[h][0]}`;
      cell.addEventListener('click', () => onPick(h, v));
      grid.append(cell);
    }
  }
  return grid;
}

function toggleButton(label, on, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'small-btn';
  btn.classList.toggle('on', on);
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
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

// Warna yang sedang ditampilkan kotak warna (nilai --sw).
function getComputedColor(swatch) {
  return swatch.style.getPropertyValue('--sw') || '#000000';
}

function parseColor(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return { hex: value.toLowerCase(), alpha: 1 };
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
