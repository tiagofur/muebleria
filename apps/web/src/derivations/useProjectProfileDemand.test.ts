import { describe, expect, it } from 'vitest';

import {
  demandUnitsFromProject,
  extractDemandLines,
} from './useProjectProfileDemand';
import type { Project } from '@granete/domain';

const catalog = {
  modules: [
    { id: 'mod-structure', structureId: 'struct-1' },
    { id: 'mod-free', structureId: '' },
  ],
};

const project = (items: Project['items']): Project =>
  ({
    id: 'proj-1',
    name: 'P',
    customerId: 'C',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items,
    createdAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  }) as Project;

describe('demandUnitsFromProject (#989)', () => {
  it('mirrors the Go skip contract: explicit dims or structure-independent only', () => {
    const units = demandUnitsFromProject(
      project([
        {
          id: 'i-placed',
          moduleId: 'mod-structure',
          quantity: 1,
          optionChoices: { BODY: 'mat-a' },
          customDims: { widthMm: 600, heightMm: 720, depthMm: 560 },
        },
        {
          id: 'i-preset',
          moduleId: 'mod-structure',
          quantity: 1,
          optionChoices: { BODY: 'mat-a' },
          // preset-driven structure module without placed dims: the named
          // limitation — the release path cannot derive it either.
        },
        {
          id: 'i-free',
          moduleId: 'mod-free',
          quantity: 2,
          optionChoices: { INTERIOR: 'mat-a' },
        },
        {
          id: 'i-ghost',
          moduleId: 'mod-missing',
          quantity: 1,
          optionChoices: {},
        },
      ]),
      catalog,
    );
    expect(units.map((unit) => unit.itemId)).toEqual(['i-placed', 'i-free']);
    expect(units[0]?.parameters).toEqual({ widthMm: 600, heightMm: 720, depthMm: 560 });
    expect(units[1]?.parameters).toEqual({});
  });
});

describe('extractDemandLines (#989)', () => {
  it('extracts hardwareId/quantity fail-closed from the resolve response', () => {
    const lines = extractDemandLines({
      resolved: {
        machining: {
          hardwareProfileDemand: [
            {
              hardwareId: 'hw-a',
              quantity: 2,
              sources: [
                {
                  technicalProfileId: 'prof-1',
                  technicalProfileRevision: 'rev-1',
                  recipeId: 'r',
                  recipeRevision: 'rev-1',
                  relationshipId: 'rel-1',
                  contactCount: 2,
                },
              ],
            },
          ],
        },
      },
    });
    expect(lines).toEqual([{ hardwareId: 'hw-a', quantity: 2 }]);
  });

  it('treats absent demand as empty (org without pinned profiles)', () => {
    expect(extractDemandLines({ resolved: { machining: {} } })).toEqual([]);
  });

  it('fails closed on malformed demand', () => {
    expect(() =>
      extractDemandLines({ resolved: { machining: { hardwareProfileDemand: 'nope' } } }),
    ).toThrow();
    expect(() =>
      extractDemandLines({
        resolved: { machining: { hardwareProfileDemand: [{ hardwareId: '', quantity: 1 }] } },
      }),
    ).toThrow();
    expect(() =>
      extractDemandLines({
        resolved: { machining: { hardwareProfileDemand: [{ hardwareId: 'hw-a', quantity: 0 }] } },
      }),
    ).toThrow();
  });
});
