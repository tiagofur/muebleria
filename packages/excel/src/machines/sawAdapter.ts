/**
 * HOMAG SAW postprocessor adapter boundary (#351 foundation).
 *
 * FIELD_FORMAT_EVIDENCE_REQUIRED: the client's cutting workflow accepts SAW
 * (owner relay, 2026-09-06) but the repository holds NO `.saw` sample or
 * specification. Until one arrives, this adapter fails closed — it never
 * reuses PTX bytes under a `.saw` name and never invents record syntax.
 *
 * Needed from Client A (docs/machines/client-a/machine-b-hpp250.md §3):
 * one real `.saw` file already accepted by their workflow + the exact
 * software/version that produced it. With that sample, `saw-homag` publishes
 * a new revision with evidenced dimensions and the serializer lands here —
 * no neutral-domain change required.
 */

import {
  AdapterSerializationBlocked,
  type AdapterReadiness,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
  type ResolvedCuttingJob,
} from '@granete/domain';
import { checkFormatFamily } from './ptxAdapter';
import { SAW_REQUIRED_DIMENSIONS } from './profiles';

/** Canonical identity of the (pending) serialization behavior; see PTX adapter. */
export const SAW_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'homag-saw',
  adapterVersion: '0.1.0',
  producedFormatFamily: 'saw',
  generator: 'pending-evidence',
} as const;

function pendingReasons(profile: OutputCompatibilityProfile): AdapterReadiness['reasons'] {
  const reasons = [];
  for (const dimension of SAW_REQUIRED_DIMENSIONS) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED' as const,
        dimension,
        detail: `SAW dimension '${dimension}' requires a real .saw sample/spec from Client A before serialization`,
      });
    }
  }
  return reasons;
}

export const SAW_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedCuttingJob> = {
  postprocessorAdapterId: 'homag-saw',
  adapterVersion: '0.1.0',
  implementationDigest: 'c6278fffdde1296eb508772d7a240c06695bba8b4bcac2e59b64761b38a74e9e',
  producedFormatFamily: 'saw',
  requiredDimensions: SAW_REQUIRED_DIMENSIONS,

  canSerialize(_job: ResolvedCuttingJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons = [...checkFormatFamily(profile, 'saw'), ...pendingReasons(profile)];
    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: ResolvedCuttingJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    // Unreachable until saw-homag publishes an evidenced revision: the
    // serializer is intentionally not implemented ahead of its evidence.
    throw new AdapterSerializationBlocked([
      {
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        detail: 'SAW serializer implementation pending its first evidenced profile revision',
      },
    ]);
  },
};
