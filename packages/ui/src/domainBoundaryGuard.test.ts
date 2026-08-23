/**
 * F146 / #313 (P3D-7) — gate "React no duplica lógica de negocio".
 *
 * El North Star §16 y la regla AGENTS ("UI no calcula dominio") prohíben
 * fórmulas de negocio paralelas en packages/ui. Este test escanea el código
 * fuente de ui y falla si aparece:
 *   - aritmética de precio/costo propia (costPerM2/boardPrice/wastePercent);
 *   - implementación local de evaluación de fórmulas paramétricas (W/H/D).
 * Importar y llamar a @muebles/domain está permitido (estimateLineSalePrice
 * delega a calcProjectBreakdown; ComponentsScreen llama a evaluatePartFormula
 * importada — el patrón correcto).
 *
 * DEUDA PREEXISTENTE (allowlist): los paneles de purchasing calculan valor de
 * inventario en UI desde Fase 3c. Es deuda del contexto Procurement/Inventory,
 * registrada en #313; este gate impide que aparezca UNA nueva y obliga a
 * tocar esta lista cuando se pague.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// import.meta.url (no __dirname): el resolver de vitest puede variar el cwd.
const UI_SRC = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_PATTERNS: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /costPerM2\s*[*+/]|\*\s*[a-zA-Z]*[Cc]ostPerM2/,
    why: 'aritmética de costo de tablero (costPerM2) — usar calcLineCost/calcProjectBreakdown de domain',
  },
  {
    pattern: /boardPrice\s*[*+/]|[*+/]\s*[a-zA-Z]*[Bb]oardPrice/,
    why: 'aritmética de precio de tablero — usar domain',
  },
  {
    pattern: /wastePercent\s*[*+/]|[*+/]\s*wastePercent/,
    why: 'cálculo de merma — usar domain',
  },
  {
    pattern: /function evaluatePartFormula|evaluatePartFormula\s*=/,
    why: 'implementación local de fórmulas paramétricas (W/H/D) — engine de domain exclusivo (importarla está bien)',
  },
];

/**
 * Deuda registrada: archivo → razón. Si se paga la deuda, el archivo sale de
 * acá y el gate lo protege como al resto.
 */
const ALLOWED_DEBT: readonly { file: string; reason: string }[] = [
  {
    file: 'purchasing/PurchasingScreen.tsx',
    reason: 'valor de inventario en UI desde Fase 3c (Procurement) — deuda #313',
  },
  {
    file: 'purchasing/StockPanel.tsx',
    reason: 'columnas de costo en UI desde Fase 3c (Inventory) — deuda #313',
  },
];

const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'design-system']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRECTORIES.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relativeToUi(file: string): string {
  return file.slice(UI_SRC.length + 1);
}

describe('domain boundary guard (#313: UI no duplica lógica de negocio)', () => {
  it('packages/ui no implementa aritmética de costo ni fórmulas paramétricas', () => {
    const allowed = new Map(
      ALLOWED_DEBT.map((d) => [join(UI_SRC, d.file), d.reason] as const),
    );
    const offenders: string[] = [];
    for (const file of sourceFiles(UI_SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const { pattern, why } of FORBIDDEN_PATTERNS) {
        const m = src.match(pattern);
        if (m && !allowed.has(file)) {
          offenders.push(`${relativeToUi(file)}: «${m[0]}» → ${why}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('la allowlist de deuda sigue siendo mínima y vigente', () => {
    for (const { file, reason } of ALLOWED_DEBT) {
      const full = join(UI_SRC, file);
      // El archivo debe existir y SEGUIR offendiendo: si la deuda se pagó,
      // sacarla de la lista para que el gate la proteja.
      expect(sourceFiles(UI_SRC)).toContain(full);
      const src = readFileSync(full, 'utf8');
      const stillOffends = FORBIDDEN_PATTERNS.some(({ pattern }) =>
        pattern.test(src),
      );
      expect(
        stillOffends,
        `${file} ya no viola el gate (${reason}): sacarlo de ALLOWED_DEBT`,
      ).toBe(true);
    }
  });
});
