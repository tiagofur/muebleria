/**
 * Material preview color helpers (3D / swatches). Pure validation + normalize.
 */

/** Accept #RGB or #RRGGBB (case-insensitive). */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidPreviewColor(value: string | undefined | null): boolean {
  if (value == null) return false;
  return HEX_COLOR.test(value.trim());
}

/**
 * Normalize a valid preview color to uppercase #RRGGBB.
 * Returns undefined if missing/invalid.
 */
export function normalizePreviewColor(
  value: string | undefined | null,
): string | undefined {
  if (value == null) return undefined;
  const t = value.trim();
  if (!HEX_COLOR.test(t)) return undefined;
  const hex = t.slice(1);
  if (hex.length === 3) {
    const expanded = hex
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return `#${hex.toUpperCase()}`;
}

/** Default soft wood tone when a material has no preview color. */
export const DEFAULT_MATERIAL_PREVIEW_COLOR = '#D4C4A8';

import type { AmbientMaterial } from './types';

export const DEFAULT_AMBIENT_MATERIALS: readonly AmbientMaterial[] = [
  // Pisos predeterminados
  {
    id: 'def-floor-cement',
    code: 'PISO-01',
    name: 'Cemento Gris',
    active: true,
    surfaceType: 'floor',
    previewColor: '#8A8F94',
    previewRoughness: 0.6,
  },
  {
    id: 'def-floor-wood',
    code: 'PISO-02',
    name: 'Madera Roble',
    active: true,
    surfaceType: 'floor',
    previewColor: '#B8860B',
    previewRoughness: 0.4,
  },
  {
    id: 'def-floor-ceramic',
    code: 'PISO-03',
    name: 'Porcelanato Claro',
    active: true,
    surfaceType: 'floor',
    previewColor: '#E5E7EB',
    previewRoughness: 0.2,
  },
  {
    id: 'def-floor-dark',
    code: 'PISO-04',
    name: 'Cerámico Grafito',
    active: true,
    surfaceType: 'floor',
    previewColor: '#374151',
    previewRoughness: 0.5,
  },
  // Muros / Paredes predeterminados
  {
    id: 'def-wall-white',
    code: 'MURO-01',
    name: 'Blanco Mate',
    active: true,
    surfaceType: 'wall',
    previewColor: '#F3F4F6',
    previewRoughness: 0.8,
  },
  {
    id: 'def-wall-concrete',
    code: 'MURO-02',
    name: 'Gris Concreto',
    active: true,
    surfaceType: 'wall',
    previewColor: '#9CA3AF',
    previewRoughness: 0.7,
  },
  {
    id: 'def-wall-beige',
    code: 'MURO-03',
    name: 'Beige Arena',
    active: true,
    surfaceType: 'wall',
    previewColor: '#E5D9C5',
    previewRoughness: 0.8,
  },
  {
    id: 'def-wall-navy',
    code: 'MURO-04',
    name: 'Azul Noche Accent',
    active: true,
    surfaceType: 'wall',
    previewColor: '#1E293B',
    previewRoughness: 0.6,
  },
  // Techos predeterminados
  {
    id: 'def-ceiling-white',
    code: 'TECHO-01',
    name: 'Blanco Liso',
    active: true,
    surfaceType: 'ceiling',
    previewColor: '#FAFAFA',
    previewRoughness: 0.9,
  },
  {
    id: 'def-ceiling-wood',
    code: 'TECHO-02',
    name: 'Madera Listonada',
    active: true,
    surfaceType: 'ceiling',
    previewColor: '#C5A059',
    previewRoughness: 0.5,
  },
  {
    id: 'def-ceiling-plaster',
    code: 'TECHO-03',
    name: 'Yeso Blanco',
    active: true,
    surfaceType: 'ceiling',
    previewColor: '#F3F4F6',
    previewRoughness: 0.8,
  },
  {
    id: 'def-ceiling-concrete',
    code: 'TECHO-04',
    name: 'Concreto Visto',
    active: true,
    surfaceType: 'ceiling',
    previewColor: '#9CA3AF',
    previewRoughness: 0.7,
  },
];

/**
 * Merges custom ambient materials with standard default ambient materials
 * so there are always ready-to-use floor, wall, and ceiling materials in the 3D studio.
 */
export function resolveAmbientMaterials(
  customMaterials?: readonly AmbientMaterial[],
): readonly AmbientMaterial[] {
  const custom = (customMaterials ?? []).filter((m) => m.active);
  const hasCustomFloor = custom.some((m) => m.surfaceType === 'floor');
  const hasCustomWall = custom.some((m) => m.surfaceType === 'wall');
  const hasCustomCeiling = custom.some((m) => m.surfaceType === 'ceiling');

  const result = [...custom];
  if (!hasCustomFloor) {
    result.push(...DEFAULT_AMBIENT_MATERIALS.filter((m) => m.surfaceType === 'floor'));
  }
  if (!hasCustomWall) {
    result.push(...DEFAULT_AMBIENT_MATERIALS.filter((m) => m.surfaceType === 'wall'));
  }
  if (!hasCustomCeiling) {
    result.push(...DEFAULT_AMBIENT_MATERIALS.filter((m) => m.surfaceType === 'ceiling'));
  }
  return result;
}
