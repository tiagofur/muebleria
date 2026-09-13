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

export async function generateMachineArtifact<Job>(
  request: MachineArtifactRequest<Job>,
): Promise<MachineArtifactBundle> {
  const { job, adapter, profile } = request;

  const readiness = adapter.canSerialize(job, profile);
  if (!readiness.ready) {
    throw new AdapterSerializationBlocked(readiness.reasons);
  }

  const bytes = adapter.serialize(job, profile);
  const sha256 = await sha256Hex(bytes);

  const artifactId = `${job.jobId}--${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`;
  const artifact: MachineArtifact = {
    artifactId,
    kind: request.kind,
    schemaVersion: request.schemaVersion,
    fileName: request.fileName,
    bytes,
    sha256,
  };

  const missingProvenance = OPTIONAL_PROVENANCE_FIELDS.filter(
    (field) => job.provenance[field] === undefined,
  );

  const manifest: ArtifactManifest = {
    manifestSchemaVersion: 'granete.machine-artifact-manifest.v2',
    artifactSetId: artifactId,
    jobId: job.jobId,
    provenance: job.provenance,
    missingProvenance,
    machineProfile: request.machineProfile?.ref,
    machineProfileSupportedCapabilities: request.machineProfile?.supported ?? [],
    outputCompatibilityProfile: profile.ref,
    outputCompatibilityProfileDigest: profile.digest,
    postprocessorAdapter: {
      postprocessorAdapterId: adapter.postprocessorAdapterId,
      adapterVersion: adapter.adapterVersion,
      implementationDigest: adapter.implementationDigest,
    },
    compatibilityEvidence: { claim: 'notClaimed' },
    artifacts: [
      {
        artifactId,
        kind: request.kind,
        schemaVersion: request.schemaVersion,
        fileName: request.fileName,
        sha256,
      },
    ],
    delivery: request.delivery ?? { mode: 'unified' },
    createdAt: job.provenance.generatedAt,
    validationStatus: profile.supportStatus,
    nonProductionValidationArtifact: true,
  };

  return {
    artifact,
    manifest,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

/** Deterministic manifest comparison key (for tests and evidence packs). */
export function manifestComparisonKey(manifest: ArtifactManifest): string {
  return canonicalJson(manifest);
}
