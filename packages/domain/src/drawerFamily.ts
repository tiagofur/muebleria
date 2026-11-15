/**
 * #1633 s2c-2 — resumen de una FAMILIA DE CAJÓN para su vista: alturas
 * (etiqueta efectiva, mínimo, juego con precio y diseños), insertos como
 * columnas (agrupados por sufijo de código entre alturas) y el estado de
 * cada celda, más lo que le falta a la familia para cotizar y fabricar.
 * Pura: sólo lee el catálogo; ninguna regla de motor nueva.
 */

import { effectiveVariantLabel } from './agregadoAssembly';
import { isDrawerSystemAgregado } from './hardwareKit';
import type { Agregado, Hardware, OptionGroup } from './types';

export interface DrawerFamilyKit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly costPerUnit: number;
  /** Partes del juego (perfil fijo/móvil…) sin diseño 3D completo. */
  readonly designsMissing: number;
  /** El motor no monta herraje inactivo: cuenta como faltante. */
  readonly active: boolean;
}

export interface DrawerFamilyHeight {
  readonly label: string;
  /** La etiqueta se dedujo del nominal (variante previa a #1633, sin dato). */
  readonly labelDerived: boolean;
  readonly khMinMm: number;
  /** null: la variante apunta a un juego que no está en el catálogo. */
  readonly kit: DrawerFamilyKit | null;
  readonly selector: { readonly id: string; readonly code: string; readonly defaultNone: boolean } | null;
}

export interface DrawerFamilyCell {
  readonly hardwareId: string;
  readonly code: string;
  readonly costPerUnit: number;
  readonly active: boolean;
  readonly designMissing: boolean;
  /** Es la opción que monta el mueble si no elige (#1627). */
  readonly isDefault: boolean;
}

export interface DrawerFamilySummary {
  readonly agregadoId: string;
  readonly code: string;
  readonly name: string;
  readonly brand?: string;
  readonly line?: string;
  /** Medidas de la guía (ancho × fondo del ensamble), si están. */
  readonly guideWidthMm?: number;
  readonly guideDepthMm?: number;
  /** Grupos kind:agregado donde los muebles pueden elegir la familia. */
  readonly availableIn: readonly { readonly id: string; readonly code: string; readonly name: string }[];
  readonly heights: readonly DrawerFamilyHeight[];
  /** Columnas: un inserto por sufijo (la galería de M y la de E son la misma columna). */
  readonly inserts: readonly { readonly key: string; readonly label: string }[];
  /** cells[i][key]: el inserto `key` en la altura i, o ausente si no aplica. */
  readonly cells: readonly Readonly<Record<string, DrawerFamilyCell>>[];
  readonly missing: {
    /** Juegos inexistentes o inactivos. */
    readonly kits: number;
    readonly designs: number;
    readonly prices: number;
  };
  readonly complete: boolean;
}

/** Una parte o inserto tiene su diseño 3D si TODAS sus piezas traen asset. */
function designMissing(h: Hardware): boolean {
  const pieces = h.pieces ?? [];
  if (pieces.length === 0) return !h.visualAsset;
  return pieces.some((p) => !p.asset);
}

/** Rótulo de la columna: lo que sigue al «—» del nombre generado, o el nombre. */
function insertLabel(h: Hardware, suffix: string): string {
  const dash = h.name.lastIndexOf('—');
  const fromName = dash >= 0 ? h.name.slice(dash + 1).trim() : h.name.trim();
  return fromName || suffix;
}

export function summarizeDrawerFamily(
  agregado: Agregado,
  catalog: { readonly hardware: readonly Hardware[]; readonly optionGroups: readonly OptionGroup[] },
): DrawerFamilySummary {
  const byId = new Map(catalog.hardware.map((h) => [h.id, h] as const));
  const heightSet = (agregado.variantSets ?? []).find((vs) => vs.dimension === 'height');
  const variants = heightSet?.variants ?? [];

  const insertColumns = new Map<string, string>(); // key → label
  const cells: Record<string, DrawerFamilyCell>[] = [];
  let kitsMissing = 0;
  let designs = 0;
  let prices = 0;

  const heights: DrawerFamilyHeight[] = variants.map((v) => {
    const kitHw = byId.get(v.commercialKitHardwareId || v.hardwareId);
    const row: Record<string, DrawerFamilyCell> = {};
    cells.push(row);
    const labelDerived = !(v.label ?? '').trim();
    const label = effectiveVariantLabel(v) || `${v.nominalDimensionMm} mm`;
    if (!kitHw) {
      kitsMissing += 1;
      return { label, labelDerived, khMinMm: v.nominalDimensionMm, kit: null, selector: null };
    }
    const kitActive = kitHw.active !== false;
    if (!kitActive) kitsMissing += 1;
    const parts = catalog.hardware.filter((h) => h.kitHardwareId === kitHw.id && h.active !== false);
    const kitDesignsMissing = parts.filter(designMissing).length;
    designs += kitDesignsMissing;
    if (!(kitHw.costPerUnit > 0)) prices += 1;

    const group = catalog.optionGroups.find((g) => g.kind === 'hardware' && g.kitHardwareId === kitHw.id);
    if (group) {
      const defaultNone = group.defaultChoice === 'none';
      let defaultTaken = defaultNone;
      for (const optionId of group.optionIds) {
        const opt = byId.get(optionId);
        if (!opt) continue;
        const active = opt.active !== false;
        // Columna: sufijo tras el código del juego (datos del asistente); si
        // el inserto no sigue ese patrón, su nombre normalizado — así dos
        // «Galería» de alturas distintas comparten columna.
        const suffix = opt.code.startsWith(`${kitHw.code}-`)
          ? opt.code.slice(kitHw.code.length + 1)
          : `nombre:${insertLabel(opt, opt.code).toLowerCase()}`;
        if (!insertColumns.has(suffix)) insertColumns.set(suffix, insertLabel(opt, opt.code));
        const missingDesign = designMissing(opt);
        const isDefault = active && !defaultTaken;
        if (isDefault) defaultTaken = true;
        if (active) {
          if (missingDesign) designs += 1;
          if (!(opt.costPerUnit > 0)) prices += 1;
        }
        row[suffix] = {
          hardwareId: opt.id,
          code: opt.code,
          costPerUnit: opt.costPerUnit,
          active,
          designMissing: missingDesign,
          isDefault,
        };
      }
    }
    return {
      label,
      labelDerived,
      khMinMm: v.nominalDimensionMm,
      kit: {
        id: kitHw.id,
        code: kitHw.code,
        name: kitHw.name,
        costPerUnit: kitHw.costPerUnit,
        designsMissing: kitDesignsMissing,
        active: kitActive,
      },
      selector: group ? { id: group.id, code: group.code, defaultNone: group.defaultChoice === 'none' } : null,
    };
  });

  const ds = agregado.drawerSystem;
  const dims = agregado.externalDims;
  return {
    agregadoId: agregado.id,
    code: agregado.code,
    name: agregado.name,
    ...(ds?.brand ? { brand: ds.brand } : {}),
    ...(ds?.line ? { line: ds.line } : {}),
    ...(dims && dims.width > 0 ? { guideWidthMm: dims.width } : {}),
    ...(dims && dims.depth > 0 ? { guideDepthMm: dims.depth } : {}),
    availableIn: catalog.optionGroups
      .filter((g) => g.kind === 'agregado' && g.optionIds.includes(agregado.id))
      .map((g) => ({ id: g.id, code: g.code, name: g.name })),
    heights,
    inserts: [...insertColumns].map(([key, label]) => ({ key, label })),
    cells,
    missing: { kits: kitsMissing, designs, prices },
    complete: kitsMissing === 0 && designs === 0 && prices === 0 && heights.length > 0,
  };
}

/** Las familias de cajón del catálogo (marcador o, en datos previos, -CAJON). */
export function drawerFamilies(
  agregados: readonly Agregado[],
  catalog: { readonly hardware: readonly Hardware[]; readonly optionGroups: readonly OptionGroup[] },
): DrawerFamilySummary[] {
  return agregados
    .filter((a) => a.active !== false && isDrawerSystemAgregado(a))
    .map((a) => summarizeDrawerFamily(a, catalog));
}
