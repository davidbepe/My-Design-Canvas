// Design Canvas Capture: dijalankan di halaman web (disuntikkan oleh background.js).
//
// Mode pilih elemen: elemen di bawah kursor disorot; klik = tangkap, ↑ = pilih induknya, Esc = batal.
// Hasil tangkapan = HTML dengan gaya hasil hitungan browser ditulis langsung di tiap elemen (inline),
// jadi tampilannya sama walaupun CSS situs aslinya tidak ikut. Script, class, dan id situs dibuang.
(() => {
  if (window.__designCanvasCapture) return;
  window.__designCanvasCapture = true;

  // ---------- Pesan dari background ----------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'dc-pick') startPicker(msg.mode);
    if (msg.type === 'dc-page') finish(document.body, msg.mode);
    if (msg.type === 'dc-toast') toast(msg.text, msg.error);
  });

  // ---------- Pemilih elemen ----------

  let picker = null;

  function startPicker(mode) {
    stopPicker();
    const box = document.createElement('div');
    const label = document.createElement('div');
    const bar = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #0d99ff;background:rgba(13,153,255,.12);border-radius:2px;transition:all .05s';
    label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;padding:2px 6px;border-radius:3px;background:#0d99ff;color:#fff;font:600 11px/1.6 system-ui,sans-serif';
    bar.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:#1e1e1e;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:none';
    bar.textContent = 'Klik bagian yang mau ditangkap · ↑ pilih induknya · Esc batal';
    document.documentElement.append(box, label, bar);
    picker = { mode, box, label, bar, target: null };

    const show = (el) => {
      picker.target = el;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      label.textContent = `${el.tagName.toLowerCase()} · ${Math.round(r.width)} × ${Math.round(r.height)}`;
      Object.assign(label.style, { left: `${Math.max(0, r.left)}px`, top: `${Math.max(0, r.top - 22)}px` });
    };
    picker.onMove = (e) => {
      picker.mouse = { x: e.clientX, y: e.clientY };
      // Setelah ↑ memilih induk, gerakan kecil (mis. saat mengklik) tidak mengembalikan sorotan.
      if (picker.lock) {
        if (Math.hypot(e.clientX - picker.lock.x, e.clientY - picker.lock.y) < 8) return;
        picker.lock = null;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== picker.target && ![box, label, bar].includes(el)) show(el);
    };
    picker.onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const el = picker.target;
      stopPicker();
      if (el) finish(el, mode);
    };
    picker.onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); stopPicker(); }
      if (e.key === 'ArrowUp' && picker.target?.parentElement && picker.target.parentElement !== document.documentElement) {
        e.preventDefault();
        show(picker.target.parentElement);
        if (picker.mouse) picker.lock = { ...picker.mouse };
      }
    };
    // Klik di halaman jangan sampai menjalankan link/tombol situsnya.
    picker.block = (e) => { e.preventDefault(); e.stopPropagation(); };
    addEventListener('mousemove', picker.onMove, true);
    addEventListener('click', picker.onClick, true);
    addEventListener('mousedown', picker.block, true);
    addEventListener('mouseup', picker.block, true);
    addEventListener('keydown', picker.onKey, true);
  }

  function stopPicker() {
    if (!picker) return;
    removeEventListener('mousemove', picker.onMove, true);
    removeEventListener('click', picker.onClick, true);
    removeEventListener('mousedown', picker.block, true);
    removeEventListener('mouseup', picker.block, true);
    removeEventListener('keydown', picker.onKey, true);
    picker.box.remove();
    picker.label.remove();
    picker.bar.remove();
    picker = null;
  }

  // ---------- Selesai: salin atau kirim ----------

  async function finish(el, mode) {
    let result;
    try {
      result = captureElement(el);
    } catch (err) {
      return toast(`Gagal menangkap: ${err.message}`, true);
    }
    if (mode === 'copy') {
      const ok = await copyText(result.html);
      toast(ok ? 'Disalin. Pilih frame di Design Canvas lalu tekan Ctrl+V.' : 'Gagal menyalin ke clipboard.', !ok);
    } else {
      toast('Mengirim ke Design Canvas…');
      chrome.runtime.sendMessage({ type: 'dc-send', ...result });
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Cadangan untuk halaman yang memblokir Clipboard API.
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.documentElement.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    }
  }

  function toast(text, error = false) {
    document.getElementById('__dc-toast')?.remove();
    const t = document.createElement('div');
    t.id = '__dc-toast';
    t.textContent = text;
    t.style.cssText = `position:fixed;z-index:2147483647;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:${error ? '#b42318' : '#1e1e1e'};color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)`;
    document.documentElement.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- Penangkap ----------

  // Properti yang menentukan tampilan. Yang nilainya sama dengan bawaan browser tidak ditulis.
  const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'box-sizing',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-content', 'align-self',
    'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'row-gap', 'column-gap',
    'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
    'overflow-x', 'overflow-y',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat', 'background-clip',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'outline-width', 'outline-style', 'outline-color', 'outline-offset',
    'box-shadow', 'opacity', 'filter', 'backdrop-filter', 'mix-blend-mode', 'transform', 'transform-origin',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-transform', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
    'text-shadow', 'text-overflow', 'white-space', 'word-break', 'overflow-wrap', 'vertical-align',
    'list-style-type', 'list-style-position', 'object-fit', 'object-position', 'aspect-ratio', 'visibility',
    '-webkit-line-clamp', '-webkit-box-orient', 'fill', 'stroke',
  ];
  // Properti yang diwariskan ke anak: cukup ditulis kalau berbeda dari induknya.
  const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align',
    'text-transform', 'text-shadow', 'white-space', 'word-break', 'overflow-wrap', 'visibility', 'list-style-type',
    'list-style-position', 'fill', 'stroke',
  ]);
  const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'head', 'title', 'base']);
  const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'type', 'placeholder', 'aria-label', 'role', 'colspan', 'rowspan', 'for', 'name', 'value', 'checked', 'disabled', 'selected', 'width', 'height']);
  const VOID_TEXT = new Set(['img', 'input', 'br', 'hr']);

  // Nilai bawaan browser per tag (diukur di iframe kosong), untuk membuang properti yang tidak perlu.
  let sandbox = null;
  const defaults = new Map();
  function defaultsFor(tag) {
    if (defaults.has(tag)) return defaults.get(tag);
    if (!sandbox) {
      sandbox = document.createElement('iframe');
      sandbox.style.cssText = 'position:fixed;left:-9999px;top:0;width:100px;height:100px;border:0;visibility:hidden';
      document.documentElement.append(sandbox);
    }
    const doc = sandbox.contentDocument;
    const el = doc.createElement(/^[a-z][a-z0-9]*$/.test(tag) ? tag : 'div');
    // Link baru bergaya link (biru, bergaris bawah) kalau punya alamat: ukur yang punya alamat.
    if (tag === 'a') el.setAttribute('href', '#');
    doc.body.append(el);
    const cs = sandbox.contentWindow.getComputedStyle(el);
    const values = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
    el.remove();
    defaults.set(tag, values);
    return values;
  }

  const abs = (url) => { try { return new URL(url, location.href).href; } catch { return url; } };

  function styleFor(source, cs, parentCs, tag, isRoot, overrides = {}) {
    const def = defaultsFor(tag);
    const out = [];
    for (const prop of PROPS) {
      let value = cs.getPropertyValue(prop);
      if (!value) continue;
      if (INHERITED.has(prop) && !isRoot && parentCs && parentCs.getPropertyValue(prop) === value) continue;
      // Lebar/tinggi & box-sizing selalu ditulis: frame di kanvas memakai box-sizing: border-box,
      // jadi tanpa ini ukuran elemen yang aslinya content-box akan menyusut.
      const always = prop === 'width' || prop === 'height' || prop === 'box-sizing';
      if (!INHERITED.has(prop) && value === def[prop] && !always) continue;
      if (INHERITED.has(prop) && isRoot && value === def[prop] && prop !== 'font-family' && prop !== 'color') continue;
      // Ukuran: inline (teks mengalir) tidak punya lebar/tinggi; lainnya pakai ukuran asli.
      if ((prop === 'width' || prop === 'height') && cs.display === 'inline') continue;
      if (prop === 'position' && value === 'fixed') value = 'absolute';
      if (prop === 'position' && value === 'sticky') value = 'relative';
      out.push(`${prop}: ${value}`);
    }
    for (const [prop, value] of Object.entries(overrides)) {
      const i = out.findIndex((d) => d.startsWith(`${prop}:`));
      if (i >= 0) out.splice(i, 1);
      if (value != null) out.push(`${prop}: ${value}`);
    }
    return out.join('; ');
  }

  // ::before / ::after yang punya isi (mis. ikon, garis hias) diubah jadi <span>.
  function pseudo(source, which, parentCs) {
    const cs = getComputedStyle(source, which);
    const content = cs.content;
    if (!content || content === 'none' || content === 'normal') return null;
    const span = document.createElement('span');
    const text = content.match(/^"(.*)"$/s)?.[1] ?? '';
    if (text) span.textContent = text.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    const style = styleFor(source, cs, parentCs, 'span', false);
    if (style) span.setAttribute('style', style);
    return span;
  }

  // Ikon <use href="#id"> menunjuk simbol di tempat lain di halaman: salin isinya ke dalam svg.
  function inlineSvg(svg, cs) {
    const clone = svg.cloneNode(true);
    for (const use of clone.querySelectorAll('use')) {
      const ref = use.getAttribute('href') || use.getAttribute('xlink:href') || '';
      if (!ref.startsWith('#')) continue;
      const target = document.getElementById(ref.slice(1));
      if (!target) continue;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      for (const child of target.childNodes) g.append(child.cloneNode(true));
      if (target.getAttribute('viewBox') && !clone.getAttribute('viewBox')) clone.setAttribute('viewBox', target.getAttribute('viewBox'));
      use.replaceWith(g);
    }
    const r = svg.getBoundingClientRect();
    clone.removeAttribute('class');
    clone.setAttribute('width', Math.round(r.width));
    clone.setAttribute('height', Math.round(r.height));
    const keep = ['color', 'fill', 'stroke', 'stroke-width', 'opacity', 'display', 'vertical-align', 'flex-shrink', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
    clone.setAttribute('style', keep.map((p) => `${p}: ${cs.getPropertyValue(p)}`).join('; '));
    return clone;
  }

  function build(node, parentCs, isRoot) {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag) || node.id === '__dc-toast') return null;
    const cs = getComputedStyle(node);
    if (cs.display === 'none') return null;
    if (tag === 'svg') return inlineSvg(node, cs);

    // Elemen khusus (custom element, iframe, video, canvas) disederhanakan.
    let outTag = /^[a-z][a-z0-9]*$/.test(tag) ? tag : 'div';
    if (['iframe', 'object', 'embed'].includes(tag)) outTag = 'div';
    if (tag === 'body' || tag === 'html') outTag = 'div';
    let el;
    if (tag === 'canvas') {
      el = document.createElement('img');
      try { el.src = node.toDataURL(); } catch { el = document.createElement('div'); }
    } else if (tag === 'video') {
      el = document.createElement(node.poster ? 'img' : 'div');
      if (node.poster) el.src = abs(node.poster);
    } else {
      el = document.createElement(outTag);
    }

    for (const { name, value } of node.attributes) {
      if (!KEEP_ATTRS.has(name) || el.tagName !== node.tagName) continue;
      el.setAttribute(name, name === 'href' || name === 'src' ? abs(value) : value);
    }
    if (tag === 'img') {
      el.setAttribute('src', node.currentSrc || abs(node.getAttribute('src') || ''));
      el.removeAttribute('srcset');
    }
    if (tag === 'input') el.setAttribute('value', node.value);
    if (tag === 'a') el.setAttribute('href', node.href || '#');

    const overrides = isRoot ? { position: 'relative', top: null, left: null, right: null, bottom: null, 'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px' } : {};
    if (isRoot) {
      // Lebar & tinggi asli bagian yang ditangkap; untuk seluruh halaman, tinggi mengikuti isi.
      const r = node.getBoundingClientRect();
      overrides.width = `${Math.round(r.width)}px`;
      overrides.height = tag === 'body' ? null : `${Math.round(r.height)}px`;
      if (tag === 'body') overrides['min-height'] = `${Math.round(document.documentElement.scrollHeight)}px`;
    }
    const style = styleFor(node, cs, parentCs, tag, isRoot, overrides);
    if (style) el.setAttribute('style', style);

    if (tag === 'textarea') { el.textContent = node.value; return el; }
    if (VOID_TEXT.has(tag) || tag === 'canvas' || tag === 'video' || tag === 'iframe') return el;

    const before = pseudo(node, '::before', cs);
    if (before) el.append(before);
    for (const child of node.childNodes) {
      const c = build(child, cs, false);
      if (c) el.append(c);
    }
    const after = pseudo(node, '::after', cs);
    if (after) el.append(after);
    return el;
  }

  // @font-face situs untuk font yang dipakai (dari stylesheet yang boleh dibaca), alamatnya dibuat lengkap.
  function fontFaces(root) {
    const used = new Set();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const f of getComputedStyle(el).fontFamily.split(',')) used.add(f.trim().replace(/^["']|["']$/g, '').toLowerCase());
    }
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; } // stylesheet lintas domain tidak bisa dibaca
      const base = sheet.href || location.href;
      for (const rule of list) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '').toLowerCase();
        if (!used.has(family)) continue;
        rules.push(rule.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, (_, q, url) => `url("${new URL(url, base).href}")`));
      }
    }
    return rules;
  }

  function captureElement(source) {
    const parentCs = source.parentElement ? getComputedStyle(source.parentElement) : null;
    const root = build(source, parentCs, true);
    if (!root) throw new Error('bagian ini tidak terlihat');
    sandbox?.remove();
    sandbox = null;
    defaults.clear();
    const faces = fontFaces(source);
    const rect = source.getBoundingClientRect();
    const height = source === document.body ? document.documentElement.scrollHeight : rect.height;
    const html = `${faces.length ? `<style>${faces.join('\n')}</style>\n` : ''}${root.outerHTML}`;
    const what = source === document.body ? 'Halaman' : source.tagName.toLowerCase();
    return {
      html,
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(height)),
      name: `${document.title || location.hostname} · ${what}`.slice(0, 80),
    };
  }

  // Untuk pengujian otomatis.
  window.__designCanvasCaptureElement = captureElement;
})();
