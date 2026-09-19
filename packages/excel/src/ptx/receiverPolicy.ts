/**
 * HPP250 CAD4 r5 lab receiver-specific PTX emission policy (#790).
 *
 * The policy centralizes machine/profile-driven numeric overrides and record-shape
 * decisions that the generic cut-plan compiler projects without inferring from
 * names, geometry, or implicit defaults.
 */

export const PTX_RECEIVER_FIELD_SOURCE = {
  FROM_MACHINE_PROFILE: 'FROM_MACHINE_PROFILE',
  FROM_MATERIAL: 'FROM_MATERIAL',
  FROM_CUTPLAN_GEOMETRY: 'FROM_CUTPLAN_GEOMETRY',
  OMIT_NO_OVERRIDE: 'OMIT_NO_OVERRIDE',
} as const;

export type PtxReceiverFieldSource =
  (typeof PTX_RECEIVER_FIELD_SOURCE)[keyof typeof PTX_RECEIVER_FIELD_SOURCE];

export type PtxReceiverMaterialFieldName =
  | 'BOOK'
  | 'KERF_RIP'
  | 'KERF_XCT'
  | 'TRIM_FRIP'
  | 'TRIM_VRIP'
  | 'TRIM_FXCT'
  | 'TRIM_VXCT'
  | 'TRIM_HEAD'
  | 'TRIM_FRCT'
  | 'TRIM_VRCT'
  | 'RULE1'
  | 'RULE2'
  | 'RULE3'
  | 'RULE4';

export type PtxReceiverRecordFamily =
  | 'JOBS'
  | 'PARTS_REQ'
  | 'PARTS_INF'
  | 'PARTS_UDI'
  | 'BOARDS'
  | 'MATERIALS'
  | 'OFFCUTS'
  | 'PATTERNS'
  | 'CUTS';

export interface PtxReceiverNumberFieldPolicy {
  readonly source: PtxReceiverFieldSource;
  readonly value?: number;
}

export type PtxReceiverMaterialFieldPolicies = Readonly<
  Record<PtxReceiverMaterialFieldName, PtxReceiverNumberFieldPolicy>
>;

export interface PtxReceiverRecordShapePolicy {
  readonly familyOrder: readonly PtxReceiverRecordFamily[];
  readonly requireBookMaxBookCoherence: boolean;
  readonly emitCutComments: boolean;
}

export interface PtxReceiverPolicy {
  readonly id: string;
  readonly materialFields: PtxReceiverMaterialFieldPolicies;
  readonly recordShape: PtxReceiverRecordShapePolicy;
}

export const HPP250_CAD4_R5_LAB_RECEIVER_POLICY = {
  id: 'HPP250_CAD4_R5_LAB',
  materialFields: {
    BOOK: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 3 },
    KERF_RIP: {
      source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
      value: 4.4,
    },
    KERF_XCT: {
      source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
      value: 4.4,
    },
    TRIM_FRIP: {
      source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
      value: 10,
    },
    TRIM_VRIP: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 0 },
    TRIM_FXCT: {
      source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
      value: 10,
    },
    TRIM_VXCT: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 0 },
    TRIM_HEAD: {
      source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
      value: 20,
    },
    TRIM_FRCT: {
      source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE,
      value: 20,
    },
    TRIM_VRCT: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 0 },
    RULE1: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 6 },
    RULE2: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 1 },
    RULE3: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 1 },
    RULE4: { source: PTX_RECEIVER_FIELD_SOURCE.FROM_MACHINE_PROFILE, value: 1 },
  },
  recordShape: {
    familyOrder: [
      'JOBS',
      'PARTS_REQ',
      'PARTS_INF',
      'PARTS_UDI',
      'BOARDS',
      'MATERIALS',
      'OFFCUTS',
      'PATTERNS',
      'CUTS',
    ],
    requireBookMaxBookCoherence: true,
    emitCutComments: false,
  },
} as const satisfies PtxReceiverPolicy;

export function requiredReceiverNumber(
  policy: PtxReceiverPolicy,
  fieldName: PtxReceiverMaterialFieldName,
): number {
  const fieldPolicy = policy.materialFields[fieldName];

  if (
    !fieldPolicy ||
    fieldPolicy.source === PTX_RECEIVER_FIELD_SOURCE.OMIT_NO_OVERRIDE
  ) {
    throw new Error(`Missing required PTX receiver numeric field: ${fieldName}`);
  }

  if (fieldPolicy.value === undefined) {
    throw new Error(`Missing required PTX receiver numeric value: ${fieldName}`);
  }

  return fieldPolicy.value;
}
