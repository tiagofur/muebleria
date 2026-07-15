import { describe, expect, it } from 'vitest';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
} from '@muebles/domain/fixtures';
import type { Project } from '@muebles/domain';
import {
  buildHardwareListExport,
  hardwareListFileName,
} from './exportHardwareList';

describe('hardwareListFileName', () => {
  it('builds herrajes-{name}.xlsx with safe characters', () => {
    expect(hardwareListFileName('Mobiliario Residencial')).toBe(
      'herrajes-Mobiliario-Residencial.xlsx',
    );
    expect(hardwareListFileName('  a/b:c  ')).toBe('herrajes-abc.xlsx');
    expect(hardwareListFileName('   ')).toBe('herrajes-proyecto.xlsx');
  });
});

describe('buildHardwareListExport', () => {
  it('builds non-empty xlsx for plantilla project', async () => {
    const result = await buildHardwareListExport(
      plantillaProject,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(500);
    expect(result.fileName).toMatch(/^herrajes-.*\.xlsx$/);
  });

  it('returns issues when required options missing', async () => {
    const project: Project = {
      ...plantillaProject,
      items: [
        {
          id: 'item-gab',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: {},
        },
      ],
    };
    const result = await buildHardwareListExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.field === 'optionChoices')).toBe(true);
  });

  it('gab-only with complete choices exports', async () => {
    const project: Project = {
      id: 'p',
      name: 'Demo Gab',
      customerId: 'C',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'draft',
      items: [
        {
          id: 'i',
          moduleId: IDS.modGab,
          quantity: 1,
          optionChoices: plantillaChoices,
        },
      ],
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    };
    const result = await buildHardwareListExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
  });
});
