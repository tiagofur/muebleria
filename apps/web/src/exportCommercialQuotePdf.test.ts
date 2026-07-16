import { describe, expect, it } from 'vitest';
import type { Catalog, Project } from '@muebles/domain';
import {
  buildCommercialQuotePdfExport,
  commercialQuotePdfFileName,
} from './exportCommercialQuotePdf';

const catalog: Catalog = {
  materials: [
    {
      id: 'mat-a',
      code: 'MAT-A',
      name: 'Melamina blanca',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: 15,
      grainDefault: false,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 25,
      active: true,
    },
  ],
  edges: [],
  hardware: [],
  optionGroups: [
    {
      id: 'g1',
      code: 'INTERIOR',
      name: 'Interior',
      kind: 'board',
      required: true,
      optionIds: ['mat-a'],
    },
  ],
  modules: [
    {
      id: 'mod-1',
      code: 'MOD-01',
      name: 'Bajo 600',
      boardParts: [
        {
          id: 'p1',
          code: 'MOD-01-P01',
          description: 'Lateral',
          quantity: 1,
          lengthMm: 720,
          widthMm: 560,
          edges: [
            { side: 'L1', enabled: false },
            { side: 'L2', enabled: false },
            { side: 'W1', enabled: false },
            { side: 'W2', enabled: false },
          ],
          optionRole: 'INTERIOR',
        },
      ],
      hardwareLines: [],
    },
  ],
  categories: [],
  customers: [{ id: 'c1', name: 'Cliente Demo', active: true }],
};

const draftProject: Project = {
  id: 'prj-1',
  name: 'Cocina Demo',
  customerId: 'c1',
  status: 'draft',
  currency: 'MXN',
  marginFactor: 1.35,
  laborFixedCost: 0,
  items: [
    {
      id: 'it-1',
      moduleId: 'mod-1',
      quantity: 1,
      optionChoices: { INTERIOR: 'mat-a' },
    },
  ],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};

describe('commercialQuotePdfFileName', () => {
  it('includes variant suffix', () => {
    expect(commercialQuotePdfFileName('Cocina Ana', 'detailed')).toBe(
      'cotizacion-Cocina-Ana-listado.pdf',
    );
    expect(commercialQuotePdfFileName('Cocina Ana', 'summary')).toBe(
      'cotizacion-Cocina-Ana-resumen.pdf',
    );
  });
});

describe('buildCommercialQuotePdfExport (F045)', () => {
  it('builds detailed and summary PDFs', async () => {
    const detailed = await buildCommercialQuotePdfExport(
      draftProject,
      catalog,
      catalog.customers ?? [],
      'detailed',
    );
    expect(detailed.ok).toBe(true);
    if (detailed.ok) {
      expect(detailed.fileName).toMatch(/listado\.pdf$/);
      expect(detailed.bytes.byteLength).toBeGreaterThan(300);
    }

    const summary = await buildCommercialQuotePdfExport(
      draftProject,
      catalog,
      catalog.customers ?? [],
      'summary',
    );
    expect(summary.ok).toBe(true);
    if (summary.ok) {
      expect(summary.fileName).toMatch(/resumen\.pdf$/);
    }
  });

  it('uses snapshot when project is closed', async () => {
    const closed: Project = {
      ...draftProject,
      status: 'quoted',
      priceSnapshot: {
        capturedAt: '2026-07-10T00:00:00.000Z',
        breakdown: {
          materialsCost: 50,
          edgeTotal: 10,
          hardwareTotal: 5,
          directCost: 65,
          laborModular: 0,
          laborFixedCost: 0,
          marginFactor: 1.35,
          salePrice: 87.75,
        },
      },
    };
    const result = await buildCommercialQuotePdfExport(
      closed,
      catalog,
      catalog.customers ?? [],
      'summary',
    );
    expect(result.ok).toBe(true);
  });

  it('fails without items', async () => {
    const empty: Project = { ...draftProject, items: [] };
    const result = await buildCommercialQuotePdfExport(empty, catalog, []);
    expect(result.ok).toBe(false);
  });
});
