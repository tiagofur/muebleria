import { describe, expect, it } from 'vitest';
import {
  projectProcessStage,
  filterProjectsByProcessStage,
  canReleaseMaterials,
  isProductionReady,
  PROCESS_STAGE_LABELS_ES,
  sentToProduction,
  type MaterialsRelease,
} from './processStage';
import { canSendToProduction, type EngineeringLog } from './engineering';
import type { Project } from './types';

const RELEASE: MaterialsRelease = {
  releasedBy: 'almacen1',
  releasedAt: '2026-08-10T09:00:00Z',
};

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina',
    customerId: 'c1',
    ownerId: 'u1',
    currency: 'ARS',
    marginFactor: 1,
    laborFixedCost: 0,
    status: 'accepted',
    items: [],
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    ...overrides,
  } as Project;
}

function sentLog(): EngineeringLog {
  return {
    startedBy: 'ing1',
    startedAt: '2026-08-02T08:00:00Z',
    generatedBy: 'ing1',
    generatedAt: '2026-08-03T08:00:00Z',
    sentToProductionBy: 'ing1',
    sentToProductionAt: '2026-08-04T08:00:00Z',
    revision: 2,
  };
}

describe('projectProcessStage', () => {
  it('draft and quoted projects stay in ventas', () => {
    expect(projectProcessStage(makeProject({ status: 'draft' }))).toBe('ventas');
    expect(projectProcessStage(makeProject({ status: 'quoted' }))).toBe('ventas');
  });

  it('accepted without engineering send is ingenieria', () => {
    expect(projectProcessStage(makeProject())).toBe('ingenieria');
    // Even with an in-progress log (not sent yet).
    expect(
      projectProcessStage(
        makeProject({
          engineeringLog: { startedBy: 'ing1', startedAt: '2026-08-02T08:00:00Z', revision: 1 },
        }),
      ),
    ).toBe('ingenieria');
  });

  it('sent to production without materials release is almacen', () => {
    expect(
      projectProcessStage(makeProject({ engineeringLog: sentLog() })),
    ).toBe('almacen');
  });

  it('materials release moves the project to produccion', () => {
    expect(
      projectProcessStage(
        makeProject({ engineeringLog: sentLog(), materialsRelease: RELEASE }),
      ),
    ).toBe('produccion');
  });

  it('produced status still requires the full chain', () => {
    expect(projectProcessStage(makeProject({ status: 'produced' }))).toBe(
      'ingenieria',
    );
    expect(
      projectProcessStage(
        makeProject({ status: 'produced', engineeringLog: sentLog() }),
      ),
    ).toBe('almacen');
  });
});

describe('filterProjectsByProcessStage', () => {
  it('keeps only projects in the requested stage', () => {
    const all = [
      makeProject({ id: 'draft', status: 'draft' }),
      makeProject({ id: 'eng' }),
      makeProject({ id: 'wh', engineeringLog: sentLog() }),
      makeProject({ id: 'prod', engineeringLog: sentLog(), materialsRelease: RELEASE }),
    ];
    expect(filterProjectsByProcessStage(all, 'ventas').map((p) => p.id)).toEqual([
      'draft',
    ]);
    expect(filterProjectsByProcessStage(all, 'ingenieria').map((p) => p.id)).toEqual([
      'eng',
    ]);
    expect(filterProjectsByProcessStage(all, 'almacen').map((p) => p.id)).toEqual([
      'wh',
    ]);
    expect(filterProjectsByProcessStage(all, 'produccion').map((p) => p.id)).toEqual([
      'prod',
    ]);
  });
});

describe('canReleaseMaterials', () => {
  it('requires engineering sent and no prior release', () => {
    expect(canReleaseMaterials(makeProject())).toBe(false);
    expect(canReleaseMaterials(makeProject({ engineeringLog: sentLog() }))).toBe(
      true,
    );
    expect(
      canReleaseMaterials(
        makeProject({ engineeringLog: sentLog(), materialsRelease: RELEASE }),
      ),
    ).toBe(false);
  });

  it('ignores draft/quoted projects', () => {
    expect(
      canReleaseMaterials(makeProject({ status: 'draft', engineeringLog: sentLog() })),
    ).toBe(false);
  });
});

describe('canSendToProduction', () => {
  it('requires accepted status and documented engineering', () => {
    expect(canSendToProduction(makeProject())).toBe(false);
    expect(
      canSendToProduction(
        makeProject({
          engineeringLog: { startedBy: 'ing1', startedAt: '2026-08-02T08:00:00Z', revision: 1 },
        }),
      ),
    ).toBe(false);
    expect(
      canSendToProduction(
        makeProject({
          engineeringLog: {
            startedBy: 'ing1',
            startedAt: '2026-08-02T08:00:00Z',
            generatedBy: 'ing1',
            generatedAt: '2026-08-03T08:00:00Z',
            revision: 1,
          },
        }),
      ),
    ).toBe(true);
    expect(canSendToProduction(makeProject({ status: 'draft' }))).toBe(false);
  });
});

describe('isProductionReady', () => {
  it('returns true only for accepted/produced with materialsRelease', () => {
    expect(isProductionReady(makeProject())).toBe(false);
    expect(
      isProductionReady(makeProject({ engineeringLog: sentLog() })),
    ).toBe(false);
    expect(
      isProductionReady(
        makeProject({ engineeringLog: sentLog(), materialsRelease: RELEASE }),
      ),
    ).toBe(true);
    expect(
      isProductionReady(makeProject({ status: 'produced', materialsRelease: RELEASE })),
    ).toBe(true);
  });
});

describe('PROCESS_STAGE_LABELS_ES', () => {
  it('labels every stage in Spanish', () => {
    expect(PROCESS_STAGE_LABELS_ES.ingenieria).toBe('Ingeniería');
    expect(PROCESS_STAGE_LABELS_ES.almacen).toBe('Almacén');
  });
});

/* ── #738 — canonical release → Engineering entry ────────────────────────── */

/** Server-owned canonical release projection (#577) on the project read model. */
function canonicalRelease(
  overrides: Partial<Project['resolvedProductionRelease']> = {},
): NonNullable<Project['resolvedProductionRelease']> {
  return {
    source: 'canonical',
    releaseId: 'rel-1',
    releaseNumber: 1,
    designRevisionId: 'rev-2',
    designRevisionNumber: 2,
    quoteRevisionId: 'qrev-2',
    ...overrides,
  } as NonNullable<Project['resolvedProductionRelease']>;
}

describe('#738 projectProcessStage — canonical release', () => {
  it('draft + Q accepted + R approved + P1 enters ingenieria (not ventas)', () => {
    expect(
      projectProcessStage(
        makeProject({ status: 'draft', resolvedProductionRelease: canonicalRelease() }),
      ),
    ).toBe('ingenieria');
  });

  it('accepted + P1 without engineering evidence does NOT skip to almacen', () => {
    // P existence must not be interpreted as "engineering already sent":
    // no release-scoped material evidence ⇒ honest Ingeniería.
    expect(
      projectProcessStage(
        makeProject({ resolvedProductionRelease: canonicalRelease() }),
      ),
    ).toBe('ingenieria');
  });

  it('explicit release-scoped material evidence advances a canonical obra', () => {
    // Frozen requirements derived from the exact release = Almacén work
    // started (someone ran the release-scoped derive command).
    const derived = (extra: Partial<Project> = {}): Project =>
      makeProject({
        status: 'draft',
        resolvedProductionRelease: canonicalRelease(),
        materialPlanning: {
          id: 'mp-1',
          projectId: 'p1',
          requirements: {
            releaseId: 'rel-1',
            bomFingerprint: 'sha256-' + 'a'.repeat(64),
            derivedAt: '2026-09-10T10:00:00Z',
            derivedBy: 'almacen1',
            lines: [],
          },
          reservations: [],
        } as unknown as Project['materialPlanning'],
        ...extra,
      });
    expect(projectProcessStage(derived())).toBe('almacen');
    // The audited material authorization stamp (written by the
    // release-scoped /materials/release command) completes the physical
    // passage through Almacén.
    expect(
      projectProcessStage(derived({ materialsRelease: RELEASE })),
    ).toBe('produccion');
    // A materials stamp WITHOUT derived requirements is not release-scoped
    // material evidence — a legacy per-project stamp proves nothing about
    // THIS release (the requirements snapshot is the release-correlated
    // anchor the server controls).
    expect(
      projectProcessStage(
        makeProject({
          resolvedProductionRelease: canonicalRelease(),
          materialsRelease: RELEASE,
        }),
      ),
    ).toBe('ingenieria');
  });

  it('legacy handshake evidence never retargets a canonical obra past ingenieria', () => {
    expect(
      projectProcessStage(
        makeProject({
          resolvedProductionRelease: canonicalRelease(),
          engineeringLog: sentLog(),
        }),
      ),
    ).toBe('ingenieria');
  });

  it('a cancelled obra with a canonical release is not active engineering work', () => {
    expect(
      projectProcessStage(
        makeProject({
          status: 'accepted',
          cancelledAt: '2026-09-01T10:00:00Z',
          resolvedProductionRelease: canonicalRelease(),
        }),
      ),
    ).toBe('ventas');
  });

  it('a modern DT project with a residual accepted stamp and NO release stays ventas', () => {
    // Commercial acceptance alone never unlocks engineering for a modern
    // project: a positively modern project with a residual stamp and no
    // canonical release fails closed (the server always projects
    // hasDigitalThreadContext in API mode — #697).
    expect(
      projectProcessStage(
        makeProject({ status: 'accepted', hasDigitalThreadContext: true }),
      ),
    ).toBe('ventas');
    expect(
      projectProcessStage(
        makeProject({ status: 'produced', hasDigitalThreadContext: true }),
      ),
    ).toBe('ventas');
  });

  it('local mode (no DT projection) keeps the legacy chain', () => {
    // hasDigitalThreadContext is server-owned: undefined means local mode,
    // not a stale payload — the local legacy tool keeps working.
    expect(
      projectProcessStage(makeProject({ hasDigitalThreadContext: undefined })),
    ).toBe('ingenieria');
    expect(
      projectProcessStage(
        makeProject({ hasDigitalThreadContext: undefined, engineeringLog: sentLog() }),
      ),
    ).toBe('almacen');
  });

  it('pre-DT compatibility keeps the legacy chain when positively identified', () => {
    expect(projectProcessStage(makeProject({ hasDigitalThreadContext: false }))).toBe(
      'ingenieria',
    );
    expect(
      projectProcessStage(
        makeProject({ hasDigitalThreadContext: false, engineeringLog: sentLog() }),
      ),
    ).toBe('almacen');
  });
});

describe('#738 sentToProduction — P is not a fabricated legacy send', () => {
  it('canonical release alone is NOT a legacy engineering send', () => {
    expect(
      sentToProduction(
        makeProject({ resolvedProductionRelease: canonicalRelease() }),
      ),
    ).toBe(false);
  });

  it('only the legacy handshake log proves the send', () => {
    expect(sentToProduction(makeProject())).toBe(false);
    expect(sentToProduction(makeProject({ engineeringLog: sentLog() }))).toBe(true);
  });
});

describe('#738 canReleaseMaterials — canonical release is not legacy material evidence', () => {
  it('a canonical obra never receives the legacy materials stamp', () => {
    expect(
      canReleaseMaterials(
        makeProject({ resolvedProductionRelease: canonicalRelease() }),
      ),
    ).toBe(false);
  });
});
