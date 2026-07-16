import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSHOP_SETTINGS,
  resolveWorkshopSettings,
  withWorkshopSettings,
} from './workshopSettings';
import type { Workspace } from './types';

describe('workshopSettings (F031 / #37)', () => {
  it('returns product defaults when missing', () => {
    expect(resolveWorkshopSettings(undefined)).toEqual(
      DEFAULT_WORKSHOP_SETTINGS,
    );
    expect(resolveWorkshopSettings(null)).toEqual(DEFAULT_WORKSHOP_SETTINGS);
  });

  it('merges partial settings and normalizes currency', () => {
    expect(
      resolveWorkshopSettings({
        defaultMarginFactor: 1.5,
        defaultLaborFixedCost: 100,
        defaultCurrency: ' mxn ',
      }),
    ).toEqual({
      defaultMarginFactor: 1.5,
      defaultLaborFixedCost: 100,
      defaultCurrency: 'MXN',
    });
  });

  it('rejects invalid numbers and falls back to defaults', () => {
    expect(
      resolveWorkshopSettings({
        defaultMarginFactor: 0,
        defaultLaborFixedCost: -1,
        defaultCurrency: '',
      }),
    ).toEqual(DEFAULT_WORKSHOP_SETTINGS);
  });

  it('withWorkshopSettings fills settings without touching projects', () => {
    const ws = {
      schemaVersion: 2,
      catalog: {
        materials: [],
        edges: [],
        hardware: [],
        optionGroups: [],
        modules: [],
      },
      projects: [{ id: 'p1' }],
    } as unknown as Workspace;
    const next = withWorkshopSettings(ws);
    expect(next.settings).toEqual(DEFAULT_WORKSHOP_SETTINGS);
    expect(next.projects).toBe(ws.projects);
  });
});
