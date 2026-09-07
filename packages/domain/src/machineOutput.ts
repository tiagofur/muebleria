/**
 * Neutral machine-output contract (#351 foundation, authorized by the owner
 * after the Client A PTX conversion failure — see docs/machines/client-a/).
 *
 * Reuses the canonical capability surfaces already defined for the
 * manufacturing preflight (MachineProfileRef / MachineCapability) and the
 * existing resolved job models (CutPlan, ProjectDrillingData). This module
 * adds ONLY what is genuinely missing:
 *
 * - OutputCompatibilityProfile: how a receiving software/version expects the
 *   file (syntax dimensions), distinct from what the machine can physically
 *   do (MachineProfile) and from the serializer itself (adapter).
 * - PostprocessorAdapter boundary: thin serializers over resolved jobs; they
 *   never re-derive BOM, drilling, joints or dimensions.
 * - MachineArtifact + ArtifactManifest: deterministic, provenance-exact
 *   evidence-bound outputs (manufacturing contract §12).
 *
 * NEUTRAL BY RULE: no brand, client or model names in this module. Concrete
 * profiles (CADmatic, woodWOP, HPP 250, BHX 050…) are DATA in the export
 * layer (packages/excel machineProfiles), never branches in neutral logic.
 */

import type { CutPlan } from './optimizer/types';
import type { MachineCapability, MachineProfileRef } from './sketchupAuthoringSchema';
import type { ProjectDrillingData } from './partDrilling';

// ---------------------------------------------------------------------------
// Evidence provenance vocabulary (mirrors docs/machines/README.md)
// ---------------------------------------------------------------------------

export type FieldProvenance =
  | 'CLIENT_CONFIRMED'
  | 'OWNER_CONFIRMED'
  | 'FIELD_VERIFICATION_REQUIRED'
  | 'PUBLIC_REFERENCE_ONLY';

/**
 * Canonical validation status vocabulary (docs/machines/README.md). There is
 * deliberately NO "FORMAT_ACCEPTED"/"READBACK_MATCHED" intermediate enum:
 * those are comparison findings inside an evidence pack, not pack states.
 */
export type MachineOutputSupportStatus = 'NOT_TESTED' | 'PARTIAL' | 'VALIDATED' | 'UNSUPPORTED';

/** Evidence claim of an artifact manifest (manufacturing contract §12). */
export type CompatibilityEvidenceClaim =
  | 'notClaimed'
  | 'validated'
  | 'partial'
  | 'unsupported';

// ---------------------------------------------------------------------------
// Jobs: provenance-exact wrappers over resolved manufacturing truth
// ---------------------------------------------------------------------------

/**
 * Exact generation context of a machine artifact. Every field is explicit;
 * absent fields are recorded as missing in the manifest — never implied from
 * "latest" and never silently defaulted (manufacturing contract §12).
 */
export interface ManufacturingJobProvenance {
  readonly projectId: string;
  /** ISO timestamp; caller-supplied so artifacts are deterministic. */
  readonly generatedAt: string;
  readonly productionReleaseId?: string;
  readonly designRevisionId?: string;
  readonly bomFingerprint?: string;
  readonly cutPlanId?: string;
  readonly cutPlanVersion?: number;
}

/** Artifact labeling metadata (free text shown to the workshop). */
export interface ExportPresentation {
  readonly projectName?: string;
  readonly customerName?: string;
  readonly projectCode?: string;
}

export interface ResolvedCuttingJob {
  readonly jobId: string;
  readonly provenance: ManufacturingJobProvenance;
  /** The manufacturing truth. Adapters serialize it; they never re-derive it. */
  readonly cutPlan: CutPlan;
  /** Optional labeling for the artifact header. Never identity. */
  readonly presentation?: ExportPresentation;
}

export interface ResolvedMachiningJob {
  readonly jobId: string;
  readonly provenance: ManufacturingJobProvenance;
  /**
   * Drilling-only today (HoleDefinition faces/diameters/depths). Grooves and
   * routing are NOT_REPRESENTED by the current resolved model; when they are,
   * they extend this job — adapters must never invent them.
   */
  readonly drilling: ProjectDrillingData;
}

// ---------------------------------------------------------------------------
// OutputCompatibilityProfile — receiving-software syntax dimensions
// ---------------------------------------------------------------------------

export type OutputFormatFamily = 'ptx' | 'saw' | 'mpr';

/**
 * Status of one serialization dimension. `FIELD_FORMAT_EVIDENCE_REQUIRED`
 * means the value is unknown until a real sample/spec from the receiving
 * software is captured; adapters fail closed on any such dimension.
 */
export type FormatDimensionStatus = 'EVIDENCED' | 'FIELD_FORMAT_EVIDENCE_REQUIRED';

export interface OutputCompatibilityProfileRef {
  readonly outputCompatibilityProfileId: string;
  readonly revisionId: string;
}

export interface OutputCompatibilityProfile {
  readonly ref: OutputCompatibilityProfileRef;
  readonly formatFamily: OutputFormatFamily;
  /**
   * Receiving software this profile targets, when known. Unknown version is
   * expressed with provenance FIELD_VERIFICATION_REQUIRED — never guessed.
   */
  readonly targetSoftware?: {
    readonly name: string;
    readonly version?: string;
    readonly provenance: FieldProvenance;
  };
  /**
   * Evidenced syntax dimensions (encoding, lineEnding, decimals, header
   * version, file extension…). Keys are profile-data; values only carry
   * provenance EVIDENCED entries. A dimension listed in `requiredDimensions`
   * but absent here blocks serialization.
   */
  readonly dimensions: Readonly<Record<string, string | number | boolean>>;
  /**
   * Dimensions this format family requires before bytes can be emitted.
   * Declared per family by the adapter contract; profiles record which are
   * still evidence-pending.
   */
  readonly pendingEvidence: readonly string[];
  /** Validation state of the profile's output (never auto-promoted). */
  readonly supportStatus: MachineOutputSupportStatus;
  /** SHA-256 over the canonical profile data; identifies exact revisions. */
  readonly digest: string;
  /** Sanitized dossier/evidence link (opaque keys only). */
  readonly evidenceUri?: string;
}

// ---------------------------------------------------------------------------
// PostprocessorAdapter boundary
// ---------------------------------------------------------------------------

export interface AdapterBlockReason {
  readonly code:
    | 'FIELD_FORMAT_EVIDENCE_REQUIRED'
    | 'FORMAT_FAMILY_MISMATCH'
    | 'OPERATION_NOT_REPRESENTABLE'
    | 'PROFILE_DIGEST_MISMATCH';
  readonly detail: string;
  readonly dimension?: string;
}

export interface AdapterReadiness {
  readonly ready: boolean;
  readonly reasons: readonly AdapterBlockReason[];
}

/** Neutral machining operation view used for representability checks. */
export interface MachiningOperationDescriptor {
  readonly pieceCode: string;
  readonly face: string;
  readonly diameterMm: number;
  readonly depthMm: number;
  readonly type: string;
}

/**
 * Thin serializer over a resolved job. Implementations MUST be deterministic
 * and MUST fail closed (AdapterSerializationBlocked) instead of emitting
 * partial or guessed output.
 */
export interface PostprocessorAdapter<Job = unknown> {
  readonly postprocessorAdapterId: string;
  readonly adapterVersion: string;
  /** Digest of the exact serialization behavior (implementation identity). */
  readonly implementationDigest: string;
  readonly producedFormatFamily: OutputFormatFamily;
  /** Dimensions this adapter requires to be evidenced before serializing. */
  readonly requiredDimensions: readonly string[];
  canSerialize(job: Job, profile: OutputCompatibilityProfile): AdapterReadiness;
  serialize(job: Job, profile: OutputCompatibilityProfile): Uint8Array;
}

export class AdapterSerializationBlocked extends Error {
  constructor(
    readonly reasons: readonly AdapterBlockReason[],
  ) {
    super(
      `machine output blocked: ${reasons.map((r) => `${r.code}(${r.detail})`).join('; ')}`,
    );
    this.name = 'AdapterSerializationBlocked';
  }
}

// ---------------------------------------------------------------------------
// Machine artifacts and manifests (manufacturing contract §12)
// ---------------------------------------------------------------------------

export type ArtifactKind = 'ptx' | 'saw' | 'mpr' | 'dxf' | 'csv' | 'pdf' | 'label' | 'other';

export interface ArtifactCompatibilityEvidence {
  readonly claim: CompatibilityEvidenceClaim;
  /** Required when claim is validated/partial; never a private path. */
  readonly sanitizedEvidencePackUri?: string;
}

export interface MachineArtifact {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly schemaVersion: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface ArtifactManifest {
  readonly artifactSetId: string;
  readonly jobId: string;
  readonly provenance: ManufacturingJobProvenance;
  /** Provenance fields the current flow could not supply (explicit, no "latest"). */
  readonly missingProvenance: readonly string[];
  readonly machineProfile?: MachineProfileRef;
  readonly machineProfileSupportedCapabilities?: readonly MachineCapability[];
  readonly outputCompatibilityProfile: OutputCompatibilityProfileRef;
  readonly postprocessorAdapter: {
    readonly postprocessorAdapterId: string;
    readonly adapterVersion: string;
    readonly implementationDigest: string;
  };
  readonly compatibilityEvidence: ArtifactCompatibilityEvidence;
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly kind: ArtifactKind;
    readonly schemaVersion: string;
    readonly sha256: string;
  }[];
  readonly createdAt: string;
  readonly validationStatus: MachineOutputSupportStatus;
  readonly nonProductionValidationArtifact: true;
}
