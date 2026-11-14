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
import type { RigidMemberHand } from './agregadoAssembly';

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

export const DEFAULT_FIXED_OFFSET_MM = 0;
export const DEFAULT_MOVING_OFFSET_MM = 0;

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

/** #1512 S2b: un slot dentro de un grupo multi-diseño (miembro con mano). */
export interface HardwareKitPlanHandsPart {
  /** Slot key — the wizard's upload key for THIS hand's SKP. */
  readonly slot: string;
  readonly hand: RigidMemberHand;
  readonly memberId: string;
  readonly role: string;
  readonly membership: string;
  /** Signed offset in mm; the X ref derives from the hand (EffectivePlacement). */
  readonly offsetMm: number;
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
  /**
   * #1512 S2b: presente SOLO en un grupo multi-diseño — la fila compartida
   * lleva hands (asset por mano) y la receta genera un miembro por parte con
   * `hand` y ref X vacía (el default por mano deriva el anclaje). Ausente =
   * parte legacy de 1 hardware por slot.
   */
  readonly handsParts?: readonly HardwareKitPlanHandsPart[];
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
  /**
   * #1512 S2b (built-in templates only): la mano del miembro dentro de su
   * grupo multi-diseño. Los slots con el MISMO partGroup producen UNA fila
   * de catálogo con hands (el SKP de cada slot se vincula como la mano).
   */
  readonly hand?: RigidMemberHand;
  readonly partGroup?: string;
}

export type HardwareKitTemplateMotion = 'translate' | 'rotate_left' | 'rotate_right' | 'none';

/** #1512 S2b: metadata de un grupo multi-diseño (una fila con hands). */
export interface HardwareKitPartGroupInfo {
  /** Group key shared by the grouped slots. */
  readonly group: string;
  /** Code suffix of the SHARED hardware (kitCode + suffix). */
  readonly codeSuffix: string;
  /** Workshop-facing label of the shared hardware. */
  readonly labelEs: string;
}

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
  /**
   * #1512 S2b: grupos multi-diseño (v1 BUILT-IN only — la validación de
   * plantillas del taller rechaza hand/partGroup; el plan agrupa por estos).
   * El orden declara el orden de las filas generadas.
   */
  readonly partGroups?: readonly HardwareKitPartGroupInfo[];
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
  // #1512 S2b v1: partGroups es built-in only (ver el guard de slots más
  // abajo) — una plantilla del taller con grouping falla cerrado.
  if (template.partGroups !== undefined) {
    add('kit templates cannot declare partGroups: multi-design grouping is built-in only (v1)', 'partGroups');
  }

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
    // #1512 S2b v1: la agrupación multi-diseño es BUILT-IN only — una
    // plantilla del taller con hand/partGroup/partGroups falla cerrado (el
    // plan agrupado exige metadatos que el taller aún no autoría).
    if (slot.hand !== undefined || slot.partGroup !== undefined) {
      add('kit template slots cannot declare hand/partGroup: multi-design grouping is built-in only (v1)', `${path}.hand`);
    }
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

/**
 * #1512 S2b: cajón multi-diseño — los perfiles fijo y móvil son UNA fila de
 * catálogo cada uno con hands (asset por mano), en vez de 4 filas -I/-D.
 * Built-in only: la validación de plantillas del taller rechaza
 * hand/partGroup (v1).
 */
export const KIT_TEMPLATE_DRAWER_HANDS_ID = 'drawer-hands';

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
  {
    // #1512 S2b: mismo cajón que 'drawer-slides' pero los perfiles fijo y
    // móvil son UNA fila cada uno con hands (asset por lado) — 2 filas en
    // vez de 4. La ref X del miembro va vacía: el default por mano deriva.
    id: KIT_TEMPLATE_DRAWER_HANDS_ID,
    labelEs: 'Cajón multi-diseño (par D/I — 2 filas)',
    motion: 'translate',
    agregadoLabelEs: 'Cajón',
    partGroups: [
      { group: 'fixed', codeSuffix: '-FIJ', labelEs: 'Perfil fijo' },
      { group: 'moving', codeSuffix: '-MOV', labelEs: 'Perfil móvil' },
    ],
    slots: [
      {
        slot: 'fixed_left',
        memberId: 'fixed_rail_left',
        suffix: '-FIJ-I',
        labelEs: 'Perfil fijo — mano izquierda',
        role: 'fixed_rail',
        membership: 'body',
        anchorXRef: 'min',
        offsetSign: 1,
        defaultOffsetMm: 0,
        hand: 'left',
        partGroup: 'fixed',
      },
      {
        slot: 'fixed_right',
        memberId: 'fixed_rail_right',
        suffix: '-FIJ-D',
        labelEs: 'Perfil fijo — mano derecha',
        role: 'fixed_rail',
        membership: 'body',
        anchorXRef: 'max',
        offsetSign: -1,
        defaultOffsetMm: 0,
        hand: 'right',
        partGroup: 'fixed',
      },
      {
        slot: 'moving_left',
        memberId: 'moving_rail_left',
        suffix: '-MOV-I',
        labelEs: 'Perfil móvil — mano izquierda',
        role: 'moving_rail',
        membership: 'actor:drawer',
        anchorXRef: 'min',
        offsetSign: 1,
        defaultOffsetMm: 0,
        hand: 'left',
        partGroup: 'moving',
      },
      {
        slot: 'moving_right',
        memberId: 'moving_rail_right',
        suffix: '-MOV-D',
        labelEs: 'Perfil móvil — mano derecha',
        role: 'moving_rail',
        membership: 'actor:drawer',
        anchorXRef: 'max',
        offsetSign: -1,
        defaultOffsetMm: 0,
        hand: 'right',
        partGroup: 'moving',
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
  // #1512 S2b: la plantilla hands es también un cajón — los offsets legacy
  // del input aplican igual (compat #1416).
  const isDrawer = template.id === DEFAULT_KIT_TEMPLATE_ID || template.id === KIT_TEMPLATE_DRAWER_HANDS_ID;
  const agregadoCode =
    input.agregadoCode?.trim() || defaultAgregadoCode(kitCode, template.agregadoLabelEs);

  const designs: HardwareKitPlanDesignEntry[] = template.partGroups
    ? // #1512 S2b: un GRUPO multi-diseño = UNA fila de catálogo con hands.
      // La ref X del miembro va vacía — el default por mano (EffectivePlacement)
      // deriva el anclaje; el offset del slot viaja firmado.
      template.partGroups.map((group) => {
        const slots = template.slots.filter((s) => s.partGroup === group.group);
        if (slots.length === 0) {
          throw new Error(`Plantilla ${template.id}: el grupo «${group.group}» no tiene slots.`);
        }
        const code = `${kitCode}${group.codeSuffix}`;
        const handsParts = slots.map((slot) => {
          const legacyOffset =
            slot.membership === 'body' ? input.fixedOffsetMm : input.movingOffsetMm;
          const offset = isDrawer && legacyOffset !== undefined ? legacyOffset : slot.defaultOffsetMm;
          return {
            slot: slot.slot,
            hand: slot.hand as RigidMemberHand,
            memberId: slot.memberId,
            role: slot.role,
            membership: slot.membership,
            offsetMm: slot.offsetSign * offset === 0 ? 0 : slot.offsetSign * offset,
          };
        });
        return {
          slot: `group:${group.group}`,
          code,
          name: `${kitName} — ${group.labelEs}`,
          role: slots[0]!.role,
          memberId: slots[0]!.memberId,
          membership: slots[0]!.membership,
          placement: {
            x: { ref: slots[0]!.anchorXRef, offsetMm: slots[0]!.offsetSign * slots[0]!.defaultOffsetMm === 0 ? 0 : slots[0]!.offsetSign * slots[0]!.defaultOffsetMm },
            y: { ref: 'min', offsetMm: 0 },
            z: { ref: 'min', offsetMm: 0 },
          },
          exists: existing.hardwareCodes.has(code),
          handsParts,
        };
      })
    : template.slots.map((slot) => {
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
            x: { ref: slot.anchorXRef, offsetMm: slot.offsetSign * offset === 0 ? 0 : slot.offsetSign * offset },
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
 * #1506 kit opaco: una parte de diseño (kitHardwareId) nunca es elegible por
 * sí sola — el kit es la única unidad comprable/de autoría (#1436, decisión
 * owner 10-31). Todo picker o lista que ofrezca herrajes del catálogo excluye
 * las partes con esta regla única; sólo el editor del kit, la búsqueda
 * explícita en la lista Herrajes y la explosión BOM/CNC las conservan.
 */
export function isHardwareKitPart(h: { readonly kitHardwareId?: string }): boolean {
  return Boolean(h.kitHardwareId);
}

export interface KitPartPlacementConfig {
  readonly actorMembership: string;
  readonly xRef: 'min' | 'max' | 'center';
  readonly xOffsetMm: number;
  readonly yOffsetMm: number;
  readonly zOffsetMm: number;
}

const KIT_PART_POS_PREFIX = 'pos:';

export function formatKitPartPlacementLabel(
  cfg: Pick<KitPartPlacementConfig, 'xRef' | 'xOffsetMm' | 'yOffsetMm' | 'zOffsetMm'>,
): string {
  const xOff = Number.isFinite(cfg.xOffsetMm) ? cfg.xOffsetMm || 0 : 0;
  const yOff = Number.isFinite(cfg.yOffsetMm) ? cfg.yOffsetMm || 0 : 0;
  const zOff = Number.isFinite(cfg.zOffsetMm) ? cfg.zOffsetMm || 0 : 0;
  return `${KIT_PART_POS_PREFIX}${cfg.xRef}:${xOff}:${yOff}:${zOff}`;
}

export function parseKitPartPlacementLabel(
  label: string | undefined,
): Pick<KitPartPlacementConfig, 'xRef' | 'xOffsetMm' | 'yOffsetMm' | 'zOffsetMm'> | null {
  if (!label || !label.startsWith(KIT_PART_POS_PREFIX)) return null;
  const parts = label.slice(KIT_PART_POS_PREFIX.length).split(':');
  if (parts.length !== 4) return null;
  const [rawRef, rawX, rawY, rawZ] = parts;
  if (rawRef !== 'min' && rawRef !== 'max' && rawRef !== 'center') return null;
  const xOffsetMm = Number(rawX);
  const yOffsetMm = Number(rawY);
  const zOffsetMm = Number(rawZ);
  if (!Number.isFinite(xOffsetMm) || !Number.isFinite(yOffsetMm) || !Number.isFinite(zOffsetMm)) {
    return null;
  }
  return { xRef: rawRef, xOffsetMm, yOffsetMm, zOffsetMm };
}

export function inferDefaultKitPartConfig(
  part: { readonly code: string; readonly name: string; readonly previewShape?: string },
  agregadoCode = '',
): KitPartPlacementConfig {
  const isRight = /-D\b|der|derech/i.test(part.code) || /derech/i.test(part.name);
  const isMoving = /-MOV\b|mov|móvil|movil|brazo/i.test(part.code) || /móvil|movil|brazo/i.test(part.name);
  const isCenter = /centr/i.test(part.code) || /centr/i.test(part.name) || /jaladera|tirador/i.test(part.name);
  const isDoor =
    agregadoCode.toUpperCase().includes('PUERTA') ||
    agregadoCode.toUpperCase().includes('PUE') ||
    /puerta|bisagra|-copa|-brazo/i.test(`${part.code} ${part.name}`) ||
    part.previewShape === 'hinge';

  const xRef: 'min' | 'max' | 'center' = isCenter ? 'center' : isRight ? 'max' : 'min';
  const offsetSign = isRight ? -1 : 1;
  const actorMembership = isMoving
    ? isDoor
      ? 'actor:door'
      : 'actor:drawer'
    : 'body';
  const baseOffset = 0;

  return {
    actorMembership,
    xRef,
    xOffsetMm: baseOffset === 0 ? 0 : offsetSign * baseOffset,
    yOffsetMm: 0,
    zOffsetMm: 0,
  };
}

export function resolveKitPartConfig(
  part: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly previewShape?: string;
    readonly designParts?: readonly { readonly componentName: string; readonly actorMembership: string; readonly label?: string }[];
  },
  agregado?: { readonly code?: string; readonly rigidMembers?: readonly any[] } | null,
): KitPartPlacementConfig {
  const fallback = inferDefaultKitPartConfig(part, agregado?.code ?? '');
  const dp = part.designParts?.[0];
  const parsedLabel = parseKitPartPlacementLabel(dp?.label);
  const member = part.id
    ? agregado?.rigidMembers?.find((m) => m.source?.fixed?.hardwareId === part.id)
    : undefined;

  const actorMembership =
    (dp?.actorMembership && dp.actorMembership.trim()) ||
    (member?.actorMembership && String(member.actorMembership).trim()) ||
    fallback.actorMembership;

  const memberXRef = member?.placement?.x?.ref;
  const xRef: 'min' | 'max' | 'center' =
    parsedLabel?.xRef ??
    (memberXRef === 'min' || memberXRef === 'max' || memberXRef === 'center'
      ? memberXRef
      : fallback.xRef);

  const xOffsetMm =
    parsedLabel?.xOffsetMm ??
    (typeof member?.placement?.x?.offsetMm === 'number' && Number.isFinite(member.placement.x.offsetMm)
      ? member.placement.x.offsetMm
      : fallback.xOffsetMm);

  const yOffsetMm =
    parsedLabel?.yOffsetMm ??
    (typeof member?.placement?.y?.offsetMm === 'number' && Number.isFinite(member.placement.y.offsetMm)
      ? member.placement.y.offsetMm
      : fallback.yOffsetMm);

  const zOffsetMm =
    parsedLabel?.zOffsetMm ??
    (typeof member?.placement?.z?.offsetMm === 'number' && Number.isFinite(member.placement.z.offsetMm)
      ? member.placement.z.offsetMm
      : fallback.zOffsetMm);

  return {
    actorMembership,
    xRef,
    xOffsetMm,
    yOffsetMm,
    zOffsetMm,
  };
}

/**
 * #1613: ids de herraje que son MIEMBROS de un grupo de opciones accesorio
 * linkeado al kit (Galería/Boxcap/Boxcover). Esas piezas son elecciones
 * consumibles (resueltas por bahía vía resolveAccessoryAssemblies) — el sync
 * del kit nunca las materializa como partes fijas, o cada bahía dibuja el
 * set completo de insertos además del elegido. Espejo de
 * accessoryKitMemberHardwareIDs en accessory_kit.go.
 */
export function accessoryKitMemberHardwareIds(
  hardware: readonly { readonly id: string; readonly active?: boolean }[] | undefined,
  optionGroups: readonly { readonly kind: string; readonly kitHardwareId?: string; readonly optionIds: readonly string[] }[] | undefined,
  kitId: string,
): Set<string> {
  const target = kitId.trim();
  const ids = new Set<string>();
  if (!target || !optionGroups || optionGroups.length === 0) return ids;
  for (const og of optionGroups) {
    if (og.kind !== 'hardware' || (og.kitHardwareId ?? '').trim() !== target) continue;
    for (const id of og.optionIds) {
      const trimmed = (id ?? '').trim();
      if (!trimmed) continue;
      // Un miembro inactivo nunca llegaría al sync (partes activas only),
      // pero el id manda: la exclusión es por membresía de grupo.
      if (hardware && hardware.length > 0 && !hardware.some((h) => h.id === trimmed)) continue;
      ids.add(trimmed);
    }
  }
  return ids;
}

/**
 * La ÚNICA regla que decide qué accesorio monta una bahía para un grupo
 * vinculado a su kit (layout, cotización y gates de la web): la elección
 * explícita cuando existe — devuelta tal cual, quien llama valida la
 * membresía y reporta la inválida — y, sin elección, la PRIMERA opción
 * activa del grupo en el orden declarado (decisión del owner 2026-11-13,
 * sustituye «sólo elección explícita» de #1555). Vacío sólo cuando el grupo
 * no tiene ninguna opción activa. Espejo de effectiveAccessoryChoice en
 * accessory_kit.go.
 */
export function effectiveAccessoryChoice(
  og: { readonly code: string; readonly optionIds: readonly string[] },
  hardware: readonly { readonly id: string; readonly active?: boolean }[] | undefined,
  optionChoices: Readonly<Record<string, string | undefined>> | undefined,
): string {
  const explicit = (optionChoices?.[og.code] ?? '').trim();
  if (explicit) return explicit;
  for (const id of og.optionIds) {
    const trimmed = (id ?? '').trim();
    if (trimmed && (hardware ?? []).some((h) => h.id === trimmed && h.active)) return trimmed;
  }
  return '';
}

/**
 * Sincroniza un Agregado con la lista efectiva de partes vinculadas a su Kit (#1422 / #1435).
 * - Preserva los miembros rígidos existentes y actualiza su apertura/posición si la parte declara designParts[0].
 * - Si una parte vinculada no tiene miembro en la receta, infiere o toma su slot configurado.
 * - Si una parte ya no está vinculada, remueve su miembro de la receta.
 */
export function syncAgregadoWithKitParts(
  agregado: { readonly id: string; readonly code: string; readonly commercialKitHardwareId?: string; readonly rigidMembers?: readonly any[] },
  kitParts: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly previewShape?: string;
    readonly designParts?: readonly { readonly componentName: string; readonly actorMembership: string; readonly label?: string }[];
    readonly pieces?: readonly {
      readonly anchor: 'left' | 'right' | 'center';
      readonly offsetMm?: { readonly x: number; readonly y: number; readonly z: number };
    }[];
  }[],
  /** #1613: ids de piezas-inserto (miembros de grupos accesorios del kit) —
   * nunca se materializan como partes fijas. */
  excludedHardwareIds?: ReadonlySet<string>,
): any {
  const effectiveParts = excludedHardwareIds
    ? kitParts.filter((p) => !excludedHardwareIds.has(p.id))
    : kitParts;
  const currentMembers = agregado.rigidMembers ?? [];
  const partById = new Map(effectiveParts.map((p) => [p.id, p] as const));

  // 1. Filtrar miembros de partes que ya no pertenecen al kit y sincronizar cambios explícitos
  const keptMembers = currentMembers
    .filter((m) => {
      const hwId = m.source?.fixed?.hardwareId;
      if (!hwId) return true;
      return partById.has(hwId);
    })
    .map((m) => {
      const hwId = m.source?.fixed?.hardwareId;
      const part = hwId ? partById.get(hwId) : undefined;
      if (!part) return m;
      const dp = part.designParts?.[0];
      const nextActor = dp?.actorMembership?.trim() || m.actorMembership;
      // #1518 F1: piezas multi-diseño NUNCA toman el pos: override — cada
      // pieza declara su placement en el catálogo; el label único aplastaba
      // ambos lados al mismo X (SKPs superpuestos).
      const isMultiPiece = (part.pieces?.length ?? 0) > 0;
      // #1613 (owner): el miembro YA guardado se REFRESCA desde SU pieza en
      // cada sync — la colocación persistida quedaba congelada y el dibujo
      // ignoraba para siempre los offsets editados en el catálogo (y=0
      // eterno). Mismo placement que produce una materialización fresca.
      if (isMultiPiece) {
        const piece = m.hand ? part.pieces?.find((pc) => pc.anchor === m.hand) : undefined;
        if (!piece) return nextActor ? { ...m, actorMembership: nextActor } : m;
        return {
          ...m,
          actorMembership: nextActor,
          placement: withAuthoredRotation(pieceAnchorPlacement(piece), m.placement),
        };
      }
      if (!dp) return nextActor ? { ...m, actorMembership: nextActor } : m;
      const parsedPos = parseKitPartPlacementLabel(dp.label);
      if (!parsedPos) {
        return nextActor ? { ...m, actorMembership: nextActor } : m;
      }
      return {
        ...m,
        actorMembership: nextActor,
        placement: {
          ...(m.placement ?? {}),
          x: { ...(m.placement?.x ?? {}), ref: parsedPos.xRef, offsetMm: parsedPos.xOffsetMm },
          y: { ...(m.placement?.y ?? {}), ref: m.placement?.y?.ref ?? 'min', offsetMm: parsedPos.yOffsetMm },
          z: { ...(m.placement?.z ?? {}), ref: m.placement?.z?.ref ?? 'min', offsetMm: parsedPos.zOffsetMm },
        },
      };
    });

  const existingHwIds = new Set(
    keptMembers.map((m) => m.source?.fixed?.hardwareId).filter(Boolean),
  );

  // 2. Para cada parte del kit que no esté en la receta, usar su configuración o inferir un slot inicial
  const newMembers: any[] = [];
  for (const part of effectiveParts) {
    // #1518 F1: expansión POR ANCLA (ver ensureAgregadoKitParts).
    if (part.pieces && part.pieces.length > 0) {
      const presentAnchors = new Set(
        keptMembers
          .filter((m) => m.source?.fixed?.hardwareId === part.id && m.hand)
          .map((m) => m.hand),
      );
      const missing = part.pieces.filter((pc) => !presentAnchors.has(pc.anchor));
      if (missing.length === 0) continue;
      newMembers.push(
        ...newKitPartMembers(part, agregado).filter((m: any) => !presentAnchors.has(m.hand)),
      );
      continue;
    }
    if (existingHwIds.has(part.id)) continue;
    newMembers.push(...newKitPartMembers(part, agregado));
  }

  return {
    ...agregado,
    rigidMembers: [...keptMembers, ...newMembers],
  };
}

/**
 * #1512 M3: miembros NUEVOS de una parte de kit. Una parte multi-diseño
 * (hands con asset) expande a DOS miembros — uno por mano — compartiendo la
 * fila de catálogo; el anclaje X por defecto se deriva de la mano (left →
 * min/+; right → max/−), nunca de regex sobre el nombre. Legacy: 1 miembro
 * byte-idéntico (la inferencia por regex histórica queda intacta).
 */
/**
 * #1613 (owner): placement POR PIEZA — el único derivation para partes
 * multi-pieza, compartido por la materialización fresca (newKitPartMembers)
 * y el refresco de miembros YA guardados (syncAgregadoWithKitParts /
 * ensureAgregadoKitParts). SIN defaults: pieza sin offsetMm = offset 0 (el
 * registro manda; el ancla right niega: positivo = hacia adentro). Paridad
 * con kitPieceMember Go.
 */
/**
 * #1613 review r1 (confirmado por ambos jueces): la ROTACIÓN es dato AUTORADO
 * del miembro (Rotación avanzada del editor de recetas) — la pieza del
 * catálogo no puede re-expresarla, así que el refresco del placement la
 * conserva en vez de borrarla.
 */
function withAuthoredRotation(
  placement: {
    readonly x: { readonly ref: 'min' | 'max' | 'center'; readonly offsetMm: number };
    readonly y: { readonly ref: 'min'; readonly offsetMm: number };
    readonly z: { readonly ref: 'min'; readonly offsetMm: number };
  },
  stored?: { readonly rotationDeg?: { readonly x: number; readonly y: number; readonly z: number } } | null,
) {
  return stored?.rotationDeg != null
    ? { ...placement, rotationDeg: stored.rotationDeg }
    : placement;
}

function pieceAnchorPlacement(
  piece: {
    readonly anchor: 'left' | 'right' | 'center';
    readonly offsetMm?: { readonly x: number; readonly y: number; readonly z: number };
  },
): {
  readonly x: { readonly ref: 'min' | 'max' | 'center'; readonly offsetMm: number };
  readonly y: { readonly ref: 'min'; readonly offsetMm: number };
  readonly z: { readonly ref: 'min'; readonly offsetMm: number };
} {
  const xOff0 = piece.offsetMm ? piece.offsetMm.x : 0;
  // Normaliza −0 → +0 (Object.is de los tests distingue).
  const xOff = xOff0 === 0 || piece.anchor !== 'right' ? xOff0 : -xOff0;
  return {
    x: {
      ref: piece.anchor === 'right' ? 'max' : piece.anchor === 'center' ? 'center' : 'min',
      offsetMm: xOff,
    },
    y: { ref: 'min', offsetMm: piece.offsetMm ? piece.offsetMm.y : 0 },
    z: { ref: 'min', offsetMm: piece.offsetMm ? piece.offsetMm.z : 0 },
  };
}

function newKitPartMembers(
  part: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly previewShape?: string;
    readonly designParts?: readonly { readonly componentName: string; readonly actorMembership: string; readonly label?: string }[];
    readonly pieces?: readonly {
      readonly anchor: 'left' | 'right' | 'center';
      readonly asset?: { readonly assetId: string; readonly assetRevisionId: string };
      readonly offsetMm?: { readonly x: number; readonly y: number; readonly z: number };
    }[];
  },
  agregado: { readonly id: string; readonly code: string },
): any[] {
  const cfg = resolveKitPartConfig(part, agregado);
  const safeMemberId = `part_${part.code.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
  // #1518 F1 (was #1512): piezas del catálogo — un miembro POR pieza con el
  // placement derivado del ancla (left→min/+, right→max/−). El pos: label NO
  // aplica a partes multi-pieza (cada pieza declara sus offsets propios).
  if (part.pieces && part.pieces.length > 0) {
    return part.pieces.map((piece) => ({
      memberId: `${safeMemberId}_${piece.anchor}`,
      role: part.previewShape || 'part',
      source: { kind: 'fixed', fixed: { hardwareId: part.id } },
      placement: pieceAnchorPlacement(piece),
      bomRole: 'included_in_kit',
      actorMembership: cfg.actorMembership,
      hand: piece.anchor,
    }));
  }
  // Single/legacy: pos: label de DesignParts[0] sigue mandando (paridad Go).
  const parsedPos = part.designParts?.[0]?.label
    ? parseKitPartPlacementLabel(part.designParts[0]!.label)
    : null;
  const build = () => ({
    memberId: safeMemberId,
    role: part.previewShape || 'part',
    source: { kind: 'fixed', fixed: { hardwareId: part.id } },
    placement: {
      x: { ref: cfg.xRef, offsetMm: cfg.xOffsetMm },
      y: { ref: 'min', offsetMm: cfg.yOffsetMm },
      z: { ref: 'min', offsetMm: cfg.zOffsetMm },
    },
    bomRole: 'included_in_kit',
    actorMembership: cfg.actorMembership,
  });
  const base = build();
  if (!parsedPos) return [base];
  return [
    {
      ...base,
      placement: {
        x: { ...(base.placement?.x ?? {}), ref: parsedPos.xRef, offsetMm: parsedPos.xOffsetMm },
        y: { ...(base.placement?.y ?? {}), ref: base.placement?.y?.ref ?? 'min', offsetMm: parsedPos.yOffsetMm },
        z: { ...(base.placement?.z ?? {}), ref: base.placement?.z?.ref ?? 'min', offsetMm: parsedPos.zOffsetMm },
      },
    },
  ];
}

/**
 * #1493: reporta si una receta declara el kit dado vía variantSets (una
 * altura Blum MERIVOBOX N/M/K/E = un kit). Los kits declarados por variante
 * NO son el commercialKitHardwareId del agregado — viven en la variante.
 */
export function agregadoDeclaresKitViaVariant(
  agregado: {
    readonly variantSets?: readonly {
      readonly variants?: readonly { readonly commercialKitHardwareId?: string }[];
    }[];
  },
  kitId: string,
): boolean {
  const target = kitId.trim();
  if (!target) return false;
  return (agregado.variantSets ?? []).some((vs) =>
    (vs.variants ?? []).some((v) => (v.commercialKitHardwareId ?? '').trim() === target),
  );
}

/**
 * #1493: sync ADITIVO de partes de kit para recetas que referencian el kit
 * vía variantes. A diferencia de syncAgregadoWithKitParts (que espeja el kit
 * completo y REMUEVE miembros ajenos a él — correcto cuando el agregado tiene
 * UN solo kit), esta variante nunca elimina: actualiza la colocación/actor de
 * los miembros que ya referencian partes de ESTE kit y añade las que falten
 * como included_in_kit. Con kits múltiples por altura (N/M/K/E) remover
 * sería destructivo: el sync de un kit borraría las partes de otro.
 */
export function ensureAgregadoKitParts(
  agregado: { readonly id: string; readonly code: string; readonly rigidMembers?: readonly any[] },
  kitParts: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly previewShape?: string;
    readonly designParts?: readonly { readonly componentName: string; readonly actorMembership: string; readonly label?: string }[];
    readonly pieces?: readonly {
      readonly anchor: 'left' | 'right' | 'center';
      readonly offsetMm?: { readonly x: number; readonly y: number; readonly z: number };
    }[];
  }[],
  /** #1613: ids de piezas-inserto — nunca se materializan como partes fijas. */
  excludedHardwareIds?: ReadonlySet<string>,
): any {
  const effectiveParts = excludedHardwareIds
    ? kitParts.filter((p) => !excludedHardwareIds.has(p.id))
    : kitParts;
  const currentMembers = (agregado.rigidMembers ?? []).map((m) => {
    const hwId = m.source?.fixed?.hardwareId;
    const part = hwId ? kitParts.find((p) => p.id === hwId) : undefined;
    if (!part) return m;
    // Miembro de una parte de ESTE kit: refresca colocación/actor desde la parte.
    const dp = part.designParts?.[0];
    const nextActor = dp?.actorMembership?.trim() || m.actorMembership;
    // #1518 F1: piezas multi-diseño NUNCA toman el pos: override (el label
    // único aplastaba ambos lados al mismo X).
    const isMultiPiece = (part.pieces?.length ?? 0) > 0;
    // #1613 (owner): el miembro YA guardado se REFRESCA desde SU pieza en
    // cada sync — la colocación persistida quedaba congelada y el dibujo
    // ignoraba para siempre los offsets editados en el catálogo. Mismo
    // placement que produce una materialización fresca.
    if (isMultiPiece) {
      const piece = m.hand ? part.pieces?.find((pc) => pc.anchor === m.hand) : undefined;
      if (!piece) return nextActor ? { ...m, actorMembership: nextActor } : m;
      return {
        ...m,
        actorMembership: nextActor,
        placement: withAuthoredRotation(pieceAnchorPlacement(piece), m.placement),
      };
    }
    const parsedPos = dp ? parseKitPartPlacementLabel(dp.label) : undefined;
    if (!parsedPos) {
      return nextActor ? { ...m, actorMembership: nextActor } : m;
    }
    return {
      ...m,
      actorMembership: nextActor,
      placement: {
        ...(m.placement ?? {}),
        x: { ...(m.placement?.x ?? {}), ref: parsedPos.xRef, offsetMm: parsedPos.xOffsetMm },
        y: { ...(m.placement?.y ?? {}), ref: m.placement?.y?.ref ?? 'min', offsetMm: parsedPos.yOffsetMm },
        z: { ...(m.placement?.z ?? {}), ref: m.placement?.z?.ref ?? 'min', offsetMm: parsedPos.zOffsetMm },
      },
    };
  });

  const existingHwIds = new Set(currentMembers.map((m) => m.source?.fixed?.hardwareId).filter(Boolean));
  const newMembers: any[] = [];
  for (const part of effectiveParts) {
    // #1518 F1: piezas multi-diseño se expanden POR ANCLA — una parte con
    // sólo un lado presente agrega el faltante (el índice por herraje único
    // se lo tragaba).
    if (part.pieces && part.pieces.length > 0) {
      const presentAnchors = new Set(
        currentMembers
          .filter((m) => m.source?.fixed?.hardwareId === part.id && m.hand)
          .map((m) => m.hand),
      );
      const missing = part.pieces.filter((pc) => !presentAnchors.has(pc.anchor));
      if (missing.length === 0) continue;
      newMembers.push(
        ...newKitPartMembers(part, agregado).filter((m: any) => !presentAnchors.has(m.hand)),
      );
      continue;
    }
    if (existingHwIds.has(part.id)) continue;
    newMembers.push(...newKitPartMembers(part, agregado));
  }

  return {
    ...agregado,
    rigidMembers: [...currentMembers, ...newMembers],
  };
}

// ── #1546 M4: sistema generador de cajones (MERIVOBOX N/M/K/E + accesorios) ──

/** Altura Blum del sistema (#1546): autoridad numérica del fixture #1493. */
export interface HardwareKitSystemHeight {
  readonly code: 'N' | 'M' | 'K' | 'E';
  readonly labelEs: string;
  /** KH mínimo (espacio interior en mueble): 85.5 / 108 / 146 / 209. */
  readonly khMinMm: number;
  readonly include: boolean;
}

/** Accesorio del cajón E declarado en el sistema (#1519: galería/boxcap/boxcover). */
export interface HardwareKitSystemAccessory {
  /** Código del herraje accesorio generado: systemCode + '-' + suffix. */
  readonly suffix: string;
  readonly name: string;
  /** Anclas de las piezas del accesorio (típicamente left+right). */
  readonly anchors: readonly ('left' | 'right' | 'center')[];
  /**
   * #1596: offsets EXPLÍCITOS por pieza (decisión 2: el taller dibuja en
   * 0,0,0 y posiciona por offset). El motor honra el offset guardado; sin
   * offset la pieza queda en 0 (#1613: el motor no tiene defaults).
   */
  readonly pieceOffsets?: Readonly<Partial<Record<'left' | 'right' | 'center', { x: number; y: number; z: number }>>>;
  /**
   * #1596: «Al abrir» declarado (decisión 4): la declaración que el motor ya
   * lee (kitPieceMember → DesignParts[0].ActorMembership). En insertos viene
   * puesto en 'actor:drawer' (viaja con el cajón); nunca se infiere del nombre.
   */
  readonly actorMembership?: 'body' | 'actor:drawer' | 'actor:door';
}

export interface HardwareKitSystemInput {
  /** Código base del sistema (e.g. MBOX-IRIDIUN): kits = code-N/M/K/E. */
  readonly code: string;
  readonly name: string;
  readonly kitCostPerUnit: number;
  readonly widthMm: number;
  readonly depthMm: number;
  /** Alturas a incluir (del autoritario HARDWARE_KIT_SYSTEM_HEIGHTS). */
  readonly heights: readonly HardwareKitSystemHeight[];
  /** Accesorios del cajón E (vacío = sistema sin accesorios). */
  readonly accessoriesE?: readonly HardwareKitSystemAccessory[];
  readonly fixedOffsetMm?: number;
  readonly movingOffsetMm?: number;
}

/** Autoridad Blum de alturas (fixture merivobox-pilot-canonical.json #1493). */
export const HARDWARE_KIT_SYSTEM_HEIGHTS: readonly (HardwareKitSystemHeight & { include: boolean })[] = [
  { code: 'N', labelEs: 'N (85.5 mm — cubertero bajo)', khMinMm: 85.5, include: false },
  { code: 'M', labelEs: 'M (108 mm — estándar)', khMinMm: 108, include: true },
  { code: 'K', labelEs: 'K (146 mm — intermedio)', khMinMm: 146, include: false },
  { code: 'E', labelEs: 'E (209 mm — cacerolero)', khMinMm: 209, include: false },
];

export interface HardwareKitSystemPlan {
  /** Un kit multi-diseño por altura incluida (drawer-hands: FIJ + MOV). */
  readonly kits: readonly {
    readonly code: string;
    readonly name: string;
    readonly heightCode: string;
    readonly khMinMm: number;
    readonly exists: boolean;
    /** Filas multi-diseño del kit (FIJ/MOV, cada una con piezas por ancla). */
    readonly designs: readonly HardwareKitPlanDesignEntry[];
  }[];
  /** Herrajes accesorios del cajón E (cada uno con piezas por ancla). */
  readonly accessories: readonly {
    readonly code: string;
    readonly name: string;
    readonly exists: boolean;
    readonly anchors: readonly ('left' | 'right' | 'center')[];
    /** #1596: offsets explícitos y «Al abrir» declarado (ver input). */
    readonly pieceOffsets?: Readonly<Partial<Record<'left' | 'right' | 'center', { x: number; y: number; z: number }>>>;
    readonly actorMembership?: 'body' | 'actor:drawer' | 'actor:door';
  }[];
  /** Grupo de accesorios vinculado al kit E (solo si E incluida y hay accesorios). */
  readonly accessoryGroup: {
    readonly code: string;
    readonly name: string;
    readonly required: boolean;
    readonly kitCode: string;
    readonly optionIds: readonly string[];
  } | null;
  /** Un agregado con variantes de altura — el sync materializa por bahía. */
  readonly agregado: {
    readonly code: string;
    readonly name: string;
    readonly widthMm: number;
    readonly depthMm: number;
    /** Variante = KH mínimo de la altura (nominal del variant set). */
    readonly variants: readonly { readonly heightCode: string; readonly khMinMm: number; readonly kitCode: string }[];
    readonly motion: HardwareKitTemplate['motion'];
  };
  readonly blockedCode: string | null;
}

/**
 * #1546 M4: plan del SISTEMA de cajones — kits por altura (drawer-hands),
 * herrajes accesorios del E con piezas por ancla (F1), grupo de accesorios
 * vinculado al kit E (#1519) y UN agregado con variantes de altura (#1493)
 * cuya receta NO lleva miembros de kit fijos: el sync por bahía materializa
 * las partes del kit efectivo (cambiar la altura cambia kit y accesorios
 * coherentes). Código de kit: systemCode-ALTURA; accesorio: systemCode-E-SUFIX.
 */
export function planHardwareKitSystem(
  input: HardwareKitSystemInput,
  existing: HardwareKitPlanExisting,
): HardwareKitSystemPlan {
  const systemCode = input.code.trim();
  if (!systemCode) throw new Error('El código del sistema no puede estar vacío.');
  const systemName = input.name.trim();
  if (!systemName) throw new Error('El nombre del sistema no puede estar vacío.');

  const included = input.heights.filter((h) => h.include);
  if (included.length === 0) {
    throw new Error('Incluí al menos una altura (N/M/K/E) para el sistema.');
  }
  const seenHeights = new Set<string>();
  for (const h of included) {
    if (seenHeights.has(h.code)) {
      throw new Error(`Altura ${h.code} repetida en el sistema.`);
    }
    seenHeights.add(h.code);
  }

  const blockedCode = existing.agregadoCodes.has(`${systemCode}-CAJON`)
    ? `${systemCode}-CAJON`
    : null;

  const heightByCode = new Map(input.heights.map((h) => [h.code, h] as const));

  // Kits por altura — cada uno con la estructura drawer-hands (FIJ/MOV con
  // piezas por ancla), código systemCode-ALTURA.
  const kits = included.map((height) => {
    const code = `${systemCode}-${height.code}`;
    const subPlan = planHardwareKit(
      {
        code,
        name: `${systemName} ${height.code}`,
        kitCostPerUnit: input.kitCostPerUnit,
        widthMm: input.widthMm,
        heightMm: height.khMinMm,
        depthMm: input.depthMm,
        templateId: KIT_TEMPLATE_DRAWER_HANDS_ID,
        fixedOffsetMm: input.fixedOffsetMm,
        movingOffsetMm: input.movingOffsetMm,
      },
      existing,
    );
    return {
      code,
      name: `${systemName} ${height.code}`,
      heightCode: height.code,
      khMinMm: height.khMinMm,
      exists: subPlan.kit.exists,
      designs: subPlan.designs,
    };
  });

  // Accesorios del E (F1: herraje con piezas por ancla). Sólo si E incluida.
  const eKit = kits.find((k) => k.heightCode === 'E');
  const accessories = (eKit ? (input.accessoriesE ?? []) : []).map((acc) => ({
    code: `${systemCode}-E-${acc.suffix}`,
    name: `${systemName} E — ${acc.name}`,
    exists: existing.hardwareCodes.has(`${systemCode}-E-${acc.suffix}`),
    anchors: acc.anchors,
    ...(acc.pieceOffsets ? { pieceOffsets: acc.pieceOffsets } : {}),
    ...(acc.actorMembership ? { actorMembership: acc.actorMembership } : {}),
  }));

  // Grupo de accesorios del kit E — los herrajes accesorios como opciones.
  const accessoryGroup =
    eKit && accessories.length > 0
      ? {
          code: `${systemCode}_LATERAL_E`,
          name: 'Lateral superior E',
          required: false,
          kitCode: eKit.code,
          optionIds: accessories.map((a) => a.code),
        }
      : null;

  return {
    kits,
    accessories,
    accessoryGroup,
    agregado: {
      code: `${systemCode}-CAJON`,
      name: `Cajón ${systemName}`,
      widthMm: input.widthMm,
      depthMm: input.depthMm,
      variants: kits.map((k) => ({
        heightCode: k.heightCode,
        khMinMm: heightByCode.get(k.heightCode)!.khMinMm,
        kitCode: k.code,
      })),
      motion: 'translate',
    },
    blockedCode,
  };
}

/** #1596 decisión 9: dónde queda elegible el ensamble nuevo (grupo kind:agregado). */
export interface HardwareKitSystemEligibilityRequest {
  /** Grupo existente: el ensamble se añade como miembro (excluyente con el resto). */
  readonly existingGroupId?: string;
  /** Grupo nuevo: id+code+name del cliente (#1398), agregado como único miembro. */
  readonly id?: string;
  readonly code?: string;
  readonly name?: string;
}

/** #1546 M4: request del asistente de sistema — uploads por slot de pieza. */
export interface HardwareKitSystemCreateRequest {
  readonly input: HardwareKitSystemInput;
  /** Uploads de SKP: clave `${kitCode}:${pieceAnchor}:${partSuffix}` → binding. */
  readonly designs?: Record<string, HardwareVisualAssetBinding>;
  /**
   * #1596 decisión 9: elegibilidad del ensamble — se aplica en la MISMA
   * transacción del servidor (o localmente en guest). Omisión explícita:
   * la UI exige confirmar el aviso antes de enviar undefined.
   */
  readonly eligibilityGroup?: HardwareKitSystemEligibilityRequest;
}

/**
 * #1596 (review B1): whether the ENGINE's legacy name inference would treat
 * this hardware as moving (kitPieceMember/kitPartMember regex: -MOV/-BRAZO in
 * the code, móvil/movil/brazo in the name). The alta never RELIES on the
 * inference — explicit offsets and «Al abrir» always win — but seeding the
 * auto design-part row on open must reproduce it, or saving a legacy par
 * whose motion was name-declared would silently pin it to the body.
 */
export function hardwareNameSuggestsMotion(hw: {
  readonly code: string;
  readonly name: string;
}): boolean {
  const upperCode = hw.code.toUpperCase();
  const lowerName = hw.name.toLowerCase();
  return (
    upperCode.includes('-MOV') || upperCode.includes('-BRAZO') ||
    lowerName.includes('móvil') || lowerName.includes('movil') || lowerName.includes('brazo')
  );
}
