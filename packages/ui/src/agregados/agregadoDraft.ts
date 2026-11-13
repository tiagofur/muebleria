/**
 * Draft state management and helpers for Agregados (sub-assemblies).
 */

import type {
  Agregado,
  AgregadoPresentationMotion,
  AgregadoRigidMember,
  AgregadoVariantSet,
  AssemblyCompatibilityRule,
  HardwareLine,
  ModuleComponentInstance,
} from '@granete/domain';
import { suggestDuplicateCode } from '@granete/domain';
import {
  arrayRule,
  booleanRule,
  numberRule,
  objectRule,
  optionalRule,
  stringFields,
  stringRule,
} from '../common/draftValidation';
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
  /** #1412: la receta viaja en el borrador — guardar desde el form general ya
   * NO puede escribir una revisión sin receta (la habría borrado). */
  rigidMembers: AgregadoRigidMember[];
  variantSets: AgregadoVariantSet[];
  compatibilityRules: AssemblyCompatibilityRule[];
  commercialKitHardwareId?: string;
  active?: boolean;
  /** Preserved when an agregado carries keyframes or a custom non-side pivot. */
  preservedPresentationMotion?: AgregadoPresentationMotion;
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
    rigidMembers: [],
    variantSets: [],
    compatibilityRules: [],
  };
}

const axisPlacementDraftRule = objectRule({
  ref: stringRule,
  offsetMm: numberRule,
  // #1418: la fórmula reemplaza al offset numérico — un draft con fórmula
  // que fallara acá reseteaba TODO el borrador en el restore de sesión.
  offsetFormula: optionalRule(stringRule),
});

const anchorRuleDraftRule = objectRule({
  x: axisPlacementDraftRule,
  y: axisPlacementDraftRule,
  z: axisPlacementDraftRule,
  rotationDeg: optionalRule(
    objectRule({
      x: optionalRule(numberRule),
      y: optionalRule(numberRule),
      z: optionalRule(numberRule),
    }),
  ),
});

// #1460 F2: override de dimensiones por eje — mm|fórmula, ambos opcionales
// dentro del eje; el eje entero es opcional.
const dimensionOverrideAxisDraftRule = objectRule({
  mm: optionalRule(numberRule),
  formula: optionalRule(stringRule),
});

const dimensionOverrideDraftRule = objectRule({
  width: optionalRule(dimensionOverrideAxisDraftRule),
  height: optionalRule(dimensionOverrideAxisDraftRule),
  depth: optionalRule(dimensionOverrideAxisDraftRule),
});

const rigidMemberDraftRule = objectRule({
  ...stringFields('memberId', 'role'),
  actorMembership: optionalRule(stringRule),
  source: objectRule({
    kind: stringRule,
    fixed: optionalRule(objectRule({ ...stringFields('hardwareId') })),
    variant: optionalRule(objectRule({ ...stringFields('variantSetId') })),
  }),
  placement: anchorRuleDraftRule,
  bomRole: stringRule,
  dimensionOverrides: optionalRule(dimensionOverrideDraftRule),
});

const variantSetDraftRule = objectRule({
  ...stringFields('id', 'dimension'),
  variants: arrayRule(
    // #1493: la variante puede declarar su propio kit comercial (opcional).
    objectRule({
      nominalDimensionMm: numberRule,
      ...stringFields('hardwareId'),
      commercialKitHardwareId: optionalRule(stringRule),
    }),
  ),
});

const compatibilityRuleDraftRule = objectRule({
  ...stringFields('variantSetId', 'selectionStrategy'),
  clearanceMm: numberRule,
});

const agregadoDraftRule = objectRule({
  ...stringFields('code', 'name', 'description', 'notes'), widthMm: numberRule, heightMm: numberRule, depthMm: numberRule,
  components: arrayRule(componentInstanceDraftRule), hardwareLines: arrayRule(objectRule({
    ...stringFields('id', 'optionRole'), quantity: numberRule, descriptionOverride: optionalRule(stringRule), hardwareId: optionalRule(stringRule),
  })),
  motionType: optionalRule(stringRule),
  openAngleDeg: optionalRule(numberRule),
  // #1412: optional entries so persisted pre-recipe drafts still validate;
  // consumers read them with `?? []`.
  rigidMembers: optionalRule(arrayRule(rigidMemberDraftRule)),
  variantSets: optionalRule(arrayRule(variantSetDraftRule)),
  compatibilityRules: optionalRule(arrayRule(compatibilityRuleDraftRule)),
  commercialKitHardwareId: optionalRule(stringRule),
  active: optionalRule(booleanRule),
  preservedPresentationMotion: optionalRule(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  ),
});
export function isAgregadoDraft(value: unknown): value is AgregadoDraft { return agregadoDraftRule(value); }

function clonePresentationMotion(
  motion: AgregadoPresentationMotion,
): AgregadoPresentationMotion {
  if (motion.kind === 'keyframes') {
    return {
      kind: 'keyframes',
      keyframes: motion.keyframes.map((k) => ({
        progress: k.progress,
        translationMm: [...k.translationMm] as [number, number, number],
        rotationDeg: k.rotationDeg ? { ...k.rotationDeg } : undefined,
      })),
    };
  }
  if (motion.kind === 'rotate') {
    return {
      ...motion,
      axis: { ...motion.axis },
      pivot:
        typeof motion.pivot === 'string'
          ? motion.pivot
          : { localMm: [...motion.pivot.localMm] as [number, number, number] },
    };
  }
  return { ...motion, axis: { ...motion.axis } };
}

export function agregadoToDraft(a: Agregado): AgregadoDraft {
  const dims = a.externalDims ?? { width: 0, height: 0, depth: 0 };
  let motionType: AgregadoMotionType = 'none';
  let openAngleDeg = 110;
  let preservedPresentationMotion: AgregadoPresentationMotion | undefined;
  if (a.presentationMotion) {
    if (a.presentationMotion.kind === 'rotate') {
      if (a.presentationMotion.pivot === 'left' || a.presentationMotion.pivot === 'right') {
        motionType = a.presentationMotion.pivot === 'right' ? 'rotate_right' : 'rotate_left';
        openAngleDeg = a.presentationMotion.openAngleDeg ?? 110;
      } else {
        preservedPresentationMotion = clonePresentationMotion(a.presentationMotion);
      }
    } else if (a.presentationMotion.kind === 'translate') {
      motionType = 'translate';
    } else if (a.presentationMotion.kind === 'keyframes') {
      preservedPresentationMotion = clonePresentationMotion(a.presentationMotion);
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
    components: (a.components ?? []).map((c) => structuredClone(c)),
    hardwareLines: (a.hardwareLines ?? []).map((h) => ({ ...h })),
    motionType,
    openAngleDeg,
    rigidMembers: (a.rigidMembers ?? []).map((m) => structuredClone(m)),
    variantSets: (a.variantSets ?? []).map((s) => structuredClone(s)),
    compatibilityRules: (a.compatibilityRules ?? []).map((r) => ({ ...r })),
    commercialKitHardwareId: a.commercialKitHardwareId ?? undefined,
    ...(a.active !== undefined ? { active: a.active } : {}),
    ...(preservedPresentationMotion ? { preservedPresentationMotion } : {}),
  };
}

function nextDuplicateNestedId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Prefill a create draft from an existing agregado: `<CODE>-COPY` (editable),
 * `<Name> (copia)`, regenerated hardwareLine ids, and deep-cloned recipe/parts.
 */
export function agregadoToDuplicateDraft(
  item: Agregado,
  existingCodes: readonly string[],
  nextNestedId: () => string = nextDuplicateNestedId,
): AgregadoDraft {
  const base = agregadoToDraft(item);
  return {
    ...base,
    code: suggestDuplicateCode(item.code, existingCodes),
    name: `${item.name} (copia)`,
    ...(item.active !== undefined ? { active: true } : {}),
    hardwareLines: base.hardwareLines.map((h) => ({
      ...h,
      id: nextNestedId(),
    })),
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
      : draft.preservedPresentationMotion;

  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    notes: draft.notes.trim() || undefined,
    ...(draft.active !== undefined ? { active: draft.active } : {}),
    externalDims:
      draft.widthMm > 0 || draft.heightMm > 0 || draft.depthMm > 0
        ? { width: draft.widthMm, height: draft.heightMm, depth: draft.depthMm }
        : undefined,
    components: draft.components.length > 0 ? draft.components : undefined,
    hardwareLines: draft.hardwareLines.length > 0 ? draft.hardwareLines : undefined,
    presentationMotion,
    // `?? []`: un draft persistido anterior a la receta sobrevive en
    // sessionStorage y llega con las claves ausentes — sin normalizar, el
    // guard del submit fallaría con "Cannot read properties of undefined".
    rigidMembers: (draft.rigidMembers ?? []).length > 0 ? draft.rigidMembers : undefined,
    variantSets: (draft.variantSets ?? []).length > 0 ? draft.variantSets : undefined,
    compatibilityRules:
      (draft.compatibilityRules ?? []).length > 0 ? draft.compatibilityRules : undefined,
    commercialKitHardwareId: draft.commercialKitHardwareId || undefined,
  };
}
