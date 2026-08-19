import { describe, expect, it } from 'vitest';
import {
  projectProcessStage,
  filterProjectsByProcessStage,
  canReleaseMaterials,
  isProductionReady,
  PROCESS_STAGE_LABELS_ES,
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
