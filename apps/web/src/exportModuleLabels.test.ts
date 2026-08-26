import { describe, expect, it } from 'vitest';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
} from '@granete/domain/fixtures';
import type { Project } from '@granete/domain';
import {
  buildModuleLabelsExport,
  moduleLabelsFileName,
} from './exportModuleLabels';

describe('moduleLabelsFileName', () => {
  it('builds etiquetas-muebles-{name}.pdf with safe characters', () => {
    expect(moduleLabelsFileName('Mobiliario Residencial')).toBe(
      'etiquetas-muebles-Mobiliario-Residencial.pdf',
    );
    expect(moduleLabelsFileName('   ')).toBe('etiquetas-muebles-proyecto.pdf');
  });
});

describe('buildModuleLabelsExport (F092)', () => {
  it('builds non-empty PDF for plantilla project', async () => {
    const result = await buildModuleLabelsExport(
      plantillaProject,
      plantillaCatalogWithModules,
      [{ id: plantillaProject.customerId, name: 'Cliente Ejemplo', active: true }],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(500);
    expect(result.fileName).toMatch(/^etiquetas-muebles-.*\.pdf$/);
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
    const result = await buildModuleLabelsExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('exports valid PDF with custom revision and QR format', async () => {
    const project: Project = {
      id: 'p-custom',
      name: 'Cocina Custom',
      customerId: 'c-1',
      status: 'accepted',
      currency: 'USD',
      marginFactor: 1.3,
      laborFixedCost: 0,
      items: [
        {
          id: 'i-1',
          moduleId: IDS.modGab,
          quantity: 2,
          optionChoices: plantillaChoices,
        },
      ],
      createdAt: '2026-08-01T10:00:00Z',
      updatedAt: '2026-08-01T10:00:00Z',
    };

    const result = await buildModuleLabelsExport(
      project,
      plantillaCatalogWithModules,
      [{ id: 'c-1', name: 'Juan Perez', active: true }],
      { revision: '3', qrFormat: 'url', qrHost: 'taller.app' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(500);
  });
});
