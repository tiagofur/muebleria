/**
 * KDT Flexdrill 1200 postprocessor adapter boundary (#1005 K1 registration).
 *
 * FIELD_FORMAT_EVIDENCE_REQUIRED: the KDTPanelFormat XML syntax is
 * documented from 417 real production samples (docs/machines/kdt-xml-format.md,
 * dossier docs/machines/client-b/machine-c-kdt-flexdrill1200.md), but the
 * serializer itself is NOT implemented yet (#1005 K2). This adapter registers
 * the `kdt` family fail-closed: selections persist, generation stays blocked
 * with SERIALIZER_NOT_IMPLEMENTED, and the evidenced profile revision only
 * lands together with the real serializer — never an in-place promotion.
 *
 * Machining input comes exclusively from Granete-resolved drilling data
 * (ProjectDrillingData / HoleDefinition) — never from furniture names or
 * SketchUp geometry. Grooves and routing are NOT_REPRESENTED by the current
 * resolved model, so the KDTPanelFormat types they would map to (TypeNo 3/6/7)
 * stay unreachable; the adapter must refuse anything unrepresented rather
 * than silently dropping it (docs/machines/kdt-xml-format.md §15).
 */

import {
  AdapterSerializationBlocked,
  type AdapterBlockReason,
  type AdapterReadiness,
  type MachiningOperationDescriptor,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
  type ResolvedMachiningJob,
} from '@granete/domain';
import { checkFormatFamily } from './ptxAdapter';
import { describeMachiningOperations } from './woodWopMprAdapter';
import { KDT_REQUIRED_DIMENSIONS } from './profiles';

/**
 * KDTPanelFormat operation types the resolved drilling model can reach
 * today: TypeNo 1 (vertical hole from the top face) and TypeNo 2 (horizontal
 * hole from a quadrant edge). TypeNo 4 was never observed and 5 only once —
 * their semantics are spec open questions, never assumed here.
 */
export type KdtOperationKind = 'typeNo1-vertical-hole' | 'typeNo2-horizontal-hole';

const KDT_OPERATION_TYPE_NOS: Record<KdtOperationKind, string> = {
  'typeNo1-vertical-hole': '1',
  'typeNo2-horizontal-hole': '2',
};

function holeFaceToKdtOperationKind(face: string): KdtOperationKind {
  // partDrilling convention: front/back are the large faces (TypeNo 1
  // vertical drilling); left/right/top/bottom are edge faces (TypeNo 2
  // horizontal drilling). Exact quadrant selection (right/left/top/bottom of
  // the panel) is serializer work (K2) and stays undecided here.
  if (face === 'front' || face === 'back') return 'typeNo1-vertical-hole';
  return 'typeNo2-horizontal-hole';
}

/** Neutral view of every operation in a machining job (nothing dropped). */
export function describeKdtOperations(job: ResolvedMachiningJob): MachiningOperationDescriptor[] {
  return describeMachiningOperations(job);
}

/**
 * Operations the profile cannot serialize. `operationTypeNos` (when
 * evidenced) is a comma-separated list of KDTPanelFormat TypeNo values this
 * dialect can express; anything outside it — or everything, when nothing is
 * evidenced — is listed here. Serialization refuses on any entry; nothing
 * disappears silently.
 */
export function describeUnrepresentableKdtOperations(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): { kind: KdtOperationKind; count: number }[] {
  const evidenced = new Set(
    String(profile.dimensions.operationTypeNos ?? '')
      .split(',')
      .map((typeNo) => typeNo.trim())
      .filter(Boolean),
  );
  const counts = new Map<KdtOperationKind, number>();
  for (const op of describeKdtOperations(job)) {
    const kind = holeFaceToKdtOperationKind(op.face);
    if (!evidenced.has(KDT_OPERATION_TYPE_NOS[kind])) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

/** Canonical identity of the (pending) serialization behavior; see PTX adapter. */
export const KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'granete-kdt',
  adapterVersion: '0.1.0',
  producedFormatFamily: 'kdt',
  generator: 'pending-evidence',
} as const;

function pendingReasons(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [
    {
      code: 'SERIALIZER_NOT_IMPLEMENTED',
      detail: 'KDT KDTPanelFormat serializer is not implemented yet (#1005 K2); even fully evidenced profiles stay blocked until the real serializer lands',
    },
  ];
  for (const dimension of KDT_REQUIRED_DIMENSIONS) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        dimension,
        detail: `KDT dimension '${dimension}' requires its evidenced value in a future kdt-flexdrill-1200 profile revision (spec: docs/machines/kdt-xml-format.md)`,
      });
    }
  }
  for (const unrepresentable of describeUnrepresentableKdtOperations(job, profile)) {
    reasons.push({
      code: 'OPERATION_NOT_REPRESENTABLE',
      dimension: 'operationTypeNos',
      detail: `${unrepresentable.count} ${unrepresentable.kind} operation(s) outside the evidenced operationTypeNos; refusing instead of dropping them`,
    });
  }
  return reasons;
}

export const KDT_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedMachiningJob> = {
  postprocessorAdapterId: 'granete-kdt',
  adapterVersion: '0.1.0',
  implementationDigest: '401c9fc8f7c77c708fa655441d7b40a6e22d0257d7fb9e0e6acac2dd356b97a9',
  producedFormatFamily: 'kdt',
  requiredDimensions: KDT_REQUIRED_DIMENSIONS,

  canSerialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons = [...checkFormatFamily(profile, 'kdt'), ...pendingReasons(job, profile)];
    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    // Unreachable by contract while the serializer is pending: readiness
    // always contains SERIALIZER_NOT_IMPLEMENTED, so the guard above fires.
    throw new AdapterSerializationBlocked([
      {
        code: 'SERIALIZER_NOT_IMPLEMENTED',
        detail: 'KDT KDTPanelFormat serializer is not implemented yet',
      },
    ]);
  },
};
