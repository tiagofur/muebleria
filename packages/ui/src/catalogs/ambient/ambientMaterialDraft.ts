/**
 * Ambient material draft model (presentation-only catalog, F086).
 */

import type {
  AmbientCategory,
  AmbientMaterial,
  AmbientSurfaceType,
} from '@muebles/domain';

import type { CategoryDraft } from '../../modules/moduleHelpers';

export type AmbientMaterialDraft = {
  code: string;
  name: string;
  surfaceType?: AmbientSurfaceType;
  categoryId?: string;
  previewColor: string;
  /** Relative media path for 3D texture. */
  previewTextureUrl: string;
  previewTextureTileWidthMm: number;
  previewTextureTileLengthMm: number;
  previewRoughness?: number | '';
  previewMetalness?: number | '';
  previewClearcoat?: number | '';
};

export type AmbientCategoryDraft = CategoryDraft;

export type { AmbientCategory };

export const emptyDraft = (): AmbientMaterialDraft => ({
  code: '',
  name: '',
  categoryId: '',
  previewColor: '',
  previewTextureUrl: '',
  previewTextureTileWidthMm: 0,
  previewTextureTileLengthMm: 0,
  previewRoughness: '',
  previewMetalness: '',
  previewClearcoat: '',
});

export function toDraft(item: AmbientMaterial): AmbientMaterialDraft {
  return {
    code: item.code,
    name: item.name,
    surfaceType: item.surfaceType,
    categoryId: item.categoryId ?? '',
    previewColor: item.previewColor ?? '',
    previewTextureUrl: item.previewTextureUrl ?? '',
    previewTextureTileWidthMm: item.previewTextureTileWidthMm ?? 0,
    previewTextureTileLengthMm: item.previewTextureTileLengthMm ?? 0,
    previewRoughness: item.previewRoughness ?? '',
    previewMetalness: item.previewMetalness ?? '',
    previewClearcoat: item.previewClearcoat ?? '',
  };
}
