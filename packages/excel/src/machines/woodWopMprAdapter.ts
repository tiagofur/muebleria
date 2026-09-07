/**
 * woodWOP MPR postprocessor adapter foundation (#351).
 *
 * FIELD_FORMAT_EVIDENCE_REQUIRED: MPR serialization needs a real `.mpr`
 * sample produced by the client's exact woodWOP version (record syntax,
 * version header, coordinate/face conventions, tool IDs, macro grammar).
 * No such evidence exists in the repository, so this adapter fails closed
 * instead of guessing record layouts — a wrong drilling coordinate is worse
 * than no file.
 *
 * Machining input comes exclusively from Granete-resolved drilling data
 * (ProjectDrillingData / HoleDefinition) — never from furniture names or
 * SketchUp geometry. Grooves and routing are NOT_REPRESENTED by the current
 * resolved model; when they are represented, they extend ResolvedMachiningJob
 * and this adapter must still refuse anything the profile cannot serialize
 * (OPERATION_NOT_REPRESENTABLE) rather than silently dropping it.
 *
 * A future woodWOP MPRX adapter plugs in as a new adapter + profile pair;
 * neutral machining logic never changes for format variants.
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
import { MPR_REQUIRED_DIMENSIONS } from './profiles';

/** Operation kinds the MPR format grammar could express, keyed by evidence. */
export type MprOperationKind = 'vertical-drilling' | 'horizontal-drilling' | 'groove' | 'routing';

function holeFaceToOperationKind(face: string): MprOperationKind {
  // Face convention from partDrilling: front/back are the large faces
  // (vertical drilling into the panel surface); left/right/top/bottom are
  // edge faces (horizontal drilling). Machine-side axis mapping (X vs Y) is
  // FIELD_VERIFICATION_REQUIRED and deliberately not decided here.
  if (face === 'front' || face === 'back') return 'vertical-drilling';
  return 'horizontal-drilling';
}

/** Neutral view of every operation in a machining job (nothing dropped). */
export function describeMachiningOperations(job: ResolvedMachiningJob): MachiningOperationDescriptor[] {
  const operations: MachiningOperationDescriptor[] = [];
  for (const pattern of job.drilling.patterns) {
    for (const hole of pattern.holes) {
      operations.push({
        pieceCode: pattern.pieceCode,
        face: hole.face,
        diameterMm: hole.diameterMm,
        depthMm: hole.depthMm,
        type: hole.type,
      });
    }
  }
  return operations;
}

/**
 * Operations the profile cannot serialize. `operationMacros` (when evidenced)
 * is a comma-separated list of MprOperationKind this dialect can express;
 * anything outside it — or everything, when no macros are evidenced — is
 * listed here. Serialization refuses on any entry; nothing disappears
 * silently.
 */
export function describeUnrepresentableOperations(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): { kind: MprOperationKind; count: number }[] {
  const evidenced = new Set(
    String(profile.dimensions.operationMacros ?? '')
      .split(',')
      .map((kind) => kind.trim())
      .filter(Boolean),
  );
  const counts = new Map<MprOperationKind, number>();
  for (const op of describeMachiningOperations(job)) {
    const kind = holeFaceToOperationKind(op.face);
    if (!evidenced.has(kind)) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
}

/** Canonical identity of the (pending) serialization behavior; see PTX adapter. */
export const MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'woodwop-mpr',
  adapterVersion: '0.1.0',
  producedFormatFamily: 'mpr',
  generator: 'pending-evidence',
} as const;

function pendingReasons(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [];
  for (const dimension of MPR_REQUIRED_DIMENSIONS) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        dimension,
        detail: `MPR dimension '${dimension}' requires a real .mpr sample from the client's woodWOP version`,
      });
    }
  }
  for (const unrepresentable of describeUnrepresentableOperations(job, profile)) {
    reasons.push({
      code: 'OPERATION_NOT_REPRESENTABLE',
      dimension: 'operationMacros',
      detail: `${unrepresentable.count} ${unrepresentable.kind} operation(s) have no evidenced macro; refusing instead of dropping them`,
    });
  }
  return reasons;
}

export const WOODWOP_MPR_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedMachiningJob> = {
  postprocessorAdapterId: 'woodwop-mpr',
  adapterVersion: '0.1.0',
  implementationDigest: '4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782',
  producedFormatFamily: 'mpr',
  requiredDimensions: MPR_REQUIRED_DIMENSIONS,

  canSerialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons = [...checkFormatFamily(profile, 'mpr'), ...pendingReasons(job, profile)];
    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    // Unreachable until mpr-woodwop publishes an evidenced revision: the
    // record serializer is intentionally not implemented ahead of evidence.
    throw new AdapterSerializationBlocked([
      {
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        detail: 'MPR serializer implementation pending its first evidenced profile revision',
      },
    ]);
  },
};
