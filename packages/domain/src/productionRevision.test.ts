import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import {
  computeProductionDesignFingerprint,
  ensureProductionRevision,
  getProductionStaleInfo,
  recordProductionExport,
} from './productionRevision';

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      {
        id: 'i1',
        moduleId: 'm1',
        quantity: 1,
        optionChoices: { INTERIOR: 'mat-a' },
        measurePresetId: '600',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('productionRevision (PROD-3.2)', () => {
  it('fingerprint is stable for same design', () => {
    const a = computeProductionDesignFingerprint(project());
    const b = computeProductionDesignFingerprint(project());
    expect(a).toBe(b);
  });

  it('fingerprint ignores floorStatus', () => {
    const a = computeProductionDesignFingerprint(project());
    const b = computeProductionDesignFingerprint(
      project({
        items: [
          {
            id: 'i1',
            moduleId: 'm1',
            quantity: 1,
            optionChoices: { INTERIOR: 'mat-a' },
            measurePresetId: '600',
            floorStatus: 'cut',
          },
        ],
      }),
    );
    expect(a).toBe(b);
  });

  it('fingerprint changes when measure changes', () => {
    const a = computeProductionDesignFingerprint(project());
    const b = computeProductionDesignFingerprint(
      project({
        items: [
          {
            id: 'i1',
            moduleId: 'm1',
            quantity: 1,
            optionChoices: { INTERIOR: 'mat-a' },
            measurePresetId: '800',
          },
        ],
      }),
    );
    expect(a).not.toBe(b);
  });

  it('ensureProductionRevision creates revision 1', () => {
    const next = ensureProductionRevision(project(), '2026-03-01T00:00:00.000Z');
    expect(next.production?.revision).toBe(1);
    expect(next.production?.fingerprint).toBeTruthy();
  });

  it('detects stale export after design change', () => {
    let p = ensureProductionRevision(project(), '2026-03-01T00:00:00.000Z');
    p = recordProductionExport(p, '2026-03-01T01:00:00.000Z');
    expect(getProductionStaleInfo(p).stale).toBe(false);

    p = {
      ...p,
      items: [
        {
          id: 'i1',
          moduleId: 'm1',
          quantity: 2,
          optionChoices: { INTERIOR: 'mat-a' },
          measurePresetId: '600',
        },
      ],
    };
    const info = getProductionStaleInfo(p);
    expect(info.stale).toBe(true);
    expect(info.messageEs).toMatch(/diseño cambió/i);
  });

  it('bumps revision when design diverges from freeze fingerprint', () => {
    let p = ensureProductionRevision(project(), '2026-03-01T00:00:00.000Z');
    expect(p.production!.revision).toBe(1);
    p = {
      ...p,
      items: [
        {
          id: 'i1',
          moduleId: 'm1',
          quantity: 3,
          optionChoices: { INTERIOR: 'mat-a' },
          measurePresetId: '600',
        },
      ],
    };
    p = ensureProductionRevision(p, '2026-03-02T00:00:00.000Z');
    expect(p.production!.revision).toBe(2);
  });
});
