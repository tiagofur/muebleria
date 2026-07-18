#!/usr/bin/env node
/**
 * check-tokens.mjs — Guarda contra la deuda de tokens indefinidos (F052).
 *
 * Lee las custom properties definidas en packages/ui/src/design-system/tokens.css
 * y escanea todos los var(--xxx) en .css/.tsx bajo packages/ui/src + apps/web/src.
 * Reporta cualquier referencia a un token que NO está definido (excluyendo los
 * visores 3D, que tienen un namespace alien autocontenido y deferido).
 *
 * Uso:
 *   node scripts/check-tokens.mjs          # reporta y exit 1 si hay deuda
 *   node scripts/check-tokens.mjs --quiet  # solo salida mínima (para CI/gate)
 *
 * No es un linter CSS completo: solo detecta el síntoma que degradó la app en
 * el Judgment Day (tokens legacy/indefinidos que resuelven a unset/fallback).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TOKENS_FILE = join(ROOT, 'packages/ui/src/design-system/tokens.css');
const SCAN_DIRS = [
  join(ROOT, 'packages/ui/src'),
  join(ROOT, 'apps/web/src'),
];
// Visores 3D: namespace alien autocontenido, refactor deferido (F052 fuera de alcance).
const EXCLUDE_SUBSTRINGS = ['part3DViewer', 'moduleScene3d'];
const quiet = process.argv.includes('--quiet');

function readDefinedTokens(file) {
  const src = readFileSync(file, 'utf8');
  const defined = new Set();
  // --foo: ...;  dentro de :root o cualquier bloque.
  const re = /(--[a-z0-9-]+)\s*:/gi;
  let m;
  while ((m = re.exec(src)) !== null) defined.add(m[1]);
  return defined;
}

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (st.isFile() && (full.endsWith('.css') || full.endsWith('.tsx') || full.endsWith('.ts'))) {
      if (EXCLUDE_SUBSTRINGS.some((s) => full.includes(s))) continue;
      // Los tests validan tokens via substring matching, no los consumen;
      // excluirlos evita falsos positivos (ej. asserciones `toContain('var(--danger-')`).
      if (full.endsWith('.test.ts') || full.endsWith('.test.tsx')) continue;
      acc.push(full);
    }
  }
  return acc;
}

function findReferences(src) {
  // Captura el nombre del token dentro de var(--xxx[, fallback]).
  const re = /var\((--[a-z0-9-]+)/gi;
  const refs = [];
  let m;
  while ((m = re.exec(src)) !== null) refs.push(m[1]);
  return refs;
}

const defined = readDefinedTokens(TOKENS_FILE);
if (!quiet) console.log(`Tokens definidos en tokens.css: ${defined.size}`);

const files = SCAN_DIRS.flatMap((d) => walk(d));
const offenders = new Map(); // token -> [{file, line}]

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    for (const ref of findReferences(line)) {
      if (!defined.has(ref)) {
        if (!offenders.has(ref)) offenders.set(ref, []);
        offenders.get(ref).push({ file: relative(ROOT, file), line: i + 1 });
      }
    }
  });
}

if (offenders.size === 0) {
  if (!quiet) console.log('✓ Cero referencias a tokens indefinidos.');
  process.exit(0);
}

const total = [...offenders.values()].reduce((n, xs) => n + xs.length, 0);
console.error(`✗ ${total} referencias a ${offenders.size} tokens indefinidos (excluyendo visores 3D deferidos):`);
for (const [token, locs] of [...offenders.entries()].sort()) {
  console.error(`  ${token}  (${locs.length})`);
  for (const { file, line } of locs.slice(0, 5)) {
    console.error(`    ${file}:${line}`);
  }
  if (locs.length > 5) console.error(`    … y ${locs.length - 5} más`);
}
process.exit(1);
