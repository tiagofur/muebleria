/**
 * Structure editor draft helpers.
 */

import type { DimensionPreset, ModuleAgregadoInstance, Structure } from '@muebles/domain';
import type { ComponentInstanceDraft } from '../modules';

/**
 * Tab order: General → Componentes → Agregados → Presets.
 * Vista 3D is co-located on Componentes (live sticky preview), not a separate tab.
 */
export type StructureEditorTab =
  | 'general'
  | 'components'
  | 'agregados'
  | 'presets';

export const STRUCTURE_EDITOR_TABS: readonly {
  readonly id: StructureEditorTab;
  readonly label: string;
}[] = [
  { id: 'general', label: 'General' },
  { id: 'components', label: 'Componentes' },
  { id: 'agregados', label: 'Agregados' },
  { id: 'presets', label: 'Presets' },
] as const;

export interface StructureDraft {
  code: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  presets: DimensionPreset[];
  components: ComponentInstanceDraft[];
  agregados: ModuleAgregadoInstance[];
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
    agregados: [],
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
          overrides: c.overrides,
        }))
      : [],
    agregados: item.agregados
      ? item.agregados.map((a) => ({
          ...a,
          position: a.position ? { ...a.position } : undefined,
          dimensions: a.dimensions ? { ...a.dimensions } : undefined,
          optionOverrides: a.optionOverrides ? { ...a.optionOverrides } : undefined,
        }))
      : [],
  };
}
