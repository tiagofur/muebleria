/**
 * Draft state management and helpers for Agregados (sub-assemblies).
 */

import type {
  Agregado,
  HardwareLine,
  ModuleComponentInstance,
} from '@granete/domain';

export interface AgregadoDraft {
  code: string;
  name: string;
  description: string;
  notes: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  components: ModuleComponentInstance[];
  hardwareLines: HardwareLine[];
}

export function createEmptyAgregadoDraft(): AgregadoDraft {
  return {
    code: '',
    name: '',
    description: '',
    notes: '',
    widthMm: 0,
    heightMm: 0,
    depthMm: 0,
    components: [],
    hardwareLines: [],
  };
}

export function agregadoToDraft(a: Agregado): AgregadoDraft {
  const dims = a.externalDims ?? { width: 0, height: 0, depth: 0 };
  return {
    code: a.code,
    name: a.name,
    description: a.description ?? '',
    notes: a.notes ?? '',
    widthMm: dims.width,
    heightMm: dims.height,
    depthMm: dims.depth,
    components: (a.components ?? []).map((c) => ({ ...c })),
    hardwareLines: (a.hardwareLines ?? []).map((h) => ({ ...h })),
  };
}

export function draftToAgregado(id: string, draft: AgregadoDraft): Agregado {
  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    notes: draft.notes.trim() || undefined,
    externalDims:
      draft.widthMm > 0 || draft.heightMm > 0 || draft.depthMm > 0
        ? { width: draft.widthMm, height: draft.heightMm, depth: draft.depthMm }
        : undefined,
    components: draft.components.length > 0 ? draft.components : undefined,
    hardwareLines: draft.hardwareLines.length > 0 ? draft.hardwareLines : undefined,
  };
}
