/**
 * PTX postprocessor adapter (#351 foundation).
 *
 * One serializer (packages/excel/src/ptxCutPlanExport.ts — unchanged) driven
 * by versioned OutputCompatibilityProfiles. Today only `ptx-generic` carries
 * evidenced syntax dimensions; every CADmatic-targeted profile has zero
 * evidenced dimensions and therefore fails closed. When field evidence for a
 * CADmatic dialect arrives, it lands as new profile data (encoding, decimals,
 * record syntax…) — the adapter consumes dimensions, it never guesses them
 * and never forks into per-client serializers.
 */

import {
  AdapterSerializationBlocked,
  type AdapterBlockReason,
  type AdapterReadiness,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
  type ResolvedCuttingJob,
} from '@granete/domain';
import { generatePtxString } from '../ptxCutPlanExport';
import { PTX_REQUIRED_DIMENSIONS } from './profiles';

function checkRequiredDimensions(
  profile: OutputCompatibilityProfile,
  required: readonly string[],
): readonly AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [];
  for (const dimension of required) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        dimension,
        detail: `dimension '${dimension}' of profile ${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId} has no field/repo evidence`,
      });
    }
  }
  return reasons;
}

export function checkFormatFamily(
  profile: OutputCompatibilityProfile,
  expected: PostprocessorAdapter['producedFormatFamily'],
): readonly AdapterBlockReason[] {
  return profile.formatFamily === expected
    ? []
    : [
        {
          code: 'FORMAT_FAMILY_MISMATCH',
          detail: `profile ${profile.ref.outputCompatibilityProfileId} is family '${profile.formatFamily}'; adapter produces '${expected}'`,
        },
      ];
}

/**
 * Canonical identity of the serialization behavior. Tests hash this and
 * compare against implementationDigest, so any behavior-relevant change
 * forces a new digest (and a new adapter version).
 */
export const PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.0.0',
  producedFormatFamily: 'ptx',
  generator: 'packages/excel/src/ptxCutPlanExport.ts@1',
} as const;

export const PTX_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedCuttingJob> = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.0.0',
  implementationDigest: '39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28',
  producedFormatFamily: 'ptx',
  requiredDimensions: PTX_REQUIRED_DIMENSIONS,

  canSerialize(job: ResolvedCuttingJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons: AdapterBlockReason[] = [
      ...checkFormatFamily(profile, 'ptx'),
      ...checkRequiredDimensions(profile, PTX_REQUIRED_DIMENSIONS),
    ];
    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: ResolvedCuttingJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    const presentation = job.presentation ?? {};
    return new TextEncoder().encode(
      generatePtxString({
        cutPlan: job.cutPlan,
        projectName: presentation.projectName,
        customerName: presentation.customerName,
        projectCode: presentation.projectCode,
      }),
    );
  },
};
