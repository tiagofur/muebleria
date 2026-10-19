import { describe, expect, it } from 'vitest';
import type { ProjectedAssembly, ProjectedRigidMember } from '@granete/domain';
import {
  assemblyMemberSelectionEquals,
  describeAssemblyRenderStatus,
  findSelectedAssemblyMember,
} from './assemblyMemberSelection';

const IDENTITY = {
  translationMm: [0, 0, 0] as const,
  basis: { x: [1, 0, 0] as const, y: [0, 1, 0] as const, z: [0, 0, 1] as const },
};

function member(
  memberId: string,
  overrides: Partial<ProjectedRigidMember> = {},
): ProjectedRigidMember {
  return {
    memberId,
    role: memberId.replace('-', '_'),
    hardwareId: 'hw-runner-500',
    bomRole: 'included_in_kit',
    localTransform: IDENTITY,
    effectiveTransform: IDENTITY,
    renderStatus: 'exact',
    assetRevisionId: 'rev-1',
    ...overrides,
  };
}

/**
 * Two drawers resolved from ONE recipe: identical memberIds, distinct
 * assemblyInstanceIds. This is exactly the FI-A / FI-B shape of #670.
 */
function twoDrawers(): readonly ProjectedAssembly[] {
  const build = (instanceId: string, bottomWidth: number): ProjectedAssembly => ({
    assemblyInstanceId: instanceId,
    agregadoId: 'agr-merivobox-m',
    recipeRevision: 3,
    isHistorical: false,
    placement: { originMm: [0, 0, 0] },
    rigidMembers: [member('side-left'), member('side-right')],
    fabricatedComponents: [
      {
        componentId: 'comp-bottom',
        quantity: 1,
        widthMm: bottomWidth,
        lengthMm: 484,
        thicknessMm: 16,
        materialId: 'mat-mdf-16',
        transform: IDENTITY,
      },
    ],
  });
  return [build('fi-a', 512), build('fi-b', 712)];
}

describe('findSelectedAssemblyMember (#670 exact-node navigation)', () => {
  it('resolves the member of the exact instance even when another instance shares the memberId', () => {
    const assemblies = twoDrawers();
    const hit = findSelectedAssemblyMember(assemblies, {
      kind: 'rigid',
      assemblyInstanceId: 'fi-b',
      memberId: 'side-right',
    });
    expect(hit?.kind).toBe('rigid');
    expect(hit?.assembly.assemblyInstanceId).toBe('fi-b');
    if (hit?.kind === 'rigid') expect(hit.member.memberId).toBe('side-right');
  });

  it('resolves the fabricated component of the exact instance (FI-A width differs from FI-B)', () => {
    const assemblies = twoDrawers();
    const a = findSelectedAssemblyMember(assemblies, {
      kind: 'fabricated',
      assemblyInstanceId: 'fi-a',
      componentId: 'comp-bottom',
    });
    const b = findSelectedAssemblyMember(assemblies, {
      kind: 'fabricated',
      assemblyInstanceId: 'fi-b',
      componentId: 'comp-bottom',
    });
    expect(a?.kind).toBe('fabricated');
    expect(b?.kind).toBe('fabricated');
    if (a?.kind === 'fabricated' && b?.kind === 'fabricated') {
      expect(a.component.widthMm).toBe(512);
      expect(b.component.widthMm).toBe(712);
    }
  });

  it('never falls back to another assembly when the selected instance is gone (stale → null)', () => {
    const assemblies = twoDrawers().filter((a) => a.assemblyInstanceId !== 'fi-b');
    const hit = findSelectedAssemblyMember(assemblies, {
      kind: 'rigid',
      assemblyInstanceId: 'fi-b',
      memberId: 'side-right',
    });
    expect(hit).toBeNull();
  });

  it('returns null when the instance exists but the member does not', () => {
    const hit = findSelectedAssemblyMember(twoDrawers(), {
      kind: 'rigid',
      assemblyInstanceId: 'fi-a',
      memberId: 'runner-left',
    });
    expect(hit).toBeNull();
  });

  it('returns null for empty inputs', () => {
    expect(findSelectedAssemblyMember(undefined, null)).toBeNull();
    expect(findSelectedAssemblyMember([], { kind: 'rigid', assemblyInstanceId: 'x', memberId: 'y' })).toBeNull();
    expect(findSelectedAssemblyMember(twoDrawers(), null)).toBeNull();
  });
});

describe('assemblyMemberSelectionEquals', () => {
  it('treats same instance + same node as equal, and differing instance as different', () => {
    const a = { kind: 'rigid', assemblyInstanceId: 'fi-a', memberId: 'side-left' } as const;
    expect(assemblyMemberSelectionEquals(a, { ...a })).toBe(true);
    expect(assemblyMemberSelectionEquals(a, { ...a, assemblyInstanceId: 'fi-b' })).toBe(false);
    expect(assemblyMemberSelectionEquals(a, { ...a, memberId: 'side-right' })).toBe(false);
  });

  it('distinguishes rigid from fabricated and handles null', () => {
    const rigid = { kind: 'rigid', assemblyInstanceId: 'fi-a', memberId: 'x' } as const;
    const fab = { kind: 'fabricated', assemblyInstanceId: 'fi-a', componentId: 'x' } as const;
    expect(assemblyMemberSelectionEquals(rigid, fab)).toBe(false);
    expect(assemblyMemberSelectionEquals(null, null)).toBe(true);
    expect(assemblyMemberSelectionEquals(rigid, null)).toBe(false);
  });
});

describe('describeAssemblyRenderStatus', () => {
  it('maps every render status to a Spanish label with a tone', () => {
    expect(describeAssemblyRenderStatus('exact')).toEqual({
      label: 'Exacta (recurso 3D fijado)',
      tone: 'ok',
    });
    expect(describeAssemblyRenderStatus('proxy').tone).toBe('warning');
    expect(describeAssemblyRenderStatus('historical_asset_missing').tone).toBe('danger');
    expect(describeAssemblyRenderStatus('asset_load_failed').tone).toBe('danger');
    expect(describeAssemblyRenderStatus('snapshot_invalid').tone).toBe('danger');
  });

  it('fails loud on an unknown status instead of rendering a silent fallback', () => {
    expect(() =>
      describeAssemblyRenderStatus('something_else' as unknown as 'exact'),
    ).toThrow(/unknown render status/);
  });
});
