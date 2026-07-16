import { describe, expect, it } from 'vitest';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaProject,
} from '@muebles/domain/fixtures';
import type { Project } from '@muebles/domain';
import {
  buildPieceLabelsExport,
  pieceLabelsFileName,
} from './exportPieceLabels';

describe('pieceLabelsFileName', () => {
  it('builds etiquetas-{name}.pdf with safe characters', () => {
    expect(pieceLabelsFileName('Mobiliario Residencial')).toBe(
      'etiquetas-Mobiliario-Residencial.pdf',
    );
    expect(pieceLabelsFileName('   ')).toBe('etiquetas-proyecto.pdf');
  });
});

describe('buildPieceLabelsExport (F046)', () => {
  it('builds non-empty PDF for plantilla project', async () => {
    const result = await buildPieceLabelsExport(
      plantillaProject,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes.byteLength).toBeGreaterThan(200);
    expect(result.fileName).toMatch(/^etiquetas-.*\.pdf$/);
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
    const result = await buildPieceLabelsExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('gab-only with complete choices exports', async () => {
    const project: Project = {
      id: 'p',
      name: 'Demo Gab',
      customerId: 'C',
      currency: 'UYU',
      marginFactor: 1.35,
      laborFixedCost: 0,
      status: 'accepted',
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
    const result = await buildPieceLabelsExport(
      project,
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
  });
});
