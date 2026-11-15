/**
 * Modelo del asistente «Nueva familia de cajón» (#1633 s2b): filas de altura
 * editables, la plantilla Blum como punto de partida (no regla) y la
 * validación local de cada paso. El planner del dominio sigue siendo la
 * autoridad del plan; esto sólo decide si se puede avanzar de paso.
 */

import { HARDWARE_KIT_SYSTEM_HEIGHTS, type HardwareKitSystemHeight } from '@granete/domain';
import type { InsertoDraft } from '../KitSystemInsertosFieldset';
import { insertoSuffix } from '../KitSystemInsertosFieldset';

export interface FamilyHeightRow {
  /** Identidad estable de la fila (React key y foco), no se persiste. */
  readonly key: string;
  readonly label: string;
  readonly khMinMm: string;
  readonly price: string;
}

export const FAMILY_WIZARD_STEPS = ['Identidad', 'Alturas', 'Insertos', 'Diseños 3D', 'Resumen'] as const;
export type FamilyWizardStep = 0 | 1 | 2 | 3 | 4;

export interface FamilyIdentity {
  readonly code: string;
  readonly name: string;
  readonly brand: string;
  readonly line: string;
  readonly widthMm: string;
  readonly depthMm: string;
}

/** Parseo estricto: lo inválido es NaN (el planner lo rechaza con mensaje). */
export const parseMm = (v: string): number => {
  const t = v.trim();
  if (!t) return Number.NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
};

let rowSeq = 0;
export function newHeightRow(partial: Partial<Omit<FamilyHeightRow, 'key'>> = {}): FamilyHeightRow {
  rowSeq += 1;
  return { key: `h${rowSeq}`, label: '', khMinMm: '', price: '', ...partial };
}

/** Plantilla Blum MERIVOBOX (N · M · K · E): filas editables, sin precio. */
export function blumMerivoboxTemplate(): FamilyHeightRow[] {
  return HARDWARE_KIT_SYSTEM_HEIGHTS.map((h) => newHeightRow({ label: h.code, khMinMm: String(h.khMinMm) }));
}

export function identityProblem(id: FamilyIdentity): string | null {
  if (!id.code.trim()) return 'Poné el código de la familia (por ejemplo MBOX-IRIDIUM).';
  if (!id.name.trim()) return 'Poné el nombre de la familia.';
  if (!(parseMm(id.widthMm) > 0)) return 'El ancho de la guía tiene que ser mayor que 0 mm.';
  if (!(parseMm(id.depthMm) > 0)) return 'El fondo de la guía tiene que ser mayor que 0 mm.';
  return null;
}

export function heightRowsProblem(rows: readonly FamilyHeightRow[]): string | null {
  if (rows.length === 0) return 'Añadí al menos una altura, o precargá la plantilla Blum.';
  const labels = new Set<string>();
  const nominals = new Set<number>();
  for (const [i, row] of rows.entries()) {
    const label = row.label.trim();
    if (!label) return `La altura ${i + 1} necesita una etiqueta.`;
    const key = label.toLowerCase();
    if (labels.has(key)) return `La etiqueta «${label}» está repetida.`;
    labels.add(key);
    const kh = parseMm(row.khMinMm);
    if (!(kh > 0)) return `La altura «${label}» necesita una altura interior mínima mayor que 0 mm.`;
    if (nominals.has(kh)) {
      return `Dos alturas tienen la misma altura interior mínima (${kh} mm): la selección automática no podría distinguirlas.`;
    }
    nominals.add(kh);
    const price = parseMm(row.price);
    if (!(price >= 0)) return `Poné el precio del juego «${label}» (puede ser 0).`;
  }
  return null;
}

export function heightRowsToInput(rows: readonly FamilyHeightRow[]): HardwareKitSystemHeight[] {
  return rows.map((row) => ({
    code: row.label.trim(),
    labelEs: row.label.trim(),
    khMinMm: parseMm(row.khMinMm),
    include: true,
    kitCostPerUnit: parseMm(row.price),
  }));
}

export function insertsProblem(drafts: readonly InsertoDraft[], heightLabels: readonly string[]): string | null {
  const available = new Set(heightLabels.map((l) => l.trim().toLowerCase()));
  const suffixes = new Set<string>();
  for (const [i, d] of drafts.entries()) {
    const name = d.name.trim();
    if (!name) return `El inserto ${i + 1} necesita un nombre (o quitalo).`;
    const suffix = insertoSuffix(name);
    if (!suffix) return `El nombre «${name}» no deja un código válido.`;
    if (suffixes.has(suffix)) {
      return `Dos insertos generarían el mismo código (…-${suffix}): renombrá uno para diferenciarlos.`;
    }
    suffixes.add(suffix);
    const heights = (d.heights ?? []).filter((h) => available.has(h.trim().toLowerCase()));
    if (heights.length === 0) return `El inserto «${name}» no se ofrece en ninguna altura: marcá al menos una.`;
    if (d.price !== undefined && !(parseMm(d.price || '0') >= 0)) {
      return `El precio del inserto «${name}» no puede ser negativo.`;
    }
  }
  return null;
}
