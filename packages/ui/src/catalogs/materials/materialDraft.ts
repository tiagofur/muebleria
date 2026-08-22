/**
 * Material draft model shared by the materials screen and its form modal.
 */

import type { EdgeBand, MaterialBoard } from '@muebles/domain';

import type { EdgeDraft } from '../EdgesCatalog';

export type MaterialDraft = {
  code: string;
  name: string;
  /** Fabricante (F142). Obligatorio en el form; texto libre. */
  manufacturer: string;
  /** Subgrupo (categoría de materiales, F142). Empty string = sin subgrupo. */
  categoryId: string;
  widthMm: number;
  lengthMm: number;
  thicknessMm: number;
  grainDefault: boolean;
  boardPrice: number;
  wastePercent: number;
  costPerM2: number;
  /** Linked EdgeBand id (never by name). Empty string = none. */
  defaultEdgeBandId: string;
  /** Relative media path (F040/F042). */
  imageUrl: string;
  /** #RRGGBB solid color for 3D / swatches. Empty = none. */
  previewColor: string;
  /** Optional texture media URL for 3D. Empty = none. */
  previewTextureUrl: string;
  /**
   * Real-world mm covered by one texture image across width (X / U).
   * 0 = default client tile.
   */
  previewTextureTileWidthMm: number;
  /**
   * Real-world mm covered by one texture image along length/veta (Y / V).
   * 0 = default client tile.
   */
  previewTextureTileLengthMm: number;
  /** Surface roughness (0..1). Omit/empty = default */
  previewRoughness?: number | '';
  /** Metallic property (0..1). Omit/empty = default */
  previewMetalness?: number | '';
  /** Clearcoat lacquer layer (0..1). Omit/empty = default */
  previewClearcoat?: number | '';
  notes: string;
};

/** Inputs the shell needs to compute costPerM2 (domain formula stays out of UI). */
export type MaterialCostInputs = {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly boardPrice: number;
  readonly wastePercent: number;
};

export const emptyDraft = (): MaterialDraft => ({
  code: '',
  name: '',
  manufacturer: '',
  categoryId: '',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 0,
  wastePercent: 0,
  costPerM2: 0,
  defaultEdgeBandId: '',
  imageUrl: '',
  previewColor: '',
  previewTextureUrl: '',
  previewTextureTileWidthMm: 0,
  previewTextureTileLengthMm: 0,
  previewRoughness: '',
  previewMetalness: '',
  previewClearcoat: '',
  notes: '',
});

export function toDraft(item: MaterialBoard): MaterialDraft {
  return {
    code: item.code,
    name: item.name,
    manufacturer: item.manufacturer ?? '',
    categoryId: item.categoryId ?? '',
    widthMm: item.widthMm,
    lengthMm: item.lengthMm,
    thicknessMm: item.thicknessMm,
    grainDefault: item.grainDefault,
    boardPrice: item.boardPrice,
    wastePercent: item.wastePercent,
    costPerM2: item.costPerM2,
    defaultEdgeBandId: item.defaultEdgeBandId ?? '',
    imageUrl: item.imageUrl ?? '',
    previewColor: item.previewColor ?? '',
    previewTextureUrl: item.previewTextureUrl ?? '',
    previewTextureTileWidthMm: item.previewTextureTileWidthMm ?? 0,
    previewTextureTileLengthMm: item.previewTextureTileLengthMm ?? 0,
    previewRoughness: item.previewRoughness ?? '',
    previewMetalness: item.previewMetalness ?? '',
    previewClearcoat: item.previewClearcoat ?? '',
    notes: item.notes ?? '',
  };
}

export const emptyEdgeDraft = (): EdgeDraft => ({
  code: '',
  name: '',
  thicknessMm: 0.5,
  costPerMl: 0,
  notes: '',
  previewColor: '',
});

/** True when the draft already has 3D preview overrides (open advanced on edit). */
export function hasPreview3dConfig(d: MaterialDraft): boolean {
  return Boolean(
    d.previewColor.trim() ||
      d.previewTextureUrl.trim() ||
      d.previewTextureTileWidthMm > 0 ||
      d.previewTextureTileLengthMm > 0 ||
      (typeof d.previewRoughness === 'number' && Number.isFinite(d.previewRoughness)) ||
      (typeof d.previewMetalness === 'number' && Number.isFinite(d.previewMetalness)) ||
      (typeof d.previewClearcoat === 'number' && Number.isFinite(d.previewClearcoat)),
  );
}

/** Edge suggestions shown as picker subtitles. */
export function edgePickerItems(edges: readonly EdgeBand[]) {
  return edges.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    active: e.active,
    subtitle: `${e.thicknessMm} mm`,
  }));
}
