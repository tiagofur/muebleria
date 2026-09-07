/**
 * Client A sanitized validation pack builder.
 *
 * ONE semantic fixture → every requested output variant. Only evidence-backed
 * serializers produce files; the rest are recorded as notGenerated with the
 * exact reason codes and the evidence still required. The pack is synthetic
 * (fixture-* identifiers), deterministic (fixed provenance timestamp) and
 * carries the non-production banners.
 */

import { AdapterSerializationBlocked, type AdapterBlockReason } from '@granete/domain';
import {
  buildFixtureCuttingJob,
  buildFixtureMachiningJob,
} from './machineOutputFixtures';
import { generateMachineArtifact, type MachineArtifactBundle } from './machineArtifacts';
import {
  PTX_POSTPROCESSOR_ADAPTER,
} from './ptxAdapter';
import { SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { WOODWOP_MPR_POSTPROCESSOR_ADAPTER } from './woodWopMprAdapter';
import {
  CLIENT_A_BHX050_PROFILE,
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
} from './profiles';

export interface GeneratedPackEntry {
  readonly name: string;
  readonly bundle: MachineArtifactBundle;
}

export interface NotGeneratedPackEntry {
  readonly name: string;
  readonly profileId: string;
  readonly reasons: readonly AdapterBlockReason[];
  readonly neededEvidence: readonly string[];
}

export interface ClientValidationPack {
  readonly packId: string;
  readonly generated: readonly GeneratedPackEntry[];
  readonly notGenerated: readonly NotGeneratedPackEntry[];
  readonly readme: string;
}

const CUTTING_TARGETS = [
  { name: 'test-generic', profile: PTX_GENERIC_PROFILE },
  { name: 'test-cadmatic3', profile: PTX_CADMATIC_3_PROFILE },
  { name: 'test-cadmatic4', profile: PTX_CADMATIC_4_PROFILE },
  { name: 'test-cadmatic5', profile: PTX_CADMATIC_5_PROFILE },
  { name: 'test-hpp250', profile: SAW_HOMAG_PROFILE, adapter: SAW_POSTPROCESSOR_ADAPTER, kind: 'saw' },
] as const;

export async function buildClientValidationPack(): Promise<ClientValidationPack> {
  const generated: GeneratedPackEntry[] = [];
  const notGenerated: NotGeneratedPackEntry[] = [];

  const cuttingJob = buildFixtureCuttingJob();
  for (const target of CUTTING_TARGETS) {
    const adapter = 'adapter' in target ? target.adapter : PTX_POSTPROCESSOR_ADAPTER;
    const profile = target.profile;
    const kind = 'kind' in target ? (target.kind as 'saw') : 'ptx';
    const fileName = `${target.name}.${profile.dimensions.fileExtension ?? 'pending'}`;
    try {
      const bundle = await generateMachineArtifact({
        job: cuttingJob,
        adapter: adapter as typeof PTX_POSTPROCESSOR_ADAPTER,
        profile,
        kind,
        schemaVersion: kind === 'ptx' ? '1.14' : 'pending-evidence',
        fileName,
        machineProfile: {
          ref: CLIENT_A_HPP250_PROFILE.ref,
          supported: CLIENT_A_HPP250_PROFILE.supported,
        },
      });
      generated.push({ name: target.name, bundle });
    } catch (error) {
      if (!(error instanceof AdapterSerializationBlocked)) throw error;
      notGenerated.push({
        name: target.name,
        profileId: `${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`,
        reasons: error.reasons,
        neededEvidence: profile.pendingEvidence,
      });
    }
  }

  const machiningJob = buildFixtureMachiningJob();
  try {
    const bundle = await generateMachineArtifact({
      job: machiningJob,
      adapter: WOODWOP_MPR_POSTPROCESSOR_ADAPTER,
      profile: MPR_WOODWOP_PROFILE,
      kind: 'mpr',
      schemaVersion: 'pending-evidence',
      fileName: `test-bhx050.${MPR_WOODWOP_PROFILE.dimensions.fileExtension ?? 'pending'}`,
      machineProfile: {
        ref: CLIENT_A_BHX050_PROFILE.ref,
        supported: CLIENT_A_BHX050_PROFILE.supported,
      },
    });
    generated.push({ name: 'test-bhx050', bundle });
  } catch (error) {
    if (!(error instanceof AdapterSerializationBlocked)) throw error;
    notGenerated.push({
      name: 'test-bhx050',
      profileId: `${MPR_WOODWOP_PROFILE.ref.outputCompatibilityProfileId}@${MPR_WOODWOP_PROFILE.ref.revisionId}`,
      reasons: error.reasons,
      neededEvidence: MPR_WOODWOP_PROFILE.pendingEvidence,
    });
  }

  return {
    packId: `client-a-validation-pack--${cuttingJob.provenance.generatedAt.slice(0, 10)}`,
    generated,
    notGenerated,
    readme: renderPackReadme(generated, notGenerated),
  };
}

function renderPackReadme(
  generated: readonly GeneratedPackEntry[],
  notGenerated: readonly NotGeneratedPackEntry[],
): string {
  const lines: string[] = [];
  lines.push('=================================================================');
  lines.push(' GRANETE — CLIENT A MACHINE VALIDATION PACK (SANITIZED)');
  lines.push('=================================================================');
  lines.push('');
  lines.push('NON-PRODUCTION VALIDATION ARTIFACT');
  lines.push('DO NOT EXECUTE PRODUCTION CUTTING/MACHINING');
  lines.push('');
  lines.push('All data is synthetic (fixture-* identifiers). No customer data.');
  lines.push('Every file below represents the SAME semantic fixture serialized');
  lines.push('through one adapter + one versioned output-compatibility profile.');
  lines.push('');
  lines.push('Generated files:');
  for (const entry of generated) {
    lines.push(
      `  ${entry.bundle.artifact.fileName}  sha256=${entry.bundle.artifact.sha256}  status=${entry.bundle.manifest.validationStatus} (NOT a compatibility claim)`,
    );
    lines.push(`    manifest: ${entry.name}.manifest.json`);
  }
  if (generated.length === 0) lines.push('  (none)');
  lines.push('');
  lines.push('NOT generated — format evidence required first:');
  for (const entry of notGenerated) {
    lines.push(`  ${entry.name} (${entry.profileId})`);
    lines.push(`    missing evidence: ${[...new Set(entry.reasons.map((r) => r.dimension ?? r.code))].join(', ')}`);
  }
  if (notGenerated.length === 0) lines.push('  (none)');
  lines.push('');
  lines.push('Procedure: docs/machines/client-a/client-test-procedure.md');
  lines.push('Send back: exact import/conversion result per file (verbatim error text,');
  lines.push('screenshots sanitized), never production programs.');
  lines.push('');
  return lines.join('\r\n');
}
