/**
 * Draft state management and helpers for Agregados (sub-assemblies).
 */

import type {
  Agregado,
  AgregadoPresentationMotion,
  HardwareLine,
  ModuleComponentInstance,
} from '@granete/domain';
import { arrayRule, numberRule, objectRule, optionalRule, stringFields, stringRule } from '../common/draftValidation';
import { componentInstanceDraftRule } from '../modules/helpers/moduleDraftTransforms';

export type AgregadoMotionType = 'none' | 'rotate_left' | 'rotate_right' | 'translate';

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
  motionType: AgregadoMotionType;
  openAngleDeg: number;
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
    motionType: 'none',
    openAngleDeg: 110,
  };
}

const agregadoDraftRule = objectRule({
  ...stringFields('code', 'name', 'description', 'notes'), widthMm: numberRule, heightMm: numberRule, depthMm: numberRule,
  components: arrayRule(componentInstanceDraftRule), hardwareLines: arrayRule(objectRule({
    ...stringFields('id', 'optionRole'), quantity: numberRule, descriptionOverride: optionalRule(stringRule), hardwareId: optionalRule(stringRule),
  })),
  motionType: optionalRule(stringRule),
  openAngleDeg: optionalRule(numberRule),
});
export function isAgregadoDraft(value: unknown): value is AgregadoDraft { return agregadoDraftRule(value); }

export function agregadoToDraft(a: Agregado): AgregadoDraft {
  const dims = a.externalDims ?? { width: 0, height: 0, depth: 0 };
  let motionType: AgregadoMotionType = 'none';
  let openAngleDeg = 110;
  if (a.presentationMotion) {
    if (a.presentationMotion.kind === 'rotate') {
      motionType = a.presentationMotion.pivot === 'right' ? 'rotate_right' : 'rotate_left';
      openAngleDeg = a.presentationMotion.openAngleDeg ?? 110;
    } else if (a.presentationMotion.kind === 'translate') {
      motionType = 'translate';
    }
  }
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
    motionType,
    openAngleDeg,
  };
}

export function draftToAgregado(id: string, draft: AgregadoDraft): Agregado {
  const presentationMotion: AgregadoPresentationMotion | undefined =
    draft.motionType === 'rotate_left'
      ? {
          kind: 'rotate',
          pivot: 'left',
          axis: { x: 0, y: 0, z: 1 },
          openAngleDeg: draft.openAngleDeg > 0 ? draft.openAngleDeg : 110,
        }
      : draft.motionType === 'rotate_right'
      ? {
          kind: 'rotate',
          pivot: 'right',
          axis: { x: 0, y: 0, z: -1 },
          openAngleDeg: draft.openAngleDeg > 0 ? draft.openAngleDeg : 110,
        }
      : draft.motionType === 'translate'
      ? {
          kind: 'translate',
          axis: { x: 0, y: 1, z: 0 },
          distanceMm: draft.depthMm > 0 ? draft.depthMm * 0.8 : 400,
        }
      : undefined;

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
    presentationMotion,
  };
}
