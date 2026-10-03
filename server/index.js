// Titik masuk: menyalakan server MCP (stdio), server web kanvas, dan WebSocket.
// PENTING: di mode stdio, stdout dipakai untuk komunikasi MCP, jadi semua log ke console.error.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  DESIGNS_DIR, MANIFEST_FILE, ensureDesignsDir, listArtboards, getArtboard, createArtboard, updateArtboard,
  deleteArtboard, writeArtboardHtml, prepareHtml, saveAsset, linkTokensInAllArtboards,
} from './store.js';
import { registerTools } from './mcp-tools.js';
import { closeBrowser, screenshotArtboard } from './renderer.js';
import { TOKENS_FILE, TOKEN_NAME, GROUPS, ensureTokens, readTokens, writeTokens } from './tokens.js';
import { searchIcons, iconSvg } from './icons.js';
import { GOOGLE_FONTS } from './fonts.js';
import { listVersions, saveVersion, restoreVersion, deleteVersion } from './versions.js';

const PORT = Number(process.env.PORT) || 3333;
const CANVAS_URL = `http://localhost:${PORT}`;
const CANVAS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'canvas');

await ensureDesignsDir();
await ensureTokens();
await linkTokensInAllArtboards();

// HTML terakhir yang disimpan editor per file. Dipakai supaya simpanan editor sendiri
// tidak memicu reload kanvas (yang akan membuat seleksi berkedip).
const editorWrites = new Map();
// Elemen yang sedang dipilih di kanvas, dikirim browser lewat WebSocket.
let currentSelection = null;

// ---------- Server web + WebSocket ----------
const app = express();
const noCache = (res) => res.set('Cache-Control', 'no-store');
app.use(express.static(CANVAS_DIR, { setHeaders: noCache }));
app.use('/designs', express.static(DESIGNS_DIR, { setHeaders: noCache }));

app.get('/api/artboards', async (_req, res) => res.json({ artboards: await listArtboards() }));

const ArtboardPatch = z.object({
  name: z.string().min(1).optional(),
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});
app.patch('/api/artboards/:id', express.json(), async (req, res) => {
  res.json(await updateArtboard(req.params.id, ArtboardPatch.parse(req.body)));
});

const ArtboardCreate = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).optional(),
  name: z.string().min(1),
  width: z.number().int().min(1).max(10000),
  height: z.number().int().min(1).max(10000),
  x: z.number().optional(),
  y: z.number().optional(),
  html: z.string().optional(),
});
app.post('/api/artboards', express.json({ limit: '20mb' }), async (req, res) => {
  res.json(await createArtboard(ArtboardCreate.parse(req.body)));
});

app.delete('/api/artboards/:id', async (req, res) => {
  res.json(await deleteArtboard(req.params.id));
});

app.put('/api/artboards/:id/html', express.text({ type: '*/*', limit: '20mb' }), async (req, res) => {
  const artboard = await getArtboard(req.params.id);
  editorWrites.set(artboard.file, prepareHtml(req.body, artboard.name));
  await writeArtboardHtml(artboard.id, { html: req.body });
  res.json({ ok: true });
});

app.get('/api/selection', (_req, res) => res.json({ selection: currentSelection }));

// Ekspor PNG artboard atau satu elemen (selector), dirender oleh Edge headless.
app.get('/api/export', async (req, res) => {
  const artboard = await getArtboard(String(req.query.id));
  const scale = Math.min(4, Math.max(0.25, Number(req.query.scale) || 1));
  const selector = req.query.selector ? String(req.query.selector) : undefined;
  const png = await screenshotArtboard(artboard, scale, { selector, encoding: 'binary' });
  res.type('png').send(Buffer.from(png));
});

// Unggah gambar (drag-drop / paste) ke designs/assets/.
app.post('/api/assets', express.raw({ type: 'image/*', limit: '25mb' }), async (req, res) => {
  const name = decodeURIComponent(req.get('X-Filename') ?? 'gambar');
  res.json({ src: await saveAsset(req.body, req.get('Content-Type'), name) });
});

app.get('/api/icons', async (req, res) => {
  const limit = Math.min(300, Number(req.query.limit) || 120);
  const names = await searchIcons(String(req.query.q ?? ''), limit);
  res.json({ icons: await Promise.all(names.map(async (name) => ({ name, svg: await iconSvg(name) }))) });
});

app.get('/api/fonts', (_req, res) => res.json({ fonts: GOOGLE_FONTS }));

app.get('/api/versions', async (_req, res) => res.json({ versions: await listVersions() }));
app.post('/api/versions', express.json(), async (req, res) => {
  res.json(await saveVersion(z.object({ name: z.string().max(120).optional() }).parse(req.body).name));
});
app.post('/api/versions/:id/restore', async (req, res) => res.json(await restoreVersion(req.params.id)));
app.delete('/api/versions/:id', async (req, res) => {
  await deleteVersion(req.params.id);
  res.json({ ok: true });
});

app.get('/api/tokens', async (_req, res) => res.json({ tokens: await readTokens(), groups: GROUPS }));

const TokensBody = z.object({
  tokens: z.record(z.string().regex(TOKEN_NAME), z.string().regex(/^[^;{}]+$/)),
});
app.put('/api/tokens', express.json(), async (req, res) => {
  await writeTokens(TokensBody.parse(req.body).tokens);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => res.status(400).json({ error: err.message }));

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });
// Error "port sudah dipakai" juga diteruskan ke sini. Sudah ditangani di httpServer di bawah,
// jadi cukup diabaikan supaya proses tidak crash.
wss.on('error', () => {});

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'selection') currentSelection = msg.selection ?? null;
    } catch {}
  });
  socket.on('close', () => { if (wss.clients.size === 0) currentSelection = null; });
});

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    // Sesi Claude lain sudah menjalankan kanvas. Tidak masalah: kita tetap menulis
    // ke folder designs/ yang sama, dan kanvas di sesi itu akan menangkap perubahannya.
    console.error(`[canvas] Port ${PORT} sudah dipakai, kanvas dijalankan oleh proses lain.`);
  } else {
    console.error('[canvas] Error server web:', err);
  }
});

httpServer.listen(PORT, () => {
  console.error(`[canvas] Kanvas berjalan di ${CANVAS_URL}`);
  watchDesigns();
});

// Pantau folder designs/: setiap file berubah (oleh Claude atau diedit manual),
// beri tahu kanvas lewat WebSocket.
function watchDesigns() {
  const timers = new Map();
  fs.watch(DESIGNS_DIR, (_event, filename) => {
    if (!filename || filename.endsWith('.tmp')) return;
    clearTimeout(timers.get(filename));
    timers.set(filename, setTimeout(async () => {
      timers.delete(filename);
      if (filename === MANIFEST_FILE) {
        broadcast({ type: 'manifest', artboards: await listArtboards() });
      } else if (filename === TOKENS_FILE) {
        broadcast({ type: 'tokens', version: Date.now() });
      } else if (filename.endsWith('.html')) {
        const artboard = (await listArtboards()).find((a) => a.file === filename);
        if (!artboard) return;
        const content = await fs.promises.readFile(path.join(DESIGNS_DIR, filename), 'utf8').catch(() => null);
        if (content !== null && content === editorWrites.get(filename)) return; // simpanan editor sendiri
        editorWrites.delete(filename);
        broadcast({ type: 'reload', id: artboard.id, version: Date.now() });
      }
    }, 60));
  });
}

// ---------- Server MCP ----------
const mcp = new McpServer({ name: 'design-canvas', version: '0.2.0' });
registerTools(mcp, { canvasUrl: CANVAS_URL });
await mcp.connect(new StdioServerTransport());
console.error('[mcp] Server MCP siap.');

const shutdown = async () => {
  await closeBrowser();
  process.exit(0);
};
process.stdin.on('close', shutdown); // Claude menutup sesi
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
