// Variabel (design tokens): warna, font, spacing, dst. yang dipakai semua artboard lewat var(--nama).
//
// Sumbernya designs/tokens.json (grup, mode, dan nilai per mode). Dari situ dibuat designs/tokens.css
// secara otomatis; file CSS itulah yang di-link ke setiap artboard.
// Mode (mis. Light/Dark): mode pertama adalah default (:root); mode lain menimpa nilainya untuk
// artboard ber-atribut <html data-mode="nama-mode">.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DESIGNS_DIR } from './store.js';
import { googleFontsUrl, primaryFamily, isGoogleFont } from './fonts.js';

export const TOKENS_FILE = 'tokens.css';
export const VARIABLES_FILE = 'tokens.json';
const CSS_PATH = path.join(DESIGNS_DIR, TOKENS_FILE);
const JSON_PATH = path.join(DESIGNS_DIR, VARIABLES_FILE);

export const TOKEN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const GROUP_TYPES = ['color', 'size', 'font', 'text'];

// Grup default. Anggota grup ditentukan dari awalan nama, mis. "color-primary" masuk grup "color".
const DEFAULT_GROUPS = [
  { id: 'color', name: 'Warna', type: 'color' },
  { id: 'font', name: 'Font', type: 'font' },
  { id: 'text', name: 'Ukuran teks', type: 'size' },
  { id: 'space', name: 'Spacing', type: 'size' },
  { id: 'radius', name: 'Radius', type: 'size' },
  { id: 'shadow', name: 'Shadow', type: 'text' },
];

const DEFAULT_VALUES = {
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

export function modeSlug(mode) {
  return mode.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mode';
}

// Grup sebuah variabel: awalan terpanjang yang cocok (mis. "text-" untuk "text-lg").
export function groupOf(name, groups) {
  let best = null;
  for (const g of groups) {
    if (name.startsWith(`${g.id}-`) && (!best || g.id.length > best.id.length)) best = g;
  }
  return best?.id ?? 'other';
}

export async function ensureTokens() {
  try {
    await fs.access(JSON_PATH);
    return;
  } catch {}
  // Pindahkan token lama dari tokens.css (versi sebelum ada mode), atau mulai dari nilai default.
  let values = DEFAULT_VALUES;
  try {
    const css = await fs.readFile(CSS_PATH, 'utf8');
    const parsed = {};
    for (const m of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) parsed[m[1]] = m[2].trim();
    if (Object.keys(parsed).length) values = parsed;
  } catch {}
  const tokens = Object.fromEntries(Object.entries(values).map(([n, v]) => [n, { Default: v }]));
  await writeVariables({ modes: ['Default'], groups: DEFAULT_GROUPS, tokens });
}

export async function readVariables() {
  return JSON.parse(await fs.readFile(JSON_PATH, 'utf8'));
}

// Nilai semua variabel untuk satu mode (mode lain jatuh ke nilai mode default kalau kosong).
export function valuesFor(data, mode = data.modes[0]) {
  const out = {};
  for (const [name, byMode] of Object.entries(data.tokens)) out[name] = byMode[mode] ?? byMode[data.modes[0]];
  return out;
}

export async function writeVariables(data) {
  await writeAtomic(JSON_PATH, JSON.stringify(data, null, 2) + '\n');
  await writeAtomic(CSS_PATH, toCss(data));
}

function toCss({ modes, groups, tokens }) {
  const [base, ...others] = modes;
  // Font Google yang dipakai variabel font (di mode mana pun) dimuat otomatis lewat @import.
  const fontGroups = new Set(groups.filter((g) => g.type === 'font').map((g) => g.id));
  const families = Object.entries(tokens)
    .filter(([name]) => fontGroups.has(groupOf(name, groups)))
    .flatMap(([, byMode]) => Object.values(byMode))
    .map(primaryFamily)
    .filter(isGoogleFont);
  const fontsUrl = googleFontsUrl(families);

  const lines = [
    ...(fontsUrl ? [`@import url("${fontsUrl}");`, ''] : []),
    '/* Dibuat otomatis dari tokens.json. Edit lewat tab Variabel di editor (atau minta Claude),',
    '   bukan di file ini, karena perubahan di sini akan tertimpa. */',
    ':root {',
  ];
  for (const g of [...groups, { id: 'other', name: 'Lainnya' }]) {
    const names = Object.keys(tokens).filter((n) => groupOf(n, groups) === g.id && tokens[n][base] != null);
    if (!names.length) continue;
    lines.push(`  /* ${g.name} */`);
    for (const n of names) lines.push(`  --${n}: ${tokens[n][base]};`);
  }
  lines.push('}');
  for (const mode of others) {
    const names = Object.keys(tokens).filter((n) => tokens[n][mode] != null && tokens[n][mode] !== '');
    if (!names.length) continue;
    lines.push('', `/* Mode: ${mode} */`, `[data-mode="${modeSlug(mode)}"] {`);
    for (const n of names) lines.push(`  --${n}: ${tokens[n][mode]};`);
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

async function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}
