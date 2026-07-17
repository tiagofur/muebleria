/**
 * Structure editor draft helpers.
 */

import type { DimensionPreset, Structure } from '@muebles/domain';
import type { ComponentInstanceDraft } from '../modules';

export type StructureEditorTab = 'general' | 'presets' | 'components';

export const STRUCTURE_EDITOR_TABS: readonly {
  readonly id: StructureEditorTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'Datos Generales' },
  { id: 'presets', label: 'Presets de Medida' },
  { id: 'components', label: 'Componentes' },
] as const;

export interface StructureDraft {
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  presets: DimensionPreset[];
  components: ComponentInstanceDraft[];
  notes: string;
  active: boolean;
}

export function emptyStructureDraft(): StructureDraft {
  return {
    code: '',
    name: '',
    widthMm: 0,
    heightMm: 0,
    depthMm: 0,
    presets: [],
    components: [],
    notes: '',
    active: true,
  };
}

export function structureToDraft(item: Structure): StructureDraft {
  return {
    code: item.code,
    name: item.name,
    widthMm: item.externalDims?.width ?? 0,
    heightMm: item.externalDims?.height ?? 0,
    depthMm: item.externalDims?.depth ?? 0,
    notes: item.notes ?? '',
    active: item.active !== false,
    presets: item.presets ? item.presets.map((pr) => ({ ...pr })) : [],
    components: item.components
      ? item.components.map((c) => ({
          componentId: c.componentId,
          quantity: c.quantity,
          placementOverride: c.placementOverride ?? '',
        }))
      : [],
  };
}
