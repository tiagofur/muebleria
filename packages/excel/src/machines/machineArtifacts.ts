/**
 * Deterministic machine artifact + manifest generation (manufacturing
 * contract §12). Every artifact is provenance-exact: the manifest records
 * which provenance fields the calling flow could not supply (explicit
 * "missing", never implicit "latest"), the exact output-profile and adapter
 * revisions, and the claim stays `notClaimed` until a validated/partial
 * evidence pack exists. Artifacts carry the non-production banner.
 */

import {
  AdapterSerializationBlocked,
  type ArtifactKind,
  type ArtifactManifest,
  type MachineArtifact,
  type MachineProfileRef,
  type MachineCapability,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
} from '@granete/domain';
import { canonicalJson, sha256Hex } from './digest';

const OPTIONAL_PROVENANCE_FIELDS = [
  'productionReleaseId',
  'designRevisionId',
  'bomFingerprint',
  'cutPlanId',
  'cutPlanVersion',
] as const;

export interface MachineArtifactRequest<Job> {
  readonly job: Job & {
    readonly jobId: string;
    readonly provenance: ArtifactManifest['provenance'];
  };
  readonly adapter: PostprocessorAdapter<Job>;
  readonly profile: OutputCompatibilityProfile;
  readonly kind: ArtifactKind;
  readonly schemaVersion: string;
  /** File name including the evidenced extension. */
  readonly fileName: string;
  readonly machineProfile?: {
    readonly ref: MachineProfileRef;
    readonly supported: readonly MachineCapability[];
  };
  readonly delivery?: ArtifactManifest['delivery'];
}

export interface MachineArtifactBundle {
  readonly artifact: MachineArtifact;
  readonly manifest: ArtifactManifest;
  /** Deterministic manifest JSON (pretty, trailing newline). */
  readonly manifestJson: string;
}

interface BundleFromBytesRequest {
  readonly jobId: string;
  readonly artifactId: string;
  readonly provenance: ArtifactManifest['provenance'];
  readonly profile: OutputCompatibilityProfile;
  readonly adapter: {
    readonly postprocessorAdapterId: string;
    readonly adapterVersion: string;
    readonly implementationDigest: string;
  };
  readonly kind: ArtifactKind;
  readonly schemaVersion: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly machineProfile?: {
    readonly ref: MachineProfileRef;
    readonly supported: readonly MachineCapability[];
  };
  readonly delivery?: ArtifactManifest['delivery'];
}

async function buildBundleFromBytes(request: BundleFromBytesRequest): Promise<MachineArtifactBundle> {
  const sha256 = await sha256Hex(request.bytes);
  const artifact: MachineArtifact = {
    artifactId: request.artifactId,
    kind: request.kind,
    schemaVersion: request.schemaVersion,
    fileName: request.fileName,
    bytes: request.bytes,
    sha256,
  };
  const missingProvenance = OPTIONAL_PROVENANCE_FIELDS.filter(
    (field) => request.provenance[field] === undefined,
  );
  const manifest: ArtifactManifest = {
    manifestSchemaVersion: 'granete.machine-artifact-manifest.v2',
    artifactSetId: request.artifactId,
    jobId: request.jobId,
    provenance: request.provenance,
    missingProvenance,
    machineProfile: request.machineProfile?.ref,
    machineProfileSupportedCapabilities: request.machineProfile?.supported ?? [],
    outputCompatibilityProfile: request.profile.ref,
    outputCompatibilityProfileDigest: request.profile.digest,
    postprocessorAdapter: {
      postprocessorAdapterId: request.adapter.postprocessorAdapterId,
      adapterVersion: request.adapter.adapterVersion,
      implementationDigest: request.adapter.implementationDigest,
    },
    compatibilityEvidence: { claim: 'notClaimed' },
    artifacts: [
      {
        artifactId: request.artifactId,
        kind: request.kind,
        schemaVersion: request.schemaVersion,
        fileName: request.fileName,
        sha256,
      },
    ],
    delivery: request.delivery ?? { mode: 'unified' },
    createdAt: request.provenance.generatedAt,
    validationStatus: request.profile.supportStatus,
    nonProductionValidationArtifact: true,
  };
  return {
    artifact,
    manifest,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

export async function generateMachineArtifact<Job>(
  request: MachineArtifactRequest<Job>,
): Promise<MachineArtifactBundle> {
  const { job, adapter, profile } = request;

  const readiness = adapter.canSerialize(job, profile);
  if (!readiness.ready) {
    throw new AdapterSerializationBlocked(readiness.reasons);
  }

  const bytes = adapter.serialize(job, profile);
  return buildBundleFromBytes({
    jobId: job.jobId,
    artifactId: `${job.jobId}--${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`,
    provenance: job.provenance,
    profile,
    adapter: {
      postprocessorAdapterId: adapter.postprocessorAdapterId,
      adapterVersion: adapter.adapterVersion,
      implementationDigest: adapter.implementationDigest,
    },
    kind: request.kind,
    schemaVersion: request.schemaVersion,
    fileName: request.fileName,
    bytes,
    machineProfile: request.machineProfile,
    delivery: request.delivery,
  });
}

/**
 * #1005 K3 — bundle assembly from ALREADY-SERIALIZED bytes for per-piece
 * formats (KDTPanelFormat): the adapter's per-piece path (serializePerPiece)
 * owns gating and serialization for the whole job; this builder only wraps
 * each program into its artifact + manifest. Never a bypass of the gates —
 * the caller must have run them (generateSelectedMachiningOutput does).
 */
export async function generateMachineArtifactFromBytes(
  request: BundleFromBytesRequest,
): Promise<MachineArtifactBundle> {
  return buildBundleFromBytes(request);
}

/** Deterministic manifest comparison key (for tests and evidence packs). */
export function manifestComparisonKey(manifest: ArtifactManifest): string {
  return canonicalJson(manifest);
}
