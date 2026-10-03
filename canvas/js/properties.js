// Panel Properti: baca style elemen terpilih, lalu ubah lewat inline style saat diedit.
// Kalau beberapa elemen terpilih, nilai yang ditampilkan dari elemen utama (terakhir dipilih),
// tapi editan berlaku ke SEMUA elemen yang terpilih.
import { state, emit, resolve, getArtboard, setSelection, setTool, toast } from './state.js';
import { captureDoc, group, recordDoc } from './history.js';
import { changeArtboard, createArtboardWithHistory } from './actions.js';
import { fitRect } from './camera.js';
import { selectorOf } from './selection.js';
import { saveNow } from './persist.js';
import { openTokenMenu, data as varData, tokens as tokenValues } from './tokens.js';
import { componentOf, countInstances, goToMaster, detachInstance, renameComponent, createComponent } from './components.js';
import { openFontMenu, primaryFamily, fontFamilyValue, ensureFontInDoc } from './fonts.js';
import { openCode } from './codeexport.js';
import { openPreview } from './preview.js';
import {
  addAutoLayout, removeAutoLayout, alignmentOf, alignmentStyles, sizeModeOf, sizeModeStyles, fixedSizeCleanup,
} from './autolayout.js';
import { isFree, makeFree, makeFlow, freePosition, rotationOf } from './position.js';
import { SHAPE_LABELS, setShapeCount, CONVERTIBLE_SHAPES, shapeToVector } from './shapes.js';
import { isGroup, ungroupSelection } from './group.js';
import { canAlign, alignSelection, distributeSelection } from './align.js';
import {
  readEffects, effectStyles, defaultEffect, effectKey, ADJUSTMENTS, parseGradient, gradientCss,
} from './effects.js';
import { canvasColor, applyCanvasColor, CANVAS_PRESETS, DEFAULT_CANVAS } from './canvasbg.js';
import { openColorPicker, rememberColor, parseCss } from './colorpicker.js';
import { isEditingVector, startVectorEdit, stopVectorEdit } from './vectoredit.js';
import { isPixelGridOn, setPixelGrid, PIXEL_GRID_MIN_ZOOM } from './pixelgrid.js';
import { hugOf, setHugFlag, syncHug } from './hug.js';

const FRAME_PRESETS = [
  ['iPhone 16', 393, 852],
  ['iPhone SE', 375, 667],
  ['Android', 360, 800],
  ['iPad', 820, 1180],
  ['Laptop', 1280, 832],
  ['Desktop', 1440, 900],
];

const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];
const WEIGHTS = [['100', '100 Thin'], ['200', '200 Extra light'], ['300', '300 Light'], ['400', '400 Regular'],
  ['500', '500 Medium'], ['600', '600 Semibold'], ['700', '700 Bold'], ['800', '800 Extra bold'], ['900', '900 Black']];
const TEXT_ALIGN = [['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan'], ['justify', 'Rata']];

let panel;
let exportScale = '2';
let scrubbing = false;
let renderPending = false;
const sidesMode = new Map(); // padding/margin: 1 = semua sisi, 2 = vertikal/horizontal, 4 = tiap sisi
const sidesOpen = new Set(); // padding/margin/radius yang sedang ditampilkan per sisi
const sectionOpen = new Map(); // bagian yang dilipat/dibuka (mis. Context)
const ICONS = {
  layout: '<rect x="1.5" y="1.5" width="5" height="11" rx="1"/><rect x="8.5" y="1.5" width="4" height="4.5" rx="1"/><rect x="8.5" y="8" width="4" height="4.5" rx="1"/>',
  grid: '<rect x="1.5" y="1.5" width="11" height="11" rx="1.5"/><path d="M5.5 1.5v11M9.5 1.5v11M1.5 5.5h11M1.5 9.5h11"/>',
  more: '<circle cx="3" cy="7" r="1.1" fill="currentColor"/><circle cx="7" cy="7" r="1.1" fill="currentColor"/><circle cx="11" cy="7" r="1.1" fill="currentColor"/>',
  freeform: '<rect x="2" y="2" width="4" height="4" rx="1"/><rect x="8" y="2" width="4" height="4" rx="1"/><rect x="2" y="8" width="4" height="4" rx="1"/><rect x="8" y="8" width="4" height="4" rx="1"/>',
  vertical: '<path d="M7 1.5v8M4 6.5l3 3 3-3M3 12.5h8"/>',
  horizontal: '<path d="M1.5 7h8M6.5 4l3 3-3 3M12.5 3v8"/>',
  rotate: '<path d="M11.5 6.5A4.5 4.5 0 1 1 7 2h2.5"/><path d="M8 0.5 9.5 2 8 3.5"/>',
  flipH: '<path d="M7 1v12" stroke-dasharray="1.5 1.5"/><path d="M5.5 3.5 1.5 10.5h4zM8.5 3.5l4 7h-4z"/>',
  flipV: '<path d="M1 7h12" stroke-dasharray="1.5 1.5"/><path d="M3.5 5.5 10.5 1.5v4zM3.5 8.5l7 4v-4z"/>',
}; // titik gradient yang sedang dipilih (tetap terpilih saat panel digambar ulang)

// Ikon tombol Align & Distribute (14×14)
const ALIGN_ICONS = {
  left: '<path d="M2 1.5v11"/><rect x="4" y="3.5" width="8" height="2.5" rx=".5"/><rect x="4" y="8" width="5" height="2.5" rx=".5"/>',
  hcenter: '<path d="M7 1.5v11"/><rect x="2.5" y="3.5" width="9" height="2.5" rx=".5"/><rect x="4" y="8" width="6" height="2.5" rx=".5"/>',
  right: '<path d="M12 1.5v11"/><rect x="2" y="3.5" width="8" height="2.5" rx=".5"/><rect x="5" y="8" width="5" height="2.5" rx=".5"/>',
  top: '<path d="M1.5 2h11"/><rect x="3.5" y="4" width="2.5" height="8" rx=".5"/><rect x="8" y="4" width="2.5" height="5" rx=".5"/>',
  vcenter: '<path d="M1.5 7h11"/><rect x="3.5" y="2.5" width="2.5" height="9" rx=".5"/><rect x="8" y="4" width="2.5" height="6" rx=".5"/>',
  bottom: '<path d="M1.5 12h11"/><rect x="3.5" y="2" width="2.5" height="8" rx=".5"/><rect x="8" y="5" width="2.5" height="5" rx=".5"/>',
  dh: '<path d="M1.5 2v10M12.5 2v10"/><rect x="5.5" y="4" width="3" height="6" rx=".5"/>',
  dv: '<path d="M2 1.5h10M2 12.5h10"/><rect x="4" y="5.5" width="6" height="3" rx=".5"/>',
};
const ALIGN_TITLES = {
  left: 'Rata kiri (Alt+A)', hcenter: 'Rata tengah horizontal (Alt+H)', right: 'Rata kanan (Alt+D)',
  top: 'Rata atas (Alt+W)', vcenter: 'Rata tengah vertikal (Alt+V)', bottom: 'Rata bawah (Alt+S)',
  dh: 'Jarak horizontal sama (Alt+Shift+H)', dv: 'Jarak vertikal sama (Alt+Shift+V)',
};

export function initProperties(el) {
  panel = el;
}

export function renderProperties() {
  // Saat nilai sedang di-drag, panel jangan digambar ulang: label yang di-drag akan hilang dan
  // drag-nya terputus. Digambar sekali setelah mouse dilepas.
  if (scrubbing) { renderPending = true; return; }
  // Panel digambar ulang dari awal setiap ada perubahan. Posisi scroll dipertahankan selama
  // elemen yang terpilih sama, supaya klik tombol di bawah tidak melempar panel ke atas.
  const scroller = scrollParent(panel);
  const key = selectionKey();
  const keepScroll = scroller && key === lastSelectionKey;
  const top = scroller?.scrollTop ?? 0;
  lastSelectionKey = key;
  renderPanel();
  if (keepScroll) scroller.scrollTop = top;
}

let lastSelectionKey = '';
const selectionKey = () => `${state.tool === 'frame' ? 'frame-tool|' : ''}${state.selected.map((r) => `${r.artboardId}:${r.path.join('.')}`).join(',')}`;

function scrollParent(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

function renderPanel() {
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

  // Susunan panel mengikuti pen.dev: Komponen, Context, Alignment, Position, Layout, Appearance,
  // Typography, Fill, Stroke, Effects, Theme, Interaksi, Code, Export.

  // Judul: jenis + nama
  const header = div('props-header');
  header.append(span('tag-pill', targets.length > 1 ? `${targets.length} dipilih` : isRoot ? 'frame utama' : isGroup(el) ? 'group' : kindLabel(el, cs, tag)));
  const name = isRoot ? artboard.name : el.getAttribute('data-name') || (el.id ? `#${el.id}` : el.classList.length ? `.${[...el.classList].join('.')}` : '');
  if (name) header.append(span('props-name', name));
  panel.append(header);

  // Group: tidak punya kotak sendiri (display: contents), jadi tidak ada Layout/Fill/Stroke.
  if (isGroup(el)) {
    renderAlignment();
    const g = section('Group');
    row(g, button('Ungroup (Ctrl+Shift+G)', ungroupSelection, 'small-btn wide'));
    return;
  }

  // ---------- Komponen ----------
  const comp = componentOf(el);
  if (comp?.role === 'instance') return renderInstance(comp, ref);
  if (comp?.role === 'master' && comp.root === el) {
    const s = section('Komponen · master');
    row(s, textField({ label: 'Nama', value: comp.name, onCommit: (v) => renameComponent(ref, v) }));
    const n = countInstances(comp.id);
    s.append(div('props-hint', n ? `${n} salinan mengikuti master ini` : 'Belum ada salinan'));
  } else if (!isRoot && targets.length === 1) {
    const s = div('prop-section compact');
    s.append(button('◇ Create Component', createComponent, 'small-btn component-btn', 'Jadikan komponen (Ctrl+Alt+K)'));
    panel.append(s);
  }

  // ---------- Context: catatan untuk AI (Claude membacanya lewat get_selection) ----------
  if (targets.length === 1) {
    const context = el.getAttribute('data-context') ?? '';
    const s = collapsible('Context', 'context', !!context);
    if (s) {
      row(s, textArea({ value: context, placeholder: 'Catatan untuk Claude tentang elemen ini, mis. "tombol utama, harus kontras"', onCommit: (v) => {
        captureDoc(ref.artboardId, 'Ubah context');
        if (v.trim()) el.setAttribute('data-context', v.trim());
        else el.removeAttribute('data-context');
        emit('edit', ref.artboardId);
      } }));
    }
  }

  // ---------- Alignment ----------
  renderAlignment();

  // ---------- Artboard ----------
  if (isRoot) {
    const s = section('Frame utama');
    const hug = hugOf(artboard.id);
    // Mengetik ukuran = ukuran tetap, jadi Hug di sisi itu dilepas (seperti Figma).
    const sizeCommit = (key) => (_css, n) => {
      if (!Number.isInteger(n) || n < 1) return;
      if (hug[key]) toggleHug(key, false);
      group('Ubah ukuran frame', () => {
        for (const t of targets) changeArtboard(t.ref.artboardId, { [key]: n }, 'Ubah ukuran frame');
      });
    };
    row(s,
      numberField({ label: 'W', value: artboard.width, onCommit: sizeCommit('width') }),
      numberField({ label: 'H', value: artboard.height, onCommit: sizeCommit('height') }));
    const toggleHug = (axis, on) => {
      artboardIds.forEach((id) => captureDoc(id, on ? 'Hug isi' : 'Lepas hug'));
      for (const t of targets) setHugFlag(t.ref.artboardId, axis, on);
      artboardIds.forEach((id) => { emit('edit', id); syncHug(id); });
      renderProperties();
    };
    const checks = div('check-grid');
    checks.append(
      checkField({ label: 'Fill Width', checked: false, disabled: true, title: 'Frame utama tidak punya induk untuk diisi', onChange: () => {} }),
      checkField({ label: 'Fill Height', checked: false, disabled: true, title: 'Frame utama tidak punya induk untuk diisi', onChange: () => {} }),
      checkField({ label: 'Hug Width', checked: hug.width, title: 'Lebar frame mengikuti isinya', onChange: (on) => toggleHug('width', on) }),
      checkField({ label: 'Hug Height', checked: hug.height, title: 'Tinggi frame mengikuti isinya', onChange: (on) => toggleHug('height', on) }),
      checkField({ label: 'Clip Content', checked: true, disabled: true, title: 'Frame utama selalu memotong isi yang keluar dari kotaknya', onChange: () => {} }),
    );
    s.append(checks);
  }

  // ---------- Position ----------
  if (!isRoot) {
    const free = isFree(el);
    const ps = section('Position');
    const parent = el.parentElement;
    if (free) {
      const p = freePosition(el);
      row(ps,
        numberField({ label: 'X', value: round(p.left), unit: 'px', onCommit: (v) => set('left', v) }),
        numberField({ label: 'Y', value: round(p.top), unit: 'px', onCommit: (v) => set('top', v) }));
    } else {
      // Ikut layout: posisinya diatur induk, jadi X/Y hanya ditampilkan.
      const r = el.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      row(ps,
        numberField({ label: 'X', value: round(r.left - pr.left), disabled: true }),
        numberField({ label: 'Y', value: round(r.top - pr.top), disabled: true }));
    }
    const flip = flipOf(el, cs);
    const rotRow = div('prop-row pos-row');
    rotRow.append(
      numberField({ label: 'R', value: round(rotationOf(el)), unit: 'deg', onCommit: (v, n) => set('rotate', n === 0 || v === '' ? '' : v) }),
      iconButtons([
        { icon: ICONS.rotate, title: 'Putar 90°', onClick: () => {
          const next = (round(rotationOf(el)) + 90) % 360;
          set('rotate', next ? `${next}deg` : '', { rerender: true });
        } },
        { icon: ICONS.flipH, title: 'Balik horizontal (Shift+H)', on: flip.x < 0, onClick: () => flipSelection('x') },
        { icon: ICONS.flipV, title: 'Balik vertikal (Shift+V)', on: flip.y < 0, onClick: () => flipSelection('y') },
      ]));
    ps.append(rotRow);
    row(ps, checkField({
      label: 'Absolute position', checked: free,
      title: 'Lepas dari layout induk dan atur posisinya sendiri (X/Y), bisa di-drag bebas di kanvas',
      onChange: (on) => {
        artboardIds.forEach((id) => captureDoc(id, 'Ubah posisi'));
        for (const t of targets) (on ? makeFree : makeFlow)(t.el);
        artboardIds.forEach((id) => emit('edit', id));
        renderProperties();
      },
    }));
  }

  // ---------- Shape / Vector / Ikon ----------
  const shapeKind = el.getAttribute('data-shape');
  const vectorKind = el.getAttribute('data-vector');
  const drawnSvg = tag === 'svg' && !!(shapeKind || vectorKind);
  const lineLike = shapeKind === 'line' || shapeKind === 'arrow';
  if (drawnSvg) {
    const extra = (vectorKind && targets.length === 1) || (CONVERTIBLE_SHAPES.has(shapeKind) && targets.length === 1) || shapeKind === 'polygon' || shapeKind === 'star';
    if (extra) {
      const s = section(vectorKind ? 'Vector' : SHAPE_LABELS[shapeKind] ?? 'Shape');
      if (vectorKind && targets.length === 1) {
        const editing = isEditingVector();
        const btn = button(editing ? 'Selesai edit titik' : 'Edit titik', () => (editing ? stopVectorEdit() : startVectorEdit(state.selection)), 'small-btn wide');
        btn.classList.toggle('on', editing);
        row(s, btn);
      }
      if (CONVERTIBLE_SHAPES.has(shapeKind) && targets.length === 1) {
        row(s, button('Jadikan vector (edit titik)', () => {
          recordDoc(ref.artboardId, 'Jadikan vector', () => shapeToVector(el));
          emit('structure', ref.artboardId);
          startVectorEdit(ref);
        }, 'small-btn wide', 'Ubah bentuk ini jadi vector supaya titik-titiknya bisa diedit'));
      }
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

  // ---------- Layout: flex layout, padding, ukuran (Fill/Hug), Clip Content ----------
  renderLayout();
  function renderLayout() {
    const isFlex = cs.display.includes('flex');
    const isGridBox = cs.display.includes('grid');
    const canLayout = tag !== 'svg' && !isTextLike(el);
    const refs = targets.map((t) => t.ref);
    // Tanpa layout: semua gaya flex & grid dilepas.
    const layoutOff = (display = 'block') => setStyles(() => ({
      display, 'flex-direction': null, 'flex-wrap': null, gap: null, 'justify-content': null, 'align-items': null,
      'grid-template-columns': null, 'grid-template-rows': null,
    }));
    const s = section(canLayout ? 'Layout' : 'Dimensions', canLayout ? {
      icon: ICONS.layout, on: isFlex || isGridBox,
      title: isFlex || isGridBox ? 'Hapus layout (Shift+Alt+A)' : 'Tambah flex layout (Shift+A)',
      onClick: () => (isFlex || isGridBox ? layoutOff() : addAutoLayout(refs)),
    } : null);

    if (canLayout) {
      // Satu baris pilihan layout: Free form | Vertikal | Horizontal | Grid | ⋯ (inline, inline-block, hidden)
      const rare = ['inline', 'inline-block', 'none'].includes(cs.display);
      const mode = rare ? 'more' : isGridBox ? 'grid' : isFlex ? (cs.flexDirection.startsWith('row') ? 'row' : 'column') : 'none';
      const modes = segmented({
        value: mode,
        icons: true,
        options: [
          ['none', ICONS.freeform, 'Free form (tanpa layout)'],
          ['column', ICONS.vertical, 'Vertikal (flex)'],
          ['row', ICONS.horizontal, 'Horizontal (flex)'],
          ['grid', ICONS.grid, 'Grid (kolom & baris)'],
          ['more', ICONS.more, rare ? `Lainnya: ${DISPLAY_NAMES[cs.display]}` : 'Lainnya: inline, inline-block, hidden'],
        ],
        onChange: (v, btn) => {
          if (v === 'none') return layoutOff();
          if (v === 'grid') {
            return setStyles(() => ({
              display: 'grid', 'grid-template-columns': 'repeat(2, minmax(0, 1fr))', ...(isFlex ? {} : { gap: '16px' }), // gap auto layout dipertahankan
              'flex-direction': null, 'flex-wrap': null, 'justify-content': null, 'align-items': null,
            }));
          }
          if (v === 'more') return openDisplayMenu(btn, cs.display, (d) => layoutOff(d));
          if (!isFlex) addAutoLayout(refs);
          set('flex-direction', v, { rerender: true });
        },
      });
      row(s, modes);
      if (isFlex) {
        const isRow = mode === 'row';
        const lay = div('al-row');
        const grid = alignGrid(alignmentOf(cs), (h, v) => setStyles((t) => alignmentStyles(t.ownerDocument.defaultView.getComputedStyle(t), h, v)));
        const gapCol = div('al-col');
        gapCol.append(span('mini-label', 'Gap'));
        const spread = cs.justifyContent === 'space-between' ? 'between' : cs.justifyContent === 'space-around' ? 'around' : 'gap';
        // Seperti pen.dev: pilih salah satu — gap tetap (angka), Space Between, atau Space Around.
        // Mengetik angka gap otomatis kembali ke gap tetap.
        const gapRow = div(`radio-line${spread === 'gap' ? '' : ' inactive'}`);
        gapRow.append(radio(spread === 'gap', () => set('justify-content', 'flex-start', { rerender: true })), numberField({
          label: '↔', value: px(gapValue(cs, isRow)), unit: 'px',
          onCommit: (v) => {
            if (spread !== 'gap') return setStyles(() => ({ gap: v, 'justify-content': 'flex-start' }));
            set('gap', v);
          },
          ...tok('gap', 'space'),
        }));
        gapCol.append(gapRow);
        gapCol.append(radioLabel('Space Between', spread === 'between', () => set('justify-content', 'space-between', { rerender: true })));
        gapCol.append(radioLabel('Space Around', spread === 'around', () => set('justify-content', 'space-around', { rerender: true })));
        const alignCol = div('al-col');
        alignCol.append(span('mini-label', 'Alignment'), grid);
        lay.append(alignCol, gapCol);
        s.append(lay);
        if (isRow) {
          row(s, checkField({ label: 'Wrap', checked: cs.flexWrap === 'wrap', title: 'Pindah ke baris baru kalau tidak muat',
            onChange: (on) => set('flex-wrap', on ? 'wrap' : 'nowrap', { rerender: true }) }));
        }
      } else if (isGridBox) {
        // Grid seperti Webflow: jumlah kolom & baris, plus gap.
        const count = (v) => (v && v !== 'none' ? v.trim().split(/\s+/).length : 0);
        const cols = count(cs.gridTemplateColumns);
        const rows = el.style.gridTemplateRows ? count(cs.gridTemplateRows) : 0;
        row(s,
          numberField({ label: 'Kolom', value: cols || 1, onCommit: (_c, n) => {
            if (Number.isInteger(n) && n > 0) set('grid-template-columns', `repeat(${n}, minmax(0, 1fr))`, { rerender: true });
          } }),
          numberField({ label: 'Baris', value: rows || 'Auto', onCommit: (v, n) => {
            if (Number.isInteger(n) && n > 0) set('grid-template-rows', `repeat(${n}, minmax(0, 1fr))`, { rerender: true });
            else set('grid-template-rows', '', { rerender: true }); // kosong / "auto" = baris mengikuti isi
          } }));
        row(s, numberField({ label: 'Gap', value: px(cs.rowGap === 'normal' ? '0px' : cs.rowGap), unit: 'px', onCommit: (v) => set('gap', v), ...tok('gap', 'space') }));
      }
      // Padding (dan margin): satu nilai, atau per sisi lewat tombol ⚙
      sidesField(s, 'Padding', 'padding');
      if (!isRoot) sidesField(s, 'Margin', 'margin');
    }

    // Dimensions + resizing ala pen.dev/Figma (Fixed = angka W/H, Fill / Hug = kotak centang)
    if (!isRoot) {
      if (canLayout) s.append(span('mini-label', 'Dimensions')); // tanpa layout, judul bagiannya sudah "Dimensions"
      const sizeCommit = (axis) => (v) => setStyles((t) => ({ ...(/px$/.test(v) ? fixedSizeCleanup(t, axis) : {}), [axis]: v }), { rerender: false });
      row(s,
        numberField({ label: 'W', value: px(cs.width), unit: 'px', onCommit: sizeCommit('width') }),
        numberField({ label: 'H', value: px(cs.height), unit: 'px', onCommit: sizeCommit('height') }));
      const toggleMode = (axis, mode) => (on) => setStyles((t) => sizeModeStyles(t, axis, on ? mode : 'fixed'));
      const w = sizeModeOf(el, 'width');
      const h = sizeModeOf(el, 'height');
      const checks = div('check-grid');
      checks.append(
        checkField({ label: 'Fill Width', checked: w === 'fill', title: 'Lebar mengisi ruang induk', onChange: toggleMode('width', 'fill') }),
        checkField({ label: 'Fill Height', checked: h === 'fill', title: 'Tinggi mengisi ruang induk', onChange: toggleMode('height', 'fill') }),
        checkField({ label: 'Hug Width', checked: w === 'hug', title: 'Lebar mengikuti isinya', onChange: toggleMode('width', 'hug') }),
        checkField({ label: 'Hug Height', checked: h === 'hug', title: 'Tinggi mengikuti isinya', onChange: toggleMode('height', 'hug') }),
      );
      if (canLayout) {
        const clipped = ['hidden', 'clip'].includes(cs.overflow);
        checks.append(checkField({ label: 'Clip Content', checked: clipped, title: 'Potong isi yang keluar dari kotak/sudut elemen',
          onChange: (on) => set('overflow', on ? 'hidden' : 'visible', { rerender: true }) }));
      }
      s.append(checks);
    }
  }

  // Padding/margin seperti pen.dev: satu nilai untuk semua sisi, vertikal + horizontal (↕ ↔),
  // atau tiap sisi (↑ → ↓ ←). Tombol ⚙ berpindah antar ketiganya.
  function sidesField(s, label, prop) {
    const [top, right, bottom, left] = ['top', 'right', 'bottom', 'left'].map((side) => px(cs.getPropertyValue(`${prop}-${side}`)));
    const auto = top === bottom && left === right ? (top === left ? 1 : 2) : 4; // mode yang cukup untuk nilai sekarang
    const mode = Math.max(sidesMode.get(prop) ?? 1, auto);
    s.append(span('mini-label', label));
    const line = div('prop-row sides-row');
    const field = (lab, value, props, title) => {
      const f = numberField({
        label: lab, value, unit: 'px',
        onCommit: (v) => setStyles(() => Object.fromEntries(props.map((x) => [x, v])), { rerender: false }),
        ...(props.length === 1 ? tok(props[0], 'space') : {}),
      });
      f.title = title;
      return f;
    };
    if (mode === 1) {
      line.append(field('▢', top, [prop], `${label} semua sisi`));
    } else if (mode === 2) {
      line.append(
        field('↕', top, [`${prop}-top`, `${prop}-bottom`], `${label} atas & bawah`),
        field('↔', left, [`${prop}-left`, `${prop}-right`], `${label} kiri & kanan`));
    } else {
      line.append(
        field('↑', top, [`${prop}-top`], `${label} atas`),
        field('→', right, [`${prop}-right`], `${label} kanan`),
        field('↓', bottom, [`${prop}-bottom`], `${label} bawah`),
        field('←', left, [`${prop}-left`], `${label} kiri`));
    }
    const next = mode === 1 ? 2 : mode === 2 ? 4 : 1;
    const gear = button('⚙', () => {
      sidesMode.set(prop, next);
      if (next < auto) {
        // Kembali ke mode lebih sederhana: samakan nilainya dulu (pakai nilai atas / kiri).
        setStyles(() => (next === 1 ? { [prop]: `${top}px` } : {
          [`${prop}-top`]: `${top}px`, [`${prop}-bottom`]: `${top}px`, [`${prop}-left`]: `${left}px`, [`${prop}-right`]: `${left}px`,
        }));
      } else {
        renderProperties();
      }
    }, 'icon-text-btn sides-gear', next === 2 ? 'Atur vertikal & horizontal' : next === 4 ? 'Atur tiap sisi' : 'Satu nilai untuk semua sisi');
    gear.classList.toggle('on', mode > 1);
    line.append(gear);
    s.append(line);
  }

  // ---------- Appearance: opacity & radius ----------
  {
    const s = section('Appearance');
    const opacity = numberField({ label: '%', value: round(Number(cs.opacity) * 100), step: 5, onCommit: (_css, n) => {
      if (Number.isFinite(n)) set('opacity', String(Math.min(100, Math.max(0, n)) / 100));
    } });
    // Blend mode (mix-blend-mode), seperti "Layer blend" di Figma.
    const blend = selectField({
      label: 'Blend', value: cs.mixBlendMode, options: BLEND_MODES,
      onChange: (v) => set('mix-blend-mode', v === 'normal' ? '' : v, { rerender: true }),
    });
    if (tag === 'svg') {
      row(s, opacity);
      row(s, blend);
    } else {
      // Radius. Seperti frame di Figma, isi frame ikut terpotong mengikuti sudutnya (Clip Content
      // otomatis dinyalakan saat radius diberikan ke elemen yang punya isi).
      const autoClip = (t, n) => (!isRoot && n > 0 && t.children.length
        && t.ownerDocument.defaultView.getComputedStyle(t).overflow === 'visible' ? { overflow: 'hidden' } : {});
      const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
      const values = corners.map((c) => px(cs.getPropertyValue(`border-${c}-radius`)));
      const same = values.every((v) => v === values[0]);
      const expanded = sidesOpen.has('radius') || !same;
      const line = div('prop-row sides-row');
      line.append(opacity);
      if (!expanded) {
        line.append(numberField({
          label: '◜', value: values[0], unit: 'px',
          onCommit: (v, n) => setStyles((t) => ({ 'border-radius': v, ...autoClip(t, n) }), { rerender: true }),
          ...tok('border-radius', 'radius'),
        }));
      }
      const toggle = button('⛶', () => {
        if (sidesOpen.has('radius')) sidesOpen.delete('radius'); else sidesOpen.add('radius');
        renderProperties();
      }, 'icon-text-btn sides-gear', expanded ? 'Satu radius untuk semua sudut' : 'Atur tiap sudut');
      toggle.classList.toggle('on', expanded);
      line.append(toggle);
      s.append(line);
      row(s, blend);
      if (expanded) {
        const labels = ['◜', '◝', '◞', '◟'];
        row(s, ...corners.map((c, i) => numberField({
          label: labels[i], value: values[i], unit: 'px',
          onCommit: (v, n) => setStyles((t) => ({ [`border-${c}-radius`]: v, ...autoClip(t, n) }), { rerender: true }),
        })));
      }
    }
  }

  // ---------- Typography: hanya untuk elemen yang punya teks sendiri (seperti pen.dev) ----------
  // Frame & artboard tidak punya Typography; font dasar halaman diatur lewat variabel font.
  if (tag !== 'svg' && !isRoot && hasOwnText(el)) {
    const t = section('Typography');
    if (el.children.length === 0 && targets.length === 1) {
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
        before: (x) => ensureFontInDoc(x.ownerDocument, font),
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

  // ---------- Fill ----------
  if (drawnSvg) {
    if (!lineLike) {
      const has = cs.fill !== 'none';
      const s = section('Fill', has ? null : { label: '+', title: 'Tambah fill', onClick: () => set('fill', '#d9d9d9', { rerender: true }) });
      if (has) row(s, colorField({ value: cs.fill, onCommit: (v) => set('fill', v), ...tok('fill', 'color') }), removeButton('Hapus fill', () => set('fill', 'none', { rerender: true })));
    }
  } else if (tag !== 'svg') {
    const grad = parseGradient(cs.backgroundImage);
    const imageFill = cs.backgroundImage !== 'none' && !grad;
    const colorOn = !!linkedToken(el, 'background-color') || parseCss(cs.backgroundColor).a > 0;
    const has = grad || colorOn || imageFill;
    const s = section('Fill', has ? null : { label: '+', title: 'Tambah fill', onClick: () => set('background-color', '#ffffff', { rerender: true }) });
    if (has) {
      // Seperti Figma/pen.dev: jenis fill (Solid / Linear / Radial) dipilih di dalam color picker.
      let current = grad;
      const fill = {
        ref, // untuk kontrol gradient di kanvas
        kind: grad ? grad.kind : 'solid',
        gradient: grad,
        onKind: (kind, color) => {
          if (kind === 'solid') {
            const first = current?.stops[0]?.color ?? color;
            current = null;
            setStyles(() => ({ 'background-image': null, 'background-color': first }));
            return null;
          }
          const base = current ?? { angle: 180, shape: '', stops: defaultStops(color) };
          current = { ...base, kind };
          setStyles(() => ({ 'background-image': gradientCss(current), 'background-color': null }));
          return structuredClone(current);
        },
        onGradient: (g) => { current = structuredClone(g); set('background-image', gradientCss(g)); },
      };
      row(s, colorField({
        value: grad ? grad.stops[0].color : cs.backgroundColor,
        onCommit: (v) => set('background-color', v),
        fill,
        ...(grad ? {} : tok('background-color', 'color')),
      }), removeButton('Hapus fill', () => setStyles(() => ({ 'background-color': null, 'background-image': null, background: null }))));
    }
  }

  // ---------- Stroke ----------
  if (drawnSvg) {
    const has = cs.stroke !== 'none';
    const s = section('Stroke', has ? null : { label: '+', title: 'Tambah stroke', onClick: () => setStyles(() => ({ stroke: '#111111', 'stroke-width': '1px' })) });
    if (has) {
      // Kepala panah mengikuti "color", jadi untuk garis/panah warna stroke disalin ke sana.
      row(s, colorField({
        value: cs.stroke,
        onCommit: (v) => { set('stroke', v); if (lineLike) set('color', v); },
        linked: linkedToken(el, 'stroke'), tokenGroup: 'color',
        onToken: (v) => { set('stroke', v); if (lineLike) set('color', v); renderProperties(); },
      }), ...(lineLike ? [] : [removeButton('Hapus stroke', () => set('stroke', 'none', { rerender: true }))]));
      row(s, numberField({ label: 'W', value: px(cs.strokeWidth), unit: 'px', step: 0.5, onCommit: (v) => set('stroke-width', v) }));
    }
  } else if (tag !== 'svg') {
    const has = cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0;
    const s = section('Stroke', has ? null : { label: '+', title: 'Tambah stroke', onClick: () => setStyles(() => ({ 'border-width': '1px', 'border-style': 'solid', 'border-color': '#111111' })) });
    if (has) {
      row(s, colorField({ value: cs.borderTopColor, onCommit: (v) => set('border-color', v), ...tok('border-color', 'color') }),
        removeButton('Hapus stroke', () => setStyles(() => ({ border: null, 'border-width': null, 'border-style': null, 'border-color': null }))));
      row(s,
        numberField({ label: 'W', value: px(cs.borderTopWidth), unit: 'px', onCommit: (v) => set('border-width', v) }),
        selectField({ value: cs.borderTopStyle, options: BORDER_STYLES.filter((x) => x !== 'none'), onChange: (v) => set('border-style', v, { rerender: true }) }));
    }
  }

  // ---------- Effects: shadow, blur, dan penyesuaian warna (semua dari CSS) ----------
  renderEffects();
  function renderEffects() {
    const svgMode = drawnSvg; // shape/vector: bayangan mengikuti bentuknya (filter drop-shadow)
    const linkedShadow = linkedToken(el, 'box-shadow');
    const effects = readEffects(cs, svgMode);
    const write = (list, rerender) => setStyles((t) => effectStyles(t, list, svgMode), { rerender });
    // Semua jenis efek, dikelompokkan seperti menu efek di aplikasi desain.
    const kinds = [
      ['Shadow', [['drop', 'Drop shadow'], ...(svgMode ? [] : [['inner', 'Inner shadow']]), ...(hasOwnText(el) ? [['text', 'Text shadow']] : [])]],
      ['Blur', [['layer-blur', 'Layer blur'], ...(svgMode ? [] : [['bg-blur', 'Background blur']])]],
      ['Warna', Object.entries(ADJUSTMENTS).map(([fn, a]) => [`adjust:${fn}`, a.label])],
    ];
    const labels = Object.fromEntries(kinds.flatMap(([, list]) => list));
    // Blur & penyesuaian hanya boleh satu per jenis (satu fungsi CSS); shadow boleh beberapa.
    const single = (key) => key !== 'drop' && key !== 'inner' && key !== 'text';
    const used = new Set(effects.map(effectKey));
    const fx = section('Effects', {
      label: '+', title: 'Tambah efek',
      onClick: (e) => openMenu(e.currentTarget, kinds.map(([group, list]) => [group, list.map(([key, label]) => ({
        value: key, label, disabled: single(key) && used.has(key),
      }))]), (key) => write([...effects, defaultEffect(key)], true)),
    });
    if (linkedShadow) {
      row(fx, textField({ label: 'Shadow', value: cs.boxShadow, onCommit: (v) => set('box-shadow', v, { rerender: true }), ...tok('box-shadow', 'shadow') }));
      return;
    }
    const typeOptions = kinds.flatMap(([, list]) => list);
    effects.forEach((item, i) => {
      const box = div('fx-item');
      fx.append(box);
      const update = (patch) => { Object.assign(item, patch); write(effects, false); };
      const key = effectKey(item);
      row(box, selectField({
        value: key, options: typeOptions.some(([k]) => k === key) ? typeOptions : [[key, labels[key] ?? key], ...typeOptions],
        onChange: (v) => write(effects.map((e, j) => (j === i ? defaultEffect(v) : e)), true),
      }), removeButton('Hapus efek', () => write(effects.filter((_, j) => j !== i), true)));
      const num = (label, prop, min = -Infinity, unit = 'px', max = Infinity) => numberField({
        label, value: round(item[prop]), unit,
        onCommit: (_css, n) => { if (Number.isFinite(n)) update({ [prop]: Math.min(max, Math.max(min, n)) }); },
      });
      if (item.type === 'drop' || item.type === 'inner' || item.type === 'text') {
        row(box, num('X', 'x'), num('Y', 'y'));
        row(box, num('Blur', 'blur', 0), ...(svgMode || item.type === 'text' ? [] : [num('Spread', 'spread')]));
        row(box, colorField({ value: item.color, onCommit: (v) => update({ color: v }) }));
      } else if (item.type === 'adjust') {
        const a = ADJUSTMENTS[item.fn];
        row(box, num(a.unit === '°' ? '°' : '%', 'value', item.fn === 'hue-rotate' ? -360 : 0, '', a.max ?? Infinity));
      } else {
        row(box, num('Blur', 'blur', 0));
      }
    });
    if (!svgMode && !effects.length) {
      const pick = button('◇ Pakai variabel shadow', () => openTokenMenu(pick, 'shadow', (v) => set('box-shadow', v, { rerender: true })), 'small-btn wide');
      row(fx, pick);
    }
  }

  // ---------- Theme: mode variabel (mis. Light/Dark) untuk artboard ----------
  if (isRoot && varData.modes.length > 1) {
    const s = section('Theme');
    const root = el.ownerDocument.documentElement;
    const current = varData.modes.find((m) => varData.slugs[m] === root.getAttribute('data-mode')) ?? varData.modes[0];
    row(s, selectField({
      label: 'Mode', value: current, options: varData.modes,
      onChange: (m) => {
        artboardIds.forEach((id) => captureDoc(id, 'Ganti mode frame'));
        for (const t of targets) {
          const html = t.el.ownerDocument.documentElement;
          if (m === varData.modes[0]) html.removeAttribute('data-mode');
          else html.setAttribute('data-mode', varData.slugs[m]);
        }
        artboardIds.forEach((id) => emit('edit', id));
      },
    }));
  }

  // ---------- Interaksi (prototype sederhana): klik elemen di Preview untuk pindah artboard ----------
  if (!isRoot && targets.length === 1) {
    const ix = section('Interaksi');
    const options = [
      ['', 'Tidak ada'],
      ...state.artboards.filter((a) => a.id !== ref.artboardId).map((a) => [a.id, `Buka "${a.name}"`]),
      ['back', 'Kembali ke frame sebelumnya'],
    ];
    row(ix, selectField({
      label: 'Klik', value: el.getAttribute('data-link') ?? '', options,
      onChange: (v) => {
        captureDoc(ref.artboardId, 'Ubah interaksi');
        if (v) el.setAttribute('data-link', v);
        else el.removeAttribute('data-link');
        emit('edit', ref.artboardId);
        renderProperties();
      },
    }));
  }

  renderCode();
  renderExport();
}

// ---------- Alignment ----------

function renderAlignment() {
  const s = section('Alignment');
  const bar = div('align-bar');
  const enabled = canAlign();
  const multi = state.selected.length >= 3;
  const groups = [['left', 'hcenter', 'right'], ['top', 'vcenter', 'bottom'], ...(multi ? [['dh', 'dv']] : [])];
  for (const modes of groups) {
    const g = div('align-group');
    for (const mode of modes) {
      const btn = document.createElement('button');
      btn.className = 'align-btn';
      btn.title = ALIGN_TITLES[mode];
      btn.innerHTML = `<svg viewBox="0 0 14 14">${ALIGN_ICONS[mode]}</svg>`;
      btn.disabled = !enabled;
      const distribute = mode === 'dh' || mode === 'dv';
      btn.addEventListener('click', () => (distribute ? distributeSelection(mode === 'dh' ? 'h' : 'v') : alignSelection(mode)));
      g.append(btn);
    }
    bar.append(g);
  }
  s.append(bar);
}

// ---------- Code ----------

function renderCode() {
  const s = section('Code');
  const copy = button('Copy HTML', async () => {
    const html = state.selected.map((r) => (r.path.length ? resolve(r)?.outerHTML : resolve(r)?.ownerDocument.documentElement.outerHTML) ?? '').join('\n\n');
    try {
      await navigator.clipboard.writeText(html);
      toast('HTML disalin');
    } catch {
      toast('Gagal menyalin. Pakai "Lihat kode" lalu salin dari sana.');
    }
  }, 'small-btn wide', 'Salin HTML elemen terpilih');
  row(s, copy, button('</> Lihat kode', openCode, 'small-btn wide'));
  row(s, button('Preview responsif', openPreview, 'small-btn wide'));
}

// ---------- Gradient ----------

function defaultStops(bg) {
  const { r, g, b, a } = parseCss(bg);
  const color = a === 0 ? 'rgb(0, 0, 0)' : `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  return [{ color, pos: 0 }, { color: color.replace('rgb(', 'rgba(').replace(')', ', 0)'), pos: 100 }];
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
  // Pixel grid: garis per 1 px desain saat zoom >= 400%
  const grid = isPixelGridOn();
  row(s, toggleButton('Pixel grid', grid, "Garis tiap 1 px desain saat zoom 400% ke atas (Shift + ')", () => {
    setPixelGrid(!grid);
    renderProperties();
  }));
  // Grid baru terlihat di zoom 400%+: beri tahu kalau sedang aktif tapi zoom-nya belum cukup.
  if (grid && state.view.zoom < PIXEL_GRID_MIN_ZOOM) s.append(div('props-hint', `Terlihat setelah zoom ${PIXEL_GRID_MIN_ZOOM * 100}% ke atas`));

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
}

// Instance komponen: isinya mengikuti master, jadi panel hanya menawarkan ke master atau detach.
function renderInstance(comp, ref) {
  const s = section('Komponen · salinan');
  s.append(div('props-hint', `Salinan dari "${comp.name}"`));
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
  for (const [name, width, height] of FRAME_PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'preset';
    btn.append(span('', name), span('preset-size', `${width} × ${height}`));
    btn.addEventListener('click', async () => {
      const created = await createArtboardWithHistory({ name, width, height }, 'Buat frame');
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
function numberField({ label, value, unit = '', step = 1, onCommit, linked, tokenGroup, onToken, disabled = false }) {
  const wrap = div(disabled ? 'field disabled' : 'field');
  const lab = span(disabled ? 'field-label' : 'field-label scrub', label);
  const input = document.createElement('input');
  input.className = 'field-input';
  input.value = value;
  input.spellcheck = false;
  if (disabled) {
    input.disabled = true;
    wrap.append(lab, input);
    return wrap;
  }
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
    scrubbing = true;
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
      scrubbing = false;
      if (renderPending) { renderPending = false; renderProperties(); }
    };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
    lab.addEventListener('pointercancel', up);
  });

  wrap.append(lab, input);
  addTokenButton(wrap, { tokenGroup, onToken });
  return wrap;
}

function colorField({ label, value, onCommit, linked, tokenGroup, onToken, fill }) {
  const { hex, alpha } = parseColor(value);
  const grad = fill?.gradient;
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
  if (grad) {
    // Gradient: kotak menampilkan gradient-nya, teks menyebut jenisnya. Diedit lewat color picker.
    swatch.style.background = `${gradientCss(grad)}, var(--checker)`;
    input.value = grad.kind === 'linear' ? 'Linear' : 'Radial';
    input.readOnly = true;
    input.style.cursor = 'pointer';
    input.addEventListener('click', () => swatch.click());
  }

  swatch.addEventListener('click', () => openColorPicker(swatch, {
    value: grad ? grad.stops[0].color : getComputedColor(swatch),
    fill,
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

function segmented({ value, options, onChange, icons = false }) {
  const wrap = div(icons ? 'segmented icons' : 'segmented');
  for (const [v, text, title] of options) {
    const btn = document.createElement('button');
    if (icons) btn.innerHTML = `<svg viewBox="0 0 14 14">${text}</svg>`;
    else btn.textContent = text;
    if (title) btn.title = title;
    btn.classList.toggle('active', v === value);
    btn.addEventListener('click', () => onChange(v, btn));
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

function textArea({ value, onCommit, placeholder = '' }) {
  const wrap = div('field tall');
  const area = document.createElement('textarea');
  area.className = 'field-input';
  area.value = value;
  area.placeholder = placeholder;
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
    btn.className = action.icon ? 'icon-btn head-icon' : 'icon-text-btn';
    if (action.icon) btn.innerHTML = `<svg viewBox="0 0 14 14">${action.icon}</svg>`;
    else btn.textContent = action.label;
    btn.classList.toggle('on', !!action.on);
    btn.title = action.title;
    btn.addEventListener('click', action.onClick);
    head.append(btn);
  }
  s.append(head);
  panel.append(s);
  return s;
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

// ---------- Kontrol kecil ala pen.dev ----------

function button(label, onClick, className = 'small-btn', title = '') {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  if (title) btn.title = title;
  btn.addEventListener('click', onClick);
  return btn;
}

const removeButton = (title, onClick) => button('−', onClick, 'icon-text-btn remove-btn', title);

function checkField({ label, checked, title = '', onChange, disabled = false }) {
  const wrap = document.createElement('label');
  wrap.className = 'check-field';
  if (title) wrap.title = title;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, span('', label));
  return wrap;
}

function radio(checked, onPick) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.className = 'radio';
  input.checked = checked;
  input.addEventListener('change', () => { if (input.checked) onPick(); });
  return input;
}

function radioLabel(label, checked, onPick) {
  const wrap = document.createElement('label');
  wrap.className = 'check-field';
  wrap.append(radio(checked, onPick), span('', label));
  return wrap;
}

function iconButtons(list) {
  const wrap = div('icon-btns');
  for (const { icon, title, onClick, on } of list) {
    const btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.classList.toggle('on', !!on);
    btn.title = title;
    btn.innerHTML = `<svg viewBox="0 0 14 14">${icon}</svg>`;
    btn.addEventListener('click', onClick);
    wrap.append(btn);
  }
  return wrap;
}

// Bagian yang bisa dilipat (mis. Context). Mengembalikan isi bagian, atau null kalau terlipat.
function collapsible(title, key, defaultOpen) {
  const open = sectionOpen.get(key) ?? defaultOpen;
  const s = div(`prop-section collapsible${open ? '' : ' closed'}`);
  const head = div('prop-title token-title collapse-head');
  head.append(span('', title), span('collapse-caret', open ? '▾' : '▸'));
  head.addEventListener('click', () => { sectionOpen.set(key, !open); renderProperties(); });
  s.append(head);
  panel.append(s);
  return open ? s : null;
}

const gapValue = (cs, isRow) => {
  const g = isRow ? cs.columnGap : cs.rowGap;
  return g === 'normal' ? '0px' : g;
};

// Elemen teks/media tidak punya isi untuk disusun dengan flex layout.
function isTextLike(el) {
  if (['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'CANVAS', 'HR', 'IFRAME'].includes(el.tagName)) return true;
  return el.children.length === 0 && el.textContent.trim() !== '';
}

// Balik (flip) lewat properti CSS "scale": -1 = terbalik.
function flipOf(el, cs = el.ownerDocument.defaultView.getComputedStyle(el)) {
  const v = el.style.scale || cs.scale;
  if (!v || v === 'none') return { x: 1, y: 1 };
  const [x, y = x] = v.split(/\s+/).map(parseFloat);
  return { x: x < 0 ? -1 : 1, y: y < 0 ? -1 : 1 };
}

export function flipSelection(axis) {
  const refs = state.selected.filter((r) => r.path.length);
  if (!refs.length) return;
  const ids = [...new Set(refs.map((r) => r.artboardId))];
  ids.forEach((id) => captureDoc(id, axis === 'x' ? 'Balik horizontal' : 'Balik vertikal'));
  for (const r of refs) {
    const el = resolve(r);
    if (!el || isGroup(el)) continue;
    const f = flipOf(el);
    if (axis === 'x') f.x *= -1; else f.y *= -1;
    if (f.x === 1 && f.y === 1) el.style.removeProperty('scale');
    else el.style.scale = `${f.x} ${f.y}`;
  }
  ids.forEach((id) => emit('edit', id));
  renderProperties();
}

// Menu ⋯ di pilihan layout: display yang jarang dipakai.
const DISPLAY_NAMES = {
  inline: 'Inline: mengalir seperti teks, ukuran & padding atas-bawah tidak berlaku',
  'inline-block': 'Inline-block: berjajar seperti teks, ukuran & padding tetap berlaku',
  none: 'Hidden: elemen disembunyikan (tidak terlihat & tidak memakan tempat)',
};

function openDisplayMenu(anchor, current, onPick) {
  openMenu(anchor, [[null, [['inline', 'Inline'], ['inline-block', 'Inline-block'], ['none', 'Hidden']].map(([value, label]) => ({
    value, label, on: current === value, title: DISPLAY_NAMES[value],
  }))]], onPick);
}

const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'],
  ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['color-burn', 'Color burn'], ['hard-light', 'Hard light'],
  ['soft-light', 'Soft light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'],
  ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];

// Menu kecil di bawah tombol. groups = [[judul | null, [{ value, label, on, disabled, title }]]]
function openMenu(anchor, groups, onPick) {
  document.querySelector('.display-menu')?.remove();
  const menu = div('display-menu');
  for (const [title, items] of groups) {
    if (title) menu.append(span('menu-group', title));
    for (const { value, label, on, disabled, title: tip } of items) {
      const item = button(label, () => { menu.remove(); onPick(value); }, `display-item${on ? ' on' : ''}`, tip ?? '');
      item.disabled = !!disabled;
      menu.append(item);
    }
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
  const close = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    removeEventListener('pointerdown', close, true);
  };
  setTimeout(() => addEventListener('pointerdown', close, true));
}

function row(sectionEl, ...fields) {
  const r = div('prop-row');
  r.append(...fields);
  sectionEl.append(r);
}

// Label jenis elemen di judul panel: "auto layout" / "frame" untuk wadah, selain itu nama tag.
function kindLabel(el, cs, tag) {
  if (cs.display.includes('flex')) return `auto layout ${cs.flexDirection.startsWith('row') ? '→' : '↓'}`;
  if (cs.display.includes('grid')) return 'grid';
  if (tag === 'div' && el.children.length) return 'frame';
  if (tag === 'div' && el.classList.contains('frame')) return 'frame';
  return tag;
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
