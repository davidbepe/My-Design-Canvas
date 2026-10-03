// Browser headless (Microsoft Edge lewat puppeteer-core) untuk screenshot dan get_dom.
// Browser dinyalakan sekali saat pertama dibutuhkan, lalu dipakai ulang supaya cepat.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { artboardPath } from './store.js';

const BROWSER_CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    const executablePath = BROWSER_CANDIDATES.find((p) => fs.existsSync(p));
    if (!executablePath) {
      throw new Error('Edge/Chrome tidak ditemukan. Set environment variable BROWSER_PATH ke lokasi msedge.exe.');
    }
    browserPromise = puppeteer.launch({ executablePath, headless: true }).then((browser) => {
      browser.on('disconnected', () => { browserPromise = null; });
      return browser;
    });
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

async function withArtboardPage(artboard, scale, fn) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: artboard.width, height: artboard.height, deviceScaleFactor: scale });
    // Tunggu sampai jaringan tenang supaya font/gambar eksternal sudah termuat.
    await page.goto(pathToFileURL(artboardPath(artboard)).href, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await page.close();
  }
}

// Gambar PNG artboard, atau satu elemen saja kalau selector diisi (latar elemen transparan).
// encoding: 'base64' (untuk Claude) atau 'binary' (untuk file ekspor).
export async function screenshotArtboard(artboard, scale = 1, { selector, encoding = 'base64' } = {}) {
  return withArtboardPage(artboard, scale, async (page) => {
    if (!selector) return page.screenshot({ type: 'png', encoding });
    const el = await page.$(selector);
    if (!el) throw new Error(`Tidak ada elemen yang cocok dengan "${selector}".`);
    return el.screenshot({ type: 'png', encoding, omitBackground: true });
  });
}

// Ambil elemen yang cocok dengan selector, lengkap dengan posisi & ukurannya
// sesuai hasil render browser (berguna untuk cek layout).
export async function queryArtboard(artboard, selector) {
  return withArtboardPage(artboard, 1, (page) =>
    page.$$eval(selector, (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          html: el.outerHTML,
        };
      }),
    ),
  );
}

export async function closeBrowser() {
  if (browserPromise) (await browserPromise).close().catch(() => {});
}
