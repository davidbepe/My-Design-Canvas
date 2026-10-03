// Design tokens: satu file designs/tokens.css berisi variabel CSS (warna, font, spacing, dst.)
// yang otomatis di-link ke setiap artboard. File CSS ini satu-satunya sumber kebenaran,
// jadi bisa diedit dari editor, oleh Claude, atau manual.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DESIGNS_DIR } from './store.js';
import { googleFontsUrl, primaryFamily, isGoogleFont } from './fonts.js';

export const TOKENS_FILE = 'tokens.css';
const TOKENS_PATH = path.join(DESIGNS_DIR, TOKENS_FILE);

// Grup ditentukan dari awalan nama token, mis. --color-primary masuk grup "color".
export const GROUPS = [
  ['color', 'Warna'],
  ['font', 'Font'],
  ['text', 'Ukuran teks'],
  ['space', 'Spacing'],
  ['radius', 'Radius'],
  ['shadow', 'Shadow'],
];

const DEFAULT_TOKENS = {
  'color-primary': '#111111',
  'color-accent': '#0d99ff',
  'color-bg': '#ffffff',
  'color-surface': '#f4f4f5',
  'color-text': '#111111',
  'color-muted': '#71717a',
  'color-border': '#e4e4e7',
  'font-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-serif': 'Georgia, "Times New Roman", serif',
  'text-sm': '14px',
  'text-base': '16px',
  'text-lg': '20px',
  'text-xl': '28px',
  'text-2xl': '36px',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-6': '24px',
  'space-8': '32px',
  'radius-sm': '6px',
  'radius-md': '10px',
  'radius-lg': '16px',
  'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.06)',
  'shadow-md': '0 4px 16px rgba(0, 0, 0, 0.08)',
};

export const TOKEN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function ensureTokens() {
  try {
    await fs.access(TOKENS_PATH);
  } catch {
    await writeTokens(DEFAULT_TOKENS);
  }
}

export function parseTokens(css) {
  const tokens = {};
  for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

export async function readTokens() {
  return parseTokens(await fs.readFile(TOKENS_PATH, 'utf8'));
}

export function groupOf(name) {
  return GROUPS.find(([prefix]) => name.startsWith(`${prefix}-`))?.[0] ?? 'other';
}

export async function writeTokens(tokens) {
  // Token font yang memakai Google Font: muat font-nya otomatis lewat @import.
  const googleFamilies = Object.entries(tokens)
    .filter(([name]) => groupOf(name) === 'font')
    .map(([, value]) => primaryFamily(value))
    .filter(isGoogleFont);
  const fontsUrl = googleFontsUrl(googleFamilies);
  const lines = [
    ...(fontsUrl ? [`@import url("${fontsUrl}");`, ''] : []),
    '/* Design tokens: dipakai semua artboard lewat var(--nama).',
    '   Diedit dari panel kanan editor (saat tidak ada yang dipilih), oleh Claude, atau manual. */',
    ':root {',
  ];
  for (const [prefix, title] of [...GROUPS, ['other', 'Lainnya']]) {
    const names = Object.keys(tokens).filter((n) => groupOf(n) === prefix);
    if (!names.length) continue;
    lines.push(`  /* ${title} */`);
    for (const n of names) lines.push(`  --${n}: ${tokens[n]};`);
  }
  lines.push('}', '');
  const tmp = `${TOKENS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, lines.join('\n'), 'utf8');
  await fs.rename(tmp, TOKENS_PATH);
}
