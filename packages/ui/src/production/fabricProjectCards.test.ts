import { describe, expect, it } from 'vitest';
import type { Project } from '@granete/domain';
import { fabricProjectCards } from './fabricProjectCards';

const project = {
  id: 'p1', name: 'Cocina', customerId: 'c1', status: 'accepted', currency: 'MXN',
  createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  items: [{ id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} }],
  materialsRelease: { releasedBy: 'alm1', releasedAt: '2026-08-18T08:00:00.000Z' },
} as unknown as Project;

describe('fabricProjectCards', () => {
  it('joins domain metrics, valid project × material picking and station claims into one project card', () => {
    const cards = fabricProjectCards({
      projects: [project],
      station: 'cutting',
      metricsByProject: {
        p1: {
          materials: [{ key: 'MEL-18', name: 'Melamina blanca', materialCode: 'MEL-18', thicknessMm: 18, pieces: 4, lines: 2, areaM2: 3.2 }],
          edges: [{ key: 'C-1', name: 'Canto blanco', edgeBandCode: 'C-1', thicknessMm: 1, ml: 8.5, pieces: 4, sides: 7 }],
          sheetEstimates: [{ materialId: 'mat-1', code: 'MEL-18', name: 'Melamina blanca', areaM2: 3.2, sheetWidthMm: 1220, sheetLengthMm: 2440, sheetAreaM2: 2.97, wastePercent: 10, estimatedSheets: 2 }],
          edgeBandColors: { 'C-1': '#ffffff' },
        },
      },
      pickingStates: [
        { projectId: 'p1', material: 'tableros', status: 'despachado' },
        { projectId: 'other', material: 'cintillas', status: 'despachado' },
      ],
      activeClaims: [{ activityId: 'a1', projectId: 'p1', sector: 'cutting', operatorName: 'Ana', startedAt: '2026-08-18T09:00:00.000Z' }],
      moduleLabelFor: () => 'MOD-1 · Bajo mesada',
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]?.materials[0]).toMatchObject({ estimatedSheets: 2, pickingStatus: 'despachado', pieces: 4, areaM2: 3.2 });
    expect(cards[0]?.edges[0]).toMatchObject({ previewColor: '#ffffff', sides: 7 });
    expect(cards[0]?.activeClaims[0]?.operatorName).toBe('Ana');
    expect(cards[0]?.items[0]?.moduleName).toBe('MOD-1 · Bajo mesada');
  });

  it('does not invent a material-level picking key for a different project', () => {
    const cards = fabricProjectCards({
      projects: [project], station: 'edge_banding', metricsByProject: {},
      pickingStates: [{ projectId: 'other', material: 'cintillas', status: 'despachado' }], activeClaims: [],
    });
    expect(cards).toHaveLength(0);
  });

  it('keeps the persisted category status separate from a missing association', () => {
    const cards = fabricProjectCards({
      projects: [project], station: 'cutting', metricsByProject: {
        p1: {
          materials: [{ key: 'MEL-18', name: 'Melamina blanca', pieces: 4, lines: 2, areaM2: 3.2 }],
          edges: [], sheetEstimates: [], edgeBandColors: {},
        },
      },
      pickingStates: [{ projectId: 'p1', material: 'tableros', status: 'pendiente' }], activeClaims: [],
    });

    expect(cards[0]?.materials[0]?.pickingStatus).toBe('pendiente');
    expect(cards[0]?.edges).toEqual([]);
  });

  it('excludes works whose materials were not released by Almacén (stage gate)', () => {
    const { materialsRelease: _released, ...unreleased } = project;
    const cards = fabricProjectCards({
      projects: [unreleased as unknown as Project],
      station: 'cutting',
      metricsByProject: {},
      pickingStates: [],
      activeClaims: [],
    });
    expect(cards).toHaveLength(0);
  });
});
