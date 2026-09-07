import { describe, expect, it } from 'vitest';
import type { MachineOutputSelection } from '@granete/domain';
import {
  KNOWN_MACHINE_PROFILES,
  KNOWN_OUTPUT_PROFILES,
  resolveManufacturingOutputTarget,
} from './outputSelectionResolver';
import {
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_4_PROFILE,
  PTX_GENERIC_PROFILE,
} from './profiles';
import { PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR, PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import { buildFixtureCuttingJob } from './machineOutputFixtures';
import { generateMachineArtifact } from './machineArtifacts';

function cuttingSelection(profileId: string): MachineOutputSelection {
  const profile = KNOWN_OUTPUT_PROFILES.find(
    (p) => p.ref.outputCompatibilityProfileId === profileId,
  )!;
  return {
    operation: 'cutting',
    machineProfileId: CLIENT_A_HPP250_PROFILE.ref.machineProfileId,
    machineProfileRevisionId: CLIENT_A_HPP250_PROFILE.ref.machineProfileRevisionId,
    outputCompatibilityProfileId: profile.ref.outputCompatibilityProfileId,
    outputCompatibilityProfileRevisionId: profile.ref.revisionId,
    postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
    postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
    postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
  };
}

describe('resolveManufacturingOutputTarget', () => {
  it('returns NO_OUTPUT_CONFIGURED when nothing is selected (never a silent default)', () => {
    const result = resolveManufacturingOutputTarget(undefined, 'cutting');
    expect(result.status).toBe('NO_OUTPUT_CONFIGURED');
    const wrongOperation = resolveManufacturingOutputTarget(
      cuttingSelection('ptx-generic'),
      'machining',
    );
    expect(wrongOperation.status).toBe('NO_OUTPUT_CONFIGURED');
  });

  it('resolves the exact selected generic tuple as ready with zero blockers', () => {
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-generic'), 'cutting');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.machineLabel).toBe('HOLZMA (HOMAG) HPP 250');
    expect(result.profileLabel).toBe('ptx-generic@r1');
    expect(result.adapterLabel).toBe(`granete-ptx · ${PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR.adapterVersion}`);
    expect(result.supportStatus).toBe('NOT_TESTED');
    expect(result.readiness.ready).toBe(true);
    expect(result.readiness.reasons).toEqual([]);
  });

  it('blocked CADmatic 4 surfaces missing-evidence reasons and NEVER falls back', () => {
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-cadmatic-4'), 'cutting');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.profileLabel).toBe('ptx-cadmatic-4@r1');
    expect(result.readiness.ready).toBe(false);
    const codes = result.readiness.reasons.map((r) => r.code);
    expect(codes).toContain('FIELD_FORMAT_EVIDENCE_REQUIRED');
    expect(codes).not.toContain('SERIALIZER_NOT_IMPLEMENTED');
    // The selected profile stays CADmatic 4 — no generic substitution.
    expect(result.selection.outputCompatibilityProfileId).toBe('ptx-cadmatic-4');
  });

  it('machining with pending MPR serializer surfaces SERIALIZER_NOT_IMPLEMENTED', () => {
    const selection: MachineOutputSelection = {
      operation: 'machining',
      machineProfileId: 'client-a-machine-a-bhx050',
      machineProfileRevisionId: 'r1',
      outputCompatibilityProfileId: 'mpr-woodwop',
      outputCompatibilityProfileRevisionId: 'r1',
      postprocessorAdapterId: 'woodwop-mpr',
      postprocessorAdapterVersion: '0.1.0',
      postprocessorImplementationDigest: '4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782',
    };
    const result = resolveManufacturingOutputTarget(selection, 'machining');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reasons.map((r) => r.code)).toContain('SERIALIZER_NOT_IMPLEMENTED');
  });

  it('stale references surface typed blockers instead of substituting another profile', () => {
    const stale = {
      ...cuttingSelection('ptx-generic'),
      outputCompatibilityProfileRevisionId: 'r0',
    };
    const result = resolveManufacturingOutputTarget(stale, 'cutting');
    expect(result.status).toBe('CONFIGURED');
    if (result.status !== 'CONFIGURED') return;
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reasons.map((r) => r.code)).toContain('PROFILE_DIGEST_MISMATCH');
    // Still the selected profile — never another one.
    expect(result.profileLabel).toBe('ptx-generic@r1');
    expect(result.selection.outputCompatibilityProfileRevisionId).toBe('r0');
  });

  it('at most one target per operation — the resolver returns a single tuple, never a list', () => {
    for (const machine of KNOWN_MACHINE_PROFILES) {
      expect(machine.identity.opaqueClientKey).toBe('client-a');
    }
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-generic'), 'cutting');
    expect(Array.isArray((result as { selection?: unknown }).selection)).toBe(false);
  });

  it('generating through the resolved ready target produces exactly one output byte-identical to the golden', async () => {
    const result = resolveManufacturingOutputTarget(cuttingSelection('ptx-generic'), 'cutting');
    expect(result.status === 'CONFIGURED' && result.readiness.ready).toBe(true);
    if (result.status !== 'CONFIGURED' || !result.readiness.ready) return;

    const bundle = await generateMachineArtifact({
      job: buildFixtureCuttingJob(),
      adapter: PTX_POSTPROCESSOR_ADAPTER,
      profile: PTX_GENERIC_PROFILE,
      kind: 'ptx',
      schemaVersion: '1.14',
      fileName: 'corte-seleccionado.ptx',
      machineProfile: {
        ref: CLIENT_A_HPP250_PROFILE.ref,
        supported: CLIENT_A_HPP250_PROFILE.supported,
      },
    });
    expect(bundle.manifest.artifacts).toHaveLength(1);
    expect(bundle.artifact.sha256).toBe(
      '544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09',
    );
  });
});
