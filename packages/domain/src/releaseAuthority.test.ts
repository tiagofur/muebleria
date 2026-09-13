/**
 * Release authority projection (#577 / OPS-DT-1): canonical wins over the
 * legacy blob, legacy-only compatibility, and the operational gates
 * (processStage) unlocked by a canonical release without the legacy
 * engineering handshake.
 */

import { describe, expect, it } from 'vitest';

import {
  canReleaseMaterials,
  projectAllowsProductionAccess,
  projectProcessStage,
  releaseAuthorityLabel,
  releaseAuthorityOf,
  type Project,
} from './index';
import type { ProductionRelease } from './projectLifecycle';

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1,
    laborFixedCost: 0,
    status: 'accepted',
    items: [],
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  } as Project;
}

const legacyBlob: ProductionRelease = {
  id: 'legacy-rel-1',
  projectId: 'p1',
  projectVersion: 2,
  designRevisionId: 'dr-legacy',
  bomFingerprint: 'legacy-fp',
  releasedBy: 'ing',
  releasedAt: '2026-01-01T00:00:00Z',
  checks: [],
};

describe('releaseAuthorityOf (#577)', () => {
  it('canonical projection wins over a coexisting legacy blob', () => {
    const project = baseProject({
      productionRelease: legacyBlob,
      resolvedProductionRelease: {
        source: 'canonical',
        releaseId: 'rel-canonical-1',
        releaseNumber: 1,
        designRevisionId: 'dr-2',
        designRevisionNumber: 2,
        quoteRevisionId: 'qr-2',
        manufacturingFingerprint: 'sha256-abc',
        status: 'active',
      },
    });
    const authority = releaseAuthorityOf(project);
    expect(authority?.source).toBe('canonical');
    expect(authority?.releaseId).toBe('rel-canonical-1');
    expect(authority?.manufacturingFingerprint).toBe('sha256-abc');
  });

  it('falls back to the legacy blob when no projection exists (local/old payloads)', () => {
    const authority = releaseAuthorityOf(baseProject({ productionRelease: legacyBlob }));
    expect(authority).toEqual({
      source: 'legacy',
      releaseId: 'legacy-rel-1',
      designRevisionId: 'dr-legacy',
      manufacturingFingerprint: 'legacy-fp',
    });
  });

  it('returns undefined when nothing was ever released', () => {
    expect(releaseAuthorityOf(baseProject())).toBeUndefined();
  });

  it('labels the release the way the user reads it', () => {
    expect(
      releaseAuthorityLabel(
        baseProject({
          resolvedProductionRelease: {
            source: 'canonical',
            releaseId: 'rel-1',
            releaseNumber: 1,
            designRevisionId: 'dr-2',
            designRevisionNumber: 2,
          },
        }),
      ),
    ).toBe('Liberación #1 · Diseño R2');
    expect(releaseAuthorityLabel(baseProject())).toBe('');
  });
});

describe('processStage — canonical release unlocks production (#577)', () => {
  it('a canonical release sends the obra past ingeniería without the legacy handshake', () => {
    const project = baseProject({
      resolvedProductionRelease: {
        source: 'canonical',
        releaseId: 'rel-1',
        releaseNumber: 1,
      },
    });
    expect(project.engineeringLog).toBeUndefined(); // no legacy stamp anywhere
    expect(projectProcessStage(project)).toBe('almacen');
    expect(canReleaseMaterials(project)).toBe(true);
  });

  it('legacy-only projects still require the engineering handshake', () => {
    const project = baseProject({ productionRelease: legacyBlob });
    expect(projectProcessStage(project)).toBe('ingenieria');
    expect(canReleaseMaterials(project)).toBe(false);
    const sent = baseProject({
      productionRelease: legacyBlob,
      engineeringLog: {
        startedBy: 'ing',
        startedAt: '2026-01-01T00:00:00Z',
        revision: 1,
        sentToProductionBy: 'ing',
        sentToProductionAt: '2026-01-02T00:00:00Z',
      },
    });
    expect(projectProcessStage(sent)).toBe('almacen');
  });
});

describe('projectAllowsProductionAccess (#697 review — one access rule)', () => {
  const canonical = {
    source: 'canonical' as const,
    releaseId: 'rel-1',
    releaseNumber: 1,
    designRevisionId: 'dr-1',
    designRevisionNumber: 2,
    quoteRevisionId: 'q-2',
    manufacturingFingerprint: 'sha256-abc',
  };

  it('canonical ProductionRelease opens production regardless of status', () => {
    expect(
      projectAllowsProductionAccess({
        status: 'draft',
        hasDigitalThreadContext: false,
        resolvedProductionRelease: canonical,
      }),
    ).toBe(true);
  });

  it('modern DT project with residual accepted|produced stamp and no release fails closed', () => {
    expect(projectAllowsProductionAccess({ status: 'accepted', hasDigitalThreadContext: true })).toBe(false);
    expect(projectAllowsProductionAccess({ status: 'produced', hasDigitalThreadContext: true })).toBe(false);
  });

  it('true pre-DT projects keep compatibility-only status access', () => {
    expect(projectAllowsProductionAccess({ status: 'accepted', hasDigitalThreadContext: false })).toBe(true);
    expect(projectAllowsProductionAccess({ status: 'produced', hasDigitalThreadContext: false })).toBe(true);
    expect(projectAllowsProductionAccess({ status: 'quoted', hasDigitalThreadContext: false })).toBe(false);
  });

  it('absent projection fails closed because pre-DT compatibility must be explicit', () => {
    expect(projectAllowsProductionAccess({ status: 'accepted' })).toBe(false);
    expect(projectAllowsProductionAccess({ status: 'produced' })).toBe(false);
    expect(projectAllowsProductionAccess({ status: 'draft' })).toBe(false);
  });
});
