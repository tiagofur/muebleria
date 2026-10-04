/**
 * woodWOP MPR postprocessor adapter — B2 offline candidate (#879).
 *
 * The serializer emits the CANDIDATE dialect documented from the official
 * public HOMAG file description (9-080-42-7190-D00 — see
 * docs/machines/bhx050/woodwop-mpr/ and machines/woodWopMpr/): <100
 * \Werkstck\ + <101 \Comment\ + <102 \BohrVert\ / <103 \BohrHoriz\ per
 * piece/machining-face, CRLF ASCII, literal numbers only. The profile
 * `mpr-woodwop@r2` carries the evidenced dimensions with their locators;
 * supportStatus stays NOT_TESTED — the b1-kit samples confirm or correct
 * the dialect and NOTHING here claims receiver compatibility.
 *
 * Granularity contract (same as KDT): MPR is ONE FILE PER PANEL (per
 * machining-face group). `serializePerPiece` is the real API; the
 * interface-level `serialize` only accepts jobs yielding EXACTLY ONE
 * program and blocks with PROGRAM_GRANULARITY_UNSUPPORTED otherwise. The
 * multi-program generation flow is generateSelectedMachiningOutput.
 *
 * Machining input comes exclusively from Granete-resolved drilling data
 * (ProjectDrillingData / HoleDefinition) — never from furniture names or
 * SketchUp geometry. Grooves and routing are NOT_REPRESENTED by the current
 * resolved model (<109/<105-<108 stay out of reach); any hole outside its
 * face frame is JOB_DATA_INVALID — refused, not silently coerced. A future
 * woodWOP MPRX adapter plugs in as a new adapter + profile pair.
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
import { serializeMprCandidateDocument } from './woodWopMpr/mprFormat';
import {
  transformJobToMprCandidatePrograms,
  type MprCandidatePieceProgram,
} from './woodWopMpr/mprTransform';

/** Operation kinds the MPR format grammar could express, keyed by evidence. */
export type MprOperationKind = 'vertical-drilling' | 'horizontal-drilling';

function holeFaceToOperationKind(face: string): MprOperationKind {
  // partDrilling convention: front/back are the large faces (vertical
  // drilling); left/right/top/bottom are edge faces (horizontal drilling).
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
 * Operations the profile cannot serialize. `operationMacros` (evidenced as
 * 'vertical-drilling,horizontal-drilling' in r2) lists the kinds this
 * dialect emits; anything outside it — or everything, when nothing is
 * evidenced — is listed here. Serialization refuses; nothing disappears
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

/** Canonical identity of the serialization behavior; see PTX adapter. */
export const MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'woodwop-mpr',
  adapterVersion: '0.2.0',
  producedFormatFamily: 'mpr',
  generator: 'woodwop-mpr-4.x-candidate-r1',
} as const;

const MPR_PROVENANCE = {
  generator: 'granete-mpr-candidate',
  dialect: 'woodwop-mpr-4.x-public-reference',
} as const;

export interface MprPieceArtifact {
  readonly pieceCode: string;
  readonly machiningFace: 'front' | 'back';
  readonly bytes: Uint8Array;
}

function readinessReasons(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [];
  for (const dimension of MPR_REQUIRED_DIMENSIONS) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        dimension,
        detail: `MPR dimension '${dimension}' requires its evidenced value in the current mpr-woodwop profile revision (spec: docs/machines/bhx050/woodwop-mpr/README.md)`,
      });
    }
  }
  for (const unrepresentable of describeUnrepresentableOperations(job, profile)) {
    reasons.push({
      code: 'OPERATION_NOT_REPRESENTABLE',
      dimension: 'operationMacros',
      detail: `${unrepresentable.count} ${unrepresentable.kind} operation(s) outside the evidenced operationMacros; refusing instead of dropping them`,
    });
  }
  let programs: MprCandidatePieceProgram[];
  try {
    programs = transformJobToMprCandidatePrograms(job, MPR_PROVENANCE);
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
          ? 'el trabajo no produce programas MPR (ninguna pieza con operaciones)'
          : `el trabajo produce ${programs.length} programas MPR (uno por pieza/cara de mecanizado); use serializePerPiece`,
    });
  }
  return reasons;
}

export const WOODWOP_MPR_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedMachiningJob> = {
  postprocessorAdapterId: MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR.postprocessorAdapterId,
  adapterVersion: MPR_ADAPTER_IMPLEMENTATION_DESCRIPTOR.adapterVersion,
  implementationDigest: '78a7948d08580054b594d7387a4d49dacf89510f3f623bdc824fa30cf527d3a1',
  producedFormatFamily: 'mpr',
  requiredDimensions: MPR_REQUIRED_DIMENSIONS,

  canSerialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons = [...checkFormatFamily(profile, 'mpr'), ...readinessReasons(job, profile)];
    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: ResolvedMachiningJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    // Ready ⇒ exactly one program (see readinessReasons); the non-null path
    // is the contract invariant `ready === true ⇒ serialize() executes`.
    const [program] = transformJobToMprCandidatePrograms(job, MPR_PROVENANCE);
    if (!program) {
      throw new AdapterSerializationBlocked([
        {
          code: 'PROGRAM_GRANULARITY_UNSUPPORTED',
          detail: 'el trabajo no produce programas MPR',
        },
      ]);
    }
    return serializeMprCandidateDocument(program.document);
  },
};

/**
 * The real B2 API: one MPR candidate program per piece/machining-face.
 * Deterministic; throws AdapterSerializationBlocked with the typed reasons
 * when anything is unrepresentable or the job data is invalid — never
 * drops operations.
 */
export function serializeMprPerPiece(
  job: ResolvedMachiningJob,
  profile: OutputCompatibilityProfile,
): readonly MprPieceArtifact[] {
  const readiness = WOODWOP_MPR_POSTPROCESSOR_ADAPTER.canSerialize(job, profile);
  const fatal = readiness.reasons.filter(
    (reason) => reason.code !== 'PROGRAM_GRANULARITY_UNSUPPORTED',
  );
  if (fatal.length > 0) {
    throw new AdapterSerializationBlocked(fatal);
  }
  return transformJobToMprCandidatePrograms(job, MPR_PROVENANCE).map((program) => ({
    pieceCode: program.pieceCode,
    machiningFace: program.machiningFace,
    bytes: serializeMprCandidateDocument(program.document),
  }));
}
