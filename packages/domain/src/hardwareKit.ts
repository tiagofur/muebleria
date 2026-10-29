/**
 * Hardware kit wizard planning (#1416).
 *
 * Pure derivation of WHAT a "juego de herraje" (hardware kit) creation will
 * produce: one commercial kit hardware, four design-only hardware parts, and a
 * drawer agregado whose recipe references them with fixed/moving memberships.
 * The UI renders this plan as a live preview; the store re-derives it against
 * real catalog state before persisting (the plan never authorizes anything by
 * itself — the server remains the authority through the existing POST
 * /catalog/hardware and POST /catalog/agregados validations).
 */

import type { HardwareVisualAssetBinding } from './types';

export type HardwareKitDesignSlot = 'fixed_left' | 'fixed_right' | 'moving_left' | 'moving_right';

export interface HardwareKitSlotInfo {
  readonly slot: HardwareKitDesignSlot;
  /** Code suffix appended to the kit code for this design part. */
  readonly suffix: string;
  /** Workshop-facing label (Spanish, K4). */
  readonly labelEs: string;
  /** Rigid member role in the generated recipe. */
  readonly role: string;
  /** Rigid member id in the generated recipe. */
  readonly memberId: string;
  /** #1376 membership: 'body' stays with the furniture, the actor moves. */
  readonly membership: string;
  /** X anchor reference and the sign applied to the configured offset. */
  readonly anchorXRef: 'min' | 'max';
  readonly offsetSign: 1 | -1;
}

export const HARDWARE_KIT_SLOTS: readonly HardwareKitSlotInfo[] = [
  {
    slot: 'fixed_left',
    suffix: '-FIJ-I',
    labelEs: 'Guía fija izquierda',
    role: 'fixed_rail',
    memberId: 'fixed_rail_left',
    membership: 'body',
    anchorXRef: 'min',
    offsetSign: 1,
  },
  {
    slot: 'fixed_right',
    suffix: '-FIJ-D',
    labelEs: 'Guía fija derecha',
    role: 'fixed_rail',
    memberId: 'fixed_rail_right',
    membership: 'body',
    anchorXRef: 'max',
    offsetSign: -1,
  },
  {
    slot: 'moving_left',
    suffix: '-MOV-I',
    labelEs: 'Corredera móvil izquierda',
    role: 'moving_rail',
    memberId: 'moving_rail_left',
    membership: 'actor:drawer',
    anchorXRef: 'min',
    offsetSign: 1,
  },
  {
    slot: 'moving_right',
    suffix: '-MOV-D',
    labelEs: 'Corredera móvil derecha',
    role: 'moving_rail',
    memberId: 'moving_rail_right',
    membership: 'actor:drawer',
    anchorXRef: 'max',
    offsetSign: -1,
  },
];

export const DEFAULT_FIXED_OFFSET_MM = 10;
export const DEFAULT_MOVING_OFFSET_MM = 35;

export function defaultAgregadoCode(kitCode: string): string {
  return `${kitCode}-CAJON`;
}

export interface HardwareKitPlanInput {
  /** Commercial kit code (e.g. HER-CORR-TEL-50). Design parts derive from it. */
  readonly code: string;
  readonly name: string;
  readonly kitCostPerUnit: number;
  /** Reference envelope of the generated drawer agregado. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  /** X offsets from the min/max anchors (fixed guides vs moving rails). */
  readonly fixedOffsetMm: number;
  readonly movingOffsetMm: number;
  /** Agregado code; defaults to `${code}-CAJON`. */
  readonly agregadoCode?: string;
}

export interface HardwareKitPlanDesignEntry {
  readonly slot: HardwareKitDesignSlot;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly memberId: string;
  readonly membership: string;
  readonly placement: {
    readonly x: { readonly ref: 'min' | 'max'; readonly offsetMm: number };
    readonly y: { readonly ref: 'min'; readonly offsetMm: 0 };
    readonly z: { readonly ref: 'min'; readonly offsetMm: 0 };
  };
  /** True when a hardware with this code already exists → reuse, don't create. */
  readonly exists: boolean;
}

export interface HardwareKitPlan {
  readonly kit: {
    readonly code: string;
    readonly name: string;
    readonly unit: 'set';
    readonly costPerUnit: number;
    readonly exists: boolean;
  };
  readonly designs: readonly HardwareKitPlanDesignEntry[];
  readonly agregado: {
    readonly code: string;
    readonly name: string;
    readonly widthMm: number;
    readonly heightMm: number;
    readonly depthMm: number;
    readonly motion: 'translate';
  };
  /**
   * Non-null when the plan cannot execute: an agregado with the target code
   * already exists (fail-closed — silently reusing an agregado would hide the
   * user's own recipe).
   */
  readonly blockedCode: string | null;
}

export interface HardwareKitPlanExisting {
  readonly hardwareCodes: ReadonlySet<string>;
  readonly agregadoCodes: ReadonlySet<string>;
}

export function validateHardwareKitInput(input: HardwareKitPlanInput): void {
  if (!input.code.trim()) {
    throw new Error('El código del juego es obligatorio.');
  }
  if (!input.name.trim()) {
    throw new Error('El nombre del juego es obligatorio.');
  }
  if (!Number.isFinite(input.kitCostPerUnit) || input.kitCostPerUnit < 0) {
    throw new Error('El precio del juego debe ser un número mayor o igual a 0.');
  }
  for (const [label, value] of [
    ['ancho', input.widthMm],
    ['alto', input.heightMm],
    ['profundidad', input.depthMm],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`La ${label} de referencia debe ser un número positivo.`);
    }
  }
  for (const [label, value] of [
    ['offset de guías fijas', input.fixedOffsetMm],
    ['offset de correderas móviles', input.movingOffsetMm],
  ] as const) {
    if (!Number.isFinite(value) || Math.abs(value) > 100000) {
      throw new Error(`El ${label} debe ser un número finito y razonable.`);
    }
  }
}

export function planHardwareKit(
  input: HardwareKitPlanInput,
  existing: HardwareKitPlanExisting,
): HardwareKitPlan {
  validateHardwareKitInput(input);

  const kitCode = input.code.trim();
  const kitName = input.name.trim();
  const agregadoCode = (input.agregadoCode?.trim() || defaultAgregadoCode(kitCode));

  const designs: HardwareKitPlanDesignEntry[] = HARDWARE_KIT_SLOTS.map((slot) => {
    const offset =
      slot.membership === 'body' ? input.fixedOffsetMm : input.movingOffsetMm;
    const code = `${kitCode}${slot.suffix}`;
    return {
      slot: slot.slot,
      code,
      name: `${kitName} — ${slot.labelEs}`,
      role: slot.role,
      memberId: slot.memberId,
      membership: slot.membership,
      placement: {
        x: { ref: slot.anchorXRef, offsetMm: slot.offsetSign * offset },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      exists: existing.hardwareCodes.has(code),
    };
  });

  return {
    kit: {
      code: kitCode,
      name: kitName,
      unit: 'set',
      costPerUnit: input.kitCostPerUnit,
      exists: existing.hardwareCodes.has(kitCode),
    },
    designs,
    agregado: {
      code: agregadoCode,
      name: `Cajón ${kitName}`,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      depthMm: input.depthMm,
      motion: 'translate',
    },
    blockedCode: existing.agregadoCodes.has(agregadoCode) ? agregadoCode : null,
  };
}

/** Request the store executes: the plan input plus optional uploaded bindings. */
export interface HardwareKitCreateRequest {
  readonly input: HardwareKitPlanInput;
  readonly designs?: Partial<Record<HardwareKitDesignSlot, HardwareVisualAssetBinding>>;
}

export interface HardwareKitResult {
  readonly createdCodes: readonly string[];
  readonly reusedCodes: readonly string[];
  readonly agregadoCode: string;
  readonly agregadoId: string;
}
