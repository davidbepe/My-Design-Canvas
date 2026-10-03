// Definisi tool MCP yang bisa dipanggil Claude. zod memvalidasi setiap input.
import { z } from 'zod';
import * as store from './store.js';
import { screenshotArtboard, queryArtboard } from './renderer.js';
import { readTokens, writeTokens, TOKEN_NAME } from './tokens.js';
import { searchIcons, iconSvg } from './icons.js';
import { GOOGLE_FONTS } from './fonts.js';
import { listVersions, saveVersion, restoreVersion } from './versions.js';

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const json = (obj) => text(JSON.stringify(obj, null, 2));

// Bungkus handler supaya error tampil rapi ke Claude, bukan bikin server crash.
const safe = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (err) {
    return { ...text(`Error: ${err.message}`), isError: true };
  }
};

const size = z.number().int().min(1).max(10000);

// Panduan yang ikut di deskripsi tool penulis HTML, supaya desain Claude konsisten dengan sistem desain user.
const HTML_GUIDE =
  'Setiap artboard otomatis ter-link ke designs/tokens.css: pakai design tokens lewat var(--nama) ' +
  '(mis. var(--color-primary), var(--space-4), var(--radius-md), var(--text-base)); lihat get_tokens. ' +
  'Gambar yang diunggah user ada di "assets/..." (path relatif). Untuk ikon, pakai get_icons lalu tempel SVG-nya inline. ' +
  'Komponen: elemen ber-atribut data-component-role="master" adalah master; elemen dengan data-component yang sama ' +
  'dan data-component-role="instance" adalah salinannya dan disinkronkan otomatis oleh editor dari master. ' +
  'Untuk mengubah semua salinan, ubah master-nya; jangan mengedit isi instance. ' +
  `Google Fonts yang tersedia: ${GOOGLE_FONTS.map((f) => f[0]).join(', ')}. Cara termudah: set token font-* ` +
  '(mis. set_tokens {"font-sans": "\\"Inter\\", sans-serif"}), font-nya otomatis dimuat.';

export function registerTools(server, { canvasUrl }) {
  server.registerTool(
    'list_artboards',
    {
      description: 'Daftar semua artboard di kanvas (id, nama, ukuran, posisi).',
      inputSchema: {},
    },
    safe(async () => json({ canvas: canvasUrl, artboards: await store.listArtboards() })),
  );

  server.registerTool(
    'create_artboard',
    {
      description:
        'Buat artboard baru di kanvas. Contoh ukuran: 390x844 (mobile), 1440x900 (desktop). ' +
        `html boleh berupa dokumen lengkap atau potongan isi <body>. ${HTML_GUIDE}`,
      inputSchema: {
        name: z.string().min(1).describe('Nama artboard, mis. "Home - Mobile"'),
        width: size.describe('Lebar dalam px'),
        height: size.describe('Tinggi dalam px'),
        html: z.string().optional().describe('Isi awal (opsional)'),
      },
    },
    safe(async (args) => {
      const artboard = await store.createArtboard(args);
      return json({ created: artboard, canvas: canvasUrl });
    }),
  );

  server.registerTool(
    'write_html',
    {
      description:
        'Ganti seluruh isi artboard dengan HTML/CSS baru (dokumen lengkap atau potongan isi <body>). ' +
        `Kanvas langsung ter-update, dan user bisa membatalkannya dengan Ctrl+Z. Opsional: ubah width/height. ${HTML_GUIDE}`,
      inputSchema: {
        id: z.string().describe('Id artboard'),
        html: z.string().describe('HTML baru'),
        width: size.optional(),
        height: size.optional(),
      },
    },
    safe(async ({ id, ...rest }) => json({ updated: await store.writeArtboardHtml(id, rest) })),
  );

  server.registerTool(
    'get_dom',
    {
      description:
        'Baca HTML artboard. Tanpa selector: seluruh file. Dengan selector CSS: hanya elemen yang cocok, ' +
        'beserta posisi & ukuran hasil render (box).',
      inputSchema: {
        id: z.string().describe('Id artboard'),
        selector: z.string().optional().describe('Selector CSS, mis. ".header" atau "button"'),
      },
    },
    safe(async ({ id, selector }) => {
      if (!selector) return text(await store.readArtboardHtml(id));
      const matches = await queryArtboard(await store.getArtboard(id), selector);
      return matches.length ? json(matches) : text(`Tidak ada elemen yang cocok dengan "${selector}".`);
    }),
  );

  server.registerTool(
    'get_selection',
    {
      description:
        'Elemen yang sedang dipilih user di kanvas (bisa lebih dari satu): artboard, selector CSS, teks, posisi, ' +
        'dan HTML-nya. Pakai ini saat user bilang "ini", "elemen ini", atau "yang kupilih". ' +
        'Catatan: editan user dari panel properti tersimpan sebagai inline style.',
      inputSchema: {},
    },
    safe(async () => {
      let res;
      try {
        res = await fetch(`${canvasUrl}/api/selection`);
      } catch {
        throw new Error(`Kanvas tidak bisa dihubungi. Pastikan ${canvasUrl} terbuka di browser.`);
      }
      const { selection } = await res.json();
      if (!selection?.length) return text('Tidak ada elemen yang dipilih di kanvas.');
      return json(selection.length === 1 ? selection[0] : { count: selection.length, items: selection });
    }),
  );

  server.registerTool(
    'screenshot',
    {
      description:
        'Ambil gambar PNG dari artboard persis seperti dirender browser, untuk mengecek hasil visual. ' +
        'Isi selector untuk memotret satu elemen saja.',
      inputSchema: {
        id: z.string().describe('Id artboard'),
        scale: z.number().min(0.25).max(3).optional().describe('Skala piksel, default 1 (2 = retina)'),
        selector: z.string().optional().describe('Selector CSS elemen yang dipotret (opsional)'),
      },
    },
    safe(async ({ id, scale, selector }) => {
      const data = await screenshotArtboard(await store.getArtboard(id), scale ?? 1, { selector });
      return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
    }),
  );

  server.registerTool(
    'get_tokens',
    {
      description:
        'Daftar design tokens dari designs/tokens.css (nama → nilai). Pakai di HTML sebagai var(--nama). ' +
        'Grup dari awalan nama: color-, font- (keluarga font), text- (ukuran teks), space-, radius-, shadow-.',
      inputSchema: {},
    },
    safe(async () => json(await readTokens())),
  );

  server.registerTool(
    'set_tokens',
    {
      description:
        'Tambah, ubah, atau hapus design tokens. Semua artboard yang memakai token itu langsung ikut berubah. ' +
        'Kirim hanya token yang berubah; nilai null = hapus token.',
      inputSchema: {
        tokens: z.record(
          z.string().regex(TOKEN_NAME, 'Nama token: huruf kecil, angka, dan tanda hubung, mis. color-primary'),
          z.string().regex(/^[^;{}]+$/, 'Nilai token tidak boleh mengandung ; { }').nullable(),
        ).describe('Mis. {"color-primary": "#4f46e5", "space-5": "20px", "color-old": null}'),
      },
    },
    safe(async ({ tokens: changes }) => {
      const tokens = await readTokens();
      for (const [name, value] of Object.entries(changes)) {
        if (value === null) delete tokens[name];
        else tokens[name] = value.trim();
      }
      await writeTokens(tokens);
      return json(tokens);
    }),
  );

  server.registerTool(
    'save_version',
    {
      description:
        'Simpan snapshot bernama dari semua artboard + design tokens. Sebaiknya dipanggil sebelum perubahan besar, ' +
        'supaya user bisa kembali ke kondisi sebelumnya dari tab "Versi" di editor.',
      inputSchema: { name: z.string().max(120).describe('Nama versi, mis. "Sebelum redesign halaman login"') },
    },
    safe(async ({ name }) => json(await saveVersion(name))),
  );

  server.registerTool(
    'list_versions',
    { description: 'Daftar versi tersimpan (terbaru dulu).', inputSchema: {} },
    safe(async () => json(await listVersions())),
  );

  server.registerTool(
    'restore_version',
    {
      description:
        'Pulihkan semua artboard + tokens ke versi tertentu. Kondisi saat ini otomatis disimpan dulu sebagai versi baru. ' +
        'Hanya lakukan kalau user memintanya.',
      inputSchema: { id: z.string().describe('Id versi dari list_versions') },
    },
    safe(async ({ id }) => json(await restoreVersion(id))),
  );

  server.registerTool(
    'get_icons',
    {
      description:
        'Cari ikon dari pustaka Lucide (±2.000 ikon, gaya garis). Mengembalikan SVG siap tempel inline; ' +
        'warnanya mengikuti CSS color (currentColor), ukuran lewat width/height.',
      inputSchema: {
        query: z.string().describe('Kata kunci bahasa Inggris, mis. "home", "search", "arrow", "user"'),
        limit: z.number().int().min(1).max(30).optional().describe('Jumlah hasil, default 8'),
      },
    },
    safe(async ({ query, limit }) => {
      const names = await searchIcons(query, limit ?? 8);
      if (!names.length) return text(`Tidak ada ikon untuk "${query}".`);
      return json(await Promise.all(names.map(async (name) => ({ name, svg: await iconSvg(name) }))));
    }),
  );
}
