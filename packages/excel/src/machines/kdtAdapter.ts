/**
 * KDT Flexdrill 1200 postprocessor adapter — K2 serializer (#1005).
 *
 * The KDTPanelFormat writer/reader live in ./kdt/ (document model, byte
 * format, transform policy, independent parser) and are validated by
 * round-trip tests over all six faces and both orientations, plus goldens
 * over the 417 real production samples in docs/machines/client-b/samples/.
 *
 * Granularity contract: KDTPanelFormat is ONE FILE PER PANEL (per machining
 * face group — Promob's own "Face A/B" split). `serializePerPiece` is the
 * real API and returns every program of the job; the PostprocessorAdapter
 * interface-level `serialize` only accepts jobs that yield EXACTLY ONE
 * program and blocks with PROGRAM_GRANULARITY_UNSUPPORTED otherwise — never
 * concatenates, never packs, never invents a container format. The
 * multi-program generation flow is #1005 K3.
 *
 * Machining input comes exclusively from Granete-resolved drilling data
 * (ProjectDrillingData / HoleDefinition) — never from furniture names or
 * SketchUp geometry. TypeNo 3/6/7 (grooves/routing) stay
 * OPERATION_NOT_REPRESENTABLE until the resolved model carries them, and
 * any hole outside its face frame is JOB_DATA_INVALID — refused, not
 * silently coerced.
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
import { KDT_FLEXDRILL_1200_PROFILE, KDT_REQUIRED_DIMENSIONS } from './profiles';
import { serializeKdtPanelDocument } from './kdt/format';
import { transformJobToPrograms, type KdtPieceProgram, type KdtProvenance } from './kdt/transform';

/** Operation kinds the resolved drilling model can reach today. */
export type KdtOperationKind = 'typeNo1-vertical-hole' | 'typeNo2-horizontal-hole';

const KDT_OPERATION_TYPE_NOS: Record<KdtOperationKind, string> = {
  'typeNo1-vertical-hole': '1',
  'typeNo2-horizontal-hole': '2',
};

function holeFaceToKdtOperationKind(face: string): KdtOperationKind {
  // partDrilling convention: front/back are the large faces (TypeNo 1
  // vertical drilling); left/right/top/bottom are edge faces (TypeNo 2
  // horizontal drilling).
  if (face === 'front' || face === 'back') return 'typeNo1-vertical-hole';
  return 'typeNo2-horizontal-hole';
}

/** Neutral view of every operation in a machining job (nothing dropped). */
export function describeKdtOperations(job: ResolvedMachiningJob): MachiningOperationDescriptor[] {
  return describeMachiningOperations(job);
}

/**
 * Operations the profile cannot serialize. `operationTypeNos` (evidenced as
 * '1,2' in r2) lists the KDTPanelFormat TypeNo values this dialect emits;
 * anything outside it is listed here. Serialization refuses; nothing
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

/** Canonical identity of the serialization behavior; see PTX adapter. */
export const KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'granete-kdt',
  adapterVersion: '0.2.0',
  producedFormatFamily: 'kdt',
  generator: 'kdtpanelformat-writer-r1',
} as const;

/** Stamped into every program's AUTHOR comment; mirrors the descriptor. */
const KDT_PROVENANCE: KdtProvenance = {
  adapterId: KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR.postprocessorAdapterId,
  adapterVersion: KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR.adapterVersion,
  profileId: KDT_FLEXDRILL_1200_PROFILE.ref.outputCompatibilityProfileId,
  profileRevision: KDT_FLEXDRILL_1200_PROFILE.ref.revisionId,
};

export interface KdtPieceArtifact {
  readonly pieceCode: string;
  readonly machiningFace: 'front' | 'back';
  readonly bytes: Uint8Array;
}

function readinessReasons(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [];
  for (const dimension of KDT_REQUIRED_DIMENSIONS) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        dimension,
        detail: `KDT dimension '${dimension}' requires its evidenced value in the current kdt-flexdrill-1200 profile revision (spec: docs/machines/kdt-xml-format.md)`,
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
  let programs: KdtPieceProgram[];
  try {
    programs = transformJobToPrograms(job, KDT_PROVENANCE);
  } catch (error) {
    reasons.push({
      code: 'JOB_DATA_INVALID',
      detail: error instanceof Error ? error.message : String(error),
    });
    return reasons;
  }
  if (programs.length !== 1) {
    reasons.push({
      code: 'PROGRAM_GRANULARITY_UNSUPPORTED',
      detail:
        programs.length === 0
          ? 'el trabajo no produce programas KDT (ninguna pieza con operaciones); el flujo de generación por pieza llega con #1005 K3'
          : `el trabajo produce ${programs.length} programas KDT (uno por pieza/cara de mecanizado); use serializePerPiece — el flujo multi-programa llega con #1005 K3`,
    });
  }
  return reasons;
}

export const KDT_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedMachiningJob> = {
  postprocessorAdapterId: KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR.postprocessorAdapterId,
  adapterVersion: KDT_ADAPTER_IMPLEMENTATION_DESCRIPTOR.adapterVersion,
  implementationDigest: 'b9b824c7f86b16603f4d90e278d5920d26b816fdcff9007804ae64e3f0a5d17f',
  producedFormatFamily: 'kdt',
  requiredDimensions: KDT_REQUIRED_DIMENSIONS,

  canSerialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons = [...checkFormatFamily(profile, 'kdt'), ...readinessReasons(job, profile)];
    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    // Ready ⇒ exactly one program (see readinessReasons); the non-null path
    // is the contract invariant `ready === true ⇒ serialize() executes`.
    const [program] = transformJobToPrograms(job, KDT_PROVENANCE);
    if (!program) {
      throw new AdapterSerializationBlocked([
        {
          code: 'PROGRAM_GRANULARITY_UNSUPPORTED',
          detail: 'el trabajo no produce programas KDT',
        },
      ]);
    }
    return serializeKdtPanelDocument(program.document);
  },
};

/**
 * The real K2 API: one KDTPanelFormat program per piece/machining-face.
 * Deterministic (piece order, front group before back group); throws
 * AdapterSerializationBlocked with the typed reasons when anything is
 * unrepresentable or the job data is invalid — never drops operations.
 */
export function serializePerPiece(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): readonly KdtPieceArtifact[] {
  const readiness = KDT_POSTPROCESSOR_ADAPTER.canSerialize(job, profile);
  const fatal = readiness.reasons.filter(
    (reason) => reason.code !== 'PROGRAM_GRANULARITY_UNSUPPORTED',
  );
  if (fatal.length > 0) {
    throw new AdapterSerializationBlocked(fatal);
  }
  return transformJobToPrograms(job, KDT_PROVENANCE).map((program) => ({
    pieceCode: program.pieceCode,
    machiningFace: program.machiningFace,
    bytes: serializeKdtPanelDocument(program.document),
  }));
}
