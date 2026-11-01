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

export function defaultAgregadoCode(kitCode: string, labelEs = 'Cajón'): string {
  const suffixes: Record<string, string> = {
    Cajón: '-CAJON',
    Puerta: '-PUERTA',
    Frente: '-FRENTE',
  };
  return `${kitCode}${suffixes[labelEs] ?? '-ENSAMBLE'}`;
}

export interface HardwareKitPlanInput {
  /** Commercial kit code (e.g. HER-CORR-TEL-50). Design parts derive from it. */
  readonly code: string;
  readonly name: string;
  readonly kitCostPerUnit: number;
  /** Reference envelope of the generated agregado. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm: number;
  /**
   * Drawer-template offsets (#1416 legacy inputs): only the drawer
   * template's body/actor slots honor them; other templates use the
   * slot's own defaultOffsetMm.
   */
  readonly fixedOffsetMm?: number;
  readonly movingOffsetMm?: number;
  /** Agregado code; defaults per template. */
  readonly agregadoCode?: string;
  /** #1422 slice 2: plantilla del juego; default = cajón con correderas. */
  readonly templateId?: string;
}

export interface HardwareKitPlanDesignEntry {
  readonly slot: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly memberId: string;
  readonly membership: string;
  readonly placement: {
    readonly x: { readonly ref: 'min' | 'max' | 'center'; readonly offsetMm: number };
    readonly y: { readonly ref: 'min'; readonly offsetMm: 0 };
    readonly z: { readonly ref: 'min'; readonly offsetMm: 0 };
  };
  /** True when a hardware with this code already exists → reuse, don't create. */
  readonly exists: boolean;
}

/**
 * #1422 slice 2 — plantillas de juego declaradas: el asistente deja de
 * tener el template del cajón hardcodeado y arma los slots desde una
 * plantilla (membresía #1376, ancla y sufijo por slot; motion del
 * agregado). Una plantilla nueva (bisagra, jaladera, levantadza…) es DATO,
 * no código.
 */
export interface HardwareKitSlotTemplate {
  /** Stable slot key (file upload testid). */
  readonly slot: string;
  /** Rigid member id in the generated recipe (e2e/demo contract). */
  readonly memberId: string;
  /** Code suffix appended to the kit code. */
  readonly suffix: string;
  readonly labelEs: string;
  readonly role: string;
  readonly membership: string;
  readonly anchorXRef: 'min' | 'max' | 'center';
  readonly offsetSign: 1 | -1;
  readonly defaultOffsetMm: number;
}

export type HardwareKitTemplateMotion = 'translate' | 'rotate_left' | 'rotate_right' | 'none';

export interface HardwareKitTemplate {
  readonly id: string;
  /**
   * Workshop-facing code. Embedded templates omit it (their id is the
   * stable selector); persisted workshop templates carry it (unique per org).
   */
  readonly code?: string;
  readonly labelEs: string;
  readonly slots: readonly HardwareKitSlotTemplate[];
  /** Cinemática del agregado generado (presentationMotion del editor). */
  readonly motion: HardwareKitTemplateMotion;
  /** Prefijo del nombre del agregado generado («Cajón X», «Puerta X»…). */
  readonly agregadoLabelEs: string;
}

// --- #1422 slice 2: plantillas de juego editables por taller ---

export const KIT_TEMPLATE_MOTIONS: readonly HardwareKitTemplateMotion[] = [
  'translate',
  'rotate_left',
  'rotate_right',
  'none',
];

/** Same charset discipline as hardware profile codes (#912 twin). */
export const KIT_TEMPLATE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KIT_TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KIT_TEMPLATE_KEY_PATTERN = /^[a-z0-9_]{1,40}$/;
const KIT_TEMPLATE_ROLE_PATTERN = /^[a-z0-9_]{1,40}$/;
/** Appended to the kit code: kitCode + suffix must stay a valid hardware code. */
const KIT_TEMPLATE_SUFFIX_PATTERN = /^-[A-Za-z0-9._-]{1,15}$/;
/** #1376 membership vocabulary: the body stays, an actor:<identifier> moves. */
const KIT_TEMPLATE_ACTOR_MEMBERSHIP_PATTERN = /^actor:[a-z0-9_-]{1,32}$/;
export const KIT_TEMPLATE_MAX_SLOTS = 12;
export const KIT_TEMPLATE_MAX_OFFSET_MM = 100000;

export interface HardwareKitTemplateIssue {
  readonly code: 'KIT_TEMPLATE_INVALID';
  readonly message: string;
  readonly severity: 'error';
  readonly entityId: string;
  readonly path: string;
}

/**
 * Structural, fail-closed validation of a workshop kit template — twin of the
 * Go mirror (domain kit_template.go): identical messages and paths, one
 * shared fixture (contracts/kitTemplateValidation.contract.json). The UI and
 * API layers translate; the domain decision (pass/fail + field) is one
 * contract.
 */
export function validateHardwareKitTemplate(
  template: HardwareKitTemplate,
): readonly HardwareKitTemplateIssue[] {
  const issues: HardwareKitTemplateIssue[] = [];
  const add = (message: string, path: string) =>
    issues.push({ code: 'KIT_TEMPLATE_INVALID', message, severity: 'error', entityId: template.id, path });

  //typeof guards: from the wire a missing key is `undefined` — String
  // coercion would make "undefined" MATCH the key patterns, diverging from
  // the Go twin (zero value "" fails). Mirror Go: absent/mistyped = invalid.
  if (typeof template.id !== 'string' || !KIT_TEMPLATE_ID_PATTERN.test(template.id)) {
    add('kit template id must match ^[A-Za-z0-9_-]{1,64}$', 'id');
  }
  if (template.code !== undefined && !KIT_TEMPLATE_CODE_PATTERN.test(template.code)) {
    add('kit template code must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', 'code');
  }
  if (typeof template.labelEs !== 'string' || template.labelEs === '') {
    add('kit template needs a non-blank labelEs', 'labelEs');
  }
  if (typeof template.agregadoLabelEs !== 'string' || template.agregadoLabelEs === '') {
    add('kit template needs a non-blank agregadoLabelEs', 'agregadoLabelEs');
  }
  if (!KIT_TEMPLATE_MOTIONS.includes(template.motion)) {
    add(
      `kit template motion must be one of ${KIT_TEMPLATE_MOTIONS.join(', ')}`,
      'motion',
    );
  }
  if (template.slots.length === 0) {
    add('kit template needs at least one slot', 'slots');
    return issues;
  }
  if (template.slots.length > KIT_TEMPLATE_MAX_SLOTS) {
    add(`kit template carries more than ${KIT_TEMPLATE_MAX_SLOTS} slots`, 'slots');
    return issues;
  }

  const seenSlots = new Set<string>();
  const seenMembers = new Set<string>();
  const seenSuffixes = new Set<string>();
  template.slots.forEach((slot, index) => {
    const path = `slots[${index}]`;
    // typeof guards mirror the Go zero-value semantics (see note above).
    if (typeof slot.slot !== 'string' || !KIT_TEMPLATE_KEY_PATTERN.test(slot.slot)) {
      add('kit template slot key must match ^[a-z0-9_]{1,40}$', `${path}.slot`);
    } else if (seenSlots.has(slot.slot)) {
      add(`slot ${slot.slot} appears more than once`, `${path}.slot`);
    }
    seenSlots.add(slot.slot as string);
    if (typeof slot.memberId !== 'string' || !KIT_TEMPLATE_KEY_PATTERN.test(slot.memberId)) {
      add('kit template member id must match ^[a-z0-9_]{1,40}$', `${path}.memberId`);
    } else if (seenMembers.has(slot.memberId)) {
      add(`member ${slot.memberId} appears more than once: recipe identity would collide`, `${path}.memberId`);
    }
    seenMembers.add(slot.memberId as string);
    if (typeof slot.suffix !== 'string' || !KIT_TEMPLATE_SUFFIX_PATTERN.test(slot.suffix)) {
      add('kit template slot suffix must match ^-[A-Za-z0-9._-]{1,15}$', `${path}.suffix`);
    } else if (seenSuffixes.has(slot.suffix)) {
      add(`suffix ${slot.suffix} appears more than once: part codes would collide`, `${path}.suffix`);
    }
    seenSuffixes.add(slot.suffix as string);
    if (typeof slot.labelEs !== 'string' || slot.labelEs === '') {
      add('kit template slot needs a non-blank labelEs', `${path}.labelEs`);
    }
    if (typeof slot.role !== 'string' || !KIT_TEMPLATE_ROLE_PATTERN.test(slot.role)) {
      add('kit template slot role must match ^[a-z0-9_]{1,40}$', `${path}.role`);
    }
    if (typeof slot.membership !== 'string' || (slot.membership !== 'body' && !KIT_TEMPLATE_ACTOR_MEMBERSHIP_PATTERN.test(slot.membership))) {
      add('kit template slot membership must be body or actor:<identifier>', `${path}.membership`);
    }
    if (slot.anchorXRef !== 'min' && slot.anchorXRef !== 'max' && slot.anchorXRef !== 'center') {
      add('kit template slot anchorXRef must be min, max or center', `${path}.anchorXRef`);
    }
    if (slot.offsetSign !== 1 && slot.offsetSign !== -1) {
      add('kit template slot offsetSign must be 1 or -1', `${path}.offsetSign`);
    }
    if (
      !Number.isFinite(slot.defaultOffsetMm) ||
      Math.abs(slot.defaultOffsetMm) > KIT_TEMPLATE_MAX_OFFSET_MM
    ) {
      add(
        `kit template slot offset must be a finite number within ±${KIT_TEMPLATE_MAX_OFFSET_MM} mm`,
        `${path}.defaultOffsetMm`,
      );
    }
  });
  return issues;
}

export const HARDWARE_KIT_TEMPLATES: readonly HardwareKitTemplate[] = [
  {
    id: 'drawer-slides',
    labelEs: 'Cajón con correderas (4 partes)',
    motion: 'translate',
    agregadoLabelEs: 'Cajón',
    slots: HARDWARE_KIT_SLOTS.map((s) => ({
      slot: s.slot,
      memberId: s.memberId,
      suffix: s.suffix,
      labelEs: s.labelEs,
      role: s.role,
      membership: s.membership,
      anchorXRef: s.anchorXRef,
      offsetSign: s.offsetSign,
      defaultOffsetMm: s.membership === 'body'
        ? DEFAULT_FIXED_OFFSET_MM
        : DEFAULT_MOVING_OFFSET_MM,
    })),
  },
  {
    id: 'hinge',
    labelEs: 'Bisagra (2 partes: copa fija + brazo móvil)',
    motion: 'rotate_left',
    agregadoLabelEs: 'Puerta',
    slots: [
      {
        slot: 'cup_fixed',
        memberId: 'hinge_cup',
        suffix: '-COPA',
        labelEs: 'Copa (fija al mueble)',
        role: 'hinge_cup',
        membership: 'body',
        anchorXRef: 'min',
        offsetSign: 1,
        defaultOffsetMm: 0,
      },
      {
        slot: 'arm_moving',
        memberId: 'hinge_arm',
        suffix: '-BRAZO',
        labelEs: 'Brazo (móvil de la puerta)',
        role: 'hinge_arm',
        membership: 'actor:door',
        anchorXRef: 'min',
        offsetSign: 1,
        defaultOffsetMm: 0,
      },
    ],
  },
  {
    id: 'handle',
    labelEs: 'Jaladera (1 pieza, sin apertura)',
    motion: 'none',
    agregadoLabelEs: 'Frente',
    slots: [
      {
        slot: 'handle',
        memberId: 'handle',
        suffix: '-PIEZA',
        labelEs: 'Jaladera',
        role: 'handle',
        membership: 'body',
        anchorXRef: 'min',
        offsetSign: 1,
        defaultOffsetMm: 0,
      },
    ],
  },
];

export function hardwareKitTemplateById(
  id: string,
  customTemplates: readonly HardwareKitTemplate[] = [],
): HardwareKitTemplate {
  const embedded = HARDWARE_KIT_TEMPLATES.find((t) => t.id === id);
  if (embedded) return embedded;
  // Workshop template: validated fail-closed at RESOLVE time, never trusted
  // from the wire — a broken custom template must not reach the plan.
  const custom = customTemplates.find((t) => t.id === id);
  if (custom) {
    const issues = validateHardwareKitTemplate(custom);
    if (issues.length > 0) {
      throw new Error(`Plantilla de juego inválida (${issues[0]!.path}): ${issues[0]!.message}`);
    }
    return custom;
  }
  throw new Error(`Plantilla de juego desconocida: «${id}».`);
}

/** La plantilla por defecto (cajón) mantiene el comportamiento de #1416. */
export const DEFAULT_KIT_TEMPLATE_ID = 'drawer-slides';

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
    readonly motion: HardwareKitTemplate['motion'];
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

export function validateHardwareKitInput(
  input: HardwareKitPlanInput,
  customTemplates: readonly HardwareKitTemplate[] = [],
): void {
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
    if (value !== undefined && (!Number.isFinite(value) || Math.abs(value) > 100000)) {
      throw new Error(`El ${label} debe ser un número finito y razonable.`);
    }
  }
  if (input.templateId !== undefined) {
    hardwareKitTemplateById(input.templateId, customTemplates);
  }
}

export function planHardwareKit(
  input: HardwareKitPlanInput,
  existing: HardwareKitPlanExisting,
  customTemplates: readonly HardwareKitTemplate[] = [],
): HardwareKitPlan {
  validateHardwareKitInput(input, customTemplates);

  const kitCode = input.code.trim();
  const kitName = input.name.trim();
  const template = hardwareKitTemplateById(
    input.templateId ?? DEFAULT_KIT_TEMPLATE_ID,
    customTemplates,
  );
  const isDrawer = template.id === DEFAULT_KIT_TEMPLATE_ID;
  const agregadoCode =
    input.agregadoCode?.trim() || defaultAgregadoCode(kitCode, template.agregadoLabelEs);

  const designs: HardwareKitPlanDesignEntry[] = template.slots.map((slot) => {
    // Los offsets del input solo aplican al template del cajón (compat #1416);
    // el resto de plantillas usa el default del slot.
    const legacyOffset =
      slot.membership === 'body' ? input.fixedOffsetMm : input.movingOffsetMm;
    const offset = isDrawer && legacyOffset !== undefined ? legacyOffset : slot.defaultOffsetMm;
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
      name: `${template.agregadoLabelEs} ${kitName}`,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      depthMm: input.depthMm,
      motion: template.motion,
    },
    blockedCode: existing.agregadoCodes.has(agregadoCode) ? agregadoCode : null,
  };
}

/** Request the store executes: the plan input plus optional uploaded bindings. */
export interface HardwareKitCreateRequest {
  readonly input: HardwareKitPlanInput;
  readonly designs?: Record<string, HardwareVisualAssetBinding>;
}

export interface HardwareKitResult {
  readonly createdCodes: readonly string[];
  readonly reusedCodes: readonly string[];
  readonly agregadoCode: string;
  readonly agregadoId: string;
}

/**
 * #1422 slice 1: validates a kit↔design-part link. `catalogHardware` is the
 * organization's hardware catalog (or the relevant subset the caller
 * loaded): the kit must exist, never be self, and never itself be a part
 * (a kit is never a part of another kit).
 */
export function validateHardwareKitLink(
  selfId: string,
  kitHardwareId: string,
  catalogHardware: readonly { readonly id: string; readonly code: string; readonly kitHardwareId?: string }[],
): void {
  if (!kitHardwareId.trim()) {
    throw new Error('El kit del herraje no puede estar vacío.');
  }
  if (kitHardwareId === selfId) {
    throw new Error('Un herraje no puede ser parte de sí mismo.');
  }
  const kit = catalogHardware.find((h) => h.id === kitHardwareId);
  if (!kit) {
    throw new Error('El kit del herraje no existe en este taller.');
  }
  if (kit.kitHardwareId) {
    throw new Error(`«${kit.code}» ya es parte de otro juego: un juego no puede ser parte de otro.`);
  }
}

/**
 * Sincroniza un Agregado con la lista efectiva de partes vinculadas a su Kit (#1422 / #1435).
 * - Preserva los miembros rígidos existentes.
 * - Si una parte vinculada no tiene miembro en la receta, infiere un slot predeterminado
 *   (lado izquierdo/derecho por sufijo o nombre, fija al cuerpo o móvil si es corredera/brazo).
 * - Si una parte ya no está vinculada, remueve su miembro de la receta.
 */
export function syncAgregadoWithKitParts(
  agregado: { readonly id: string; readonly code: string; readonly commercialKitHardwareId?: string; readonly rigidMembers?: readonly any[] },
  kitParts: readonly { readonly id: string; readonly code: string; readonly name: string; readonly previewShape?: string }[],
): any {
  const currentMembers = agregado.rigidMembers ?? [];
  const partIds = new Set(kitParts.map((p) => p.id));

  // 1. Filtrar miembros de partes que ya no pertenecen al kit
  const keptMembers = currentMembers.filter((m) => {
    const hwId = m.source?.fixed?.hardwareId;
    if (!hwId) return true;
    return partIds.has(hwId);
  });

  const existingHwIds = new Set(
    keptMembers.map((m) => m.source?.fixed?.hardwareId).filter(Boolean),
  );

  // 2. Para cada parte del kit que no esté en la receta, inferir un slot inicial
  const newMembers: any[] = [];
  for (const part of kitParts) {
    if (existingHwIds.has(part.id)) continue;

    const isRight = /-D\b|der|derech/i.test(part.code) || /derech/i.test(part.name);
    const isMoving = /-MOV\b|mov|móvil|brazo/i.test(part.code) || /móvil|brazo/i.test(part.name);
    const isCenter = /centr/i.test(part.code) || /centr/i.test(part.name) || /jaladera|tirador/i.test(part.name);

    const anchorXRef = isCenter ? 'center' : isRight ? 'max' : 'min';
    const offsetSign = isRight ? -1 : 1;
    const actorMembership = isMoving
      ? (agregado.code.includes('PUERTA') ? 'actor:door' : 'actor:drawer')
      : 'body';

    const safeMemberId = `part_${part.code.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

    newMembers.push({
      memberId: safeMemberId,
      role: part.previewShape || 'part',
      source: { kind: 'fixed', fixed: { hardwareId: part.id } },
      placement: {
        x: { ref: anchorXRef, offsetMm: offsetSign * 10 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole: 'included_in_kit',
      actorMembership,
    });
  }

  return {
    ...agregado,
    rigidMembers: [...keptMembers, ...newMembers],
  };
}
