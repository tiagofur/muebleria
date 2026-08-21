/**
 * Project drilling assembler (F130) — real source for exports.
 */

import { describe, expect, it } from 'vitest';
import { resolveProjectDrilling } from './projectDrilling';
import {
  IDS,
  plantillaChoices,
  plantillaCatalogWithModules,
  plantillaProject,
} from './__fixtures__/plantillaDemo';

const catalog = plantillaCatalogWithModules;

describe('resolveProjectDrilling', () => {
  const result = resolveProjectDrilling({
    project: { ...plantillaProject, items: plantillaProject.items.filter((i) => i.id === IDS.itemGab) },
    catalog,
    generatedAt: '2026-08-21T00:00:00.000Z',
  });

  it('produce un patrón por línea de corte, keyeado por labelRef de taller', () => {
    expect(result.patterns.length).toBe(result.links.length);
    expect(result.patterns.length).toBeGreaterThan(0);
    for (const pattern of result.patterns) {
      const link = result.links.find((l) => l.labelRef === pattern.pieceCode);
      expect(link, pattern.pieceCode).toBeDefined();
    }
  });

  it('el gabete deriva perforaciones reales (minifix en costado y piso, sin fallback)', () => {
    const lateral = result.patterns.find((p) => p.partName.includes('Costado'));
    expect(lateral).toBeDefined();
    expect(lateral!.fallbackUsed).toBe(false);
    // Cámaras minifix (floor) + pernos via piso + placas bisagra + pasantes no (fondo aparte)
    expect(lateral!.holes.some((h) => h.type === 'minifix')).toBe(true);
    expect(lateral!.holes.some((h) => h.type === 'hinge')).toBe(true);

    const piso = result.patterns.find((p) => p.partName.includes('Piso'));
    expect(piso!.holes.some((h) => h.type === 'minifix')).toBe(true);

    const puerta = result.patterns.find((p) => p.partName.includes('Puerta'));
    expect(puerta!.holes.filter((h) => h.type === 'hinge' && h.diameterMm === 35)).toHaveLength(2);

    const fondo = result.patterns.find((p) => p.partName.includes('Respaldo'));
    expect(fondo!.holes.every((h) => h.type === 'screw')).toBe(true);
  });

  it('schema muebles.drilling-data.v1 intacto con conteos consistentes', () => {
    expect(result.data.schema).toBe('muebles.drilling-data.v1');
    expect(result.data.projectId).toBe(plantillaProject.id);
    expect(result.data.totalPiecesCount).toBe(result.patterns.length);
    expect(result.data.totalHolesCount).toBe(
      result.patterns.reduce((sum, p) => sum + p.holes.length, 0),
    );
    for (const p of result.data.patterns) {
      expect(typeof p.pieceCode).toBe('string');
      expect(typeof p.lengthMm).toBe('number');
      expect(Array.isArray(p.holes)).toBe(true);
    }
  });

  it('sin issues de geometría en ninguna pieza del gabete', () => {
    const withIssues = result.patterns.filter((p) => p.issues.length > 0);
    expect(
      withIssues.map((p) => `${p.partName}: ${p.issues.map((i) => i.message).join(' | ')}`),
    ).toEqual([]);
  });

  it('respetar choices de opciones (project-level) sin romper la resolución', () => {
    const alt = resolveProjectDrilling({
      project: {
        ...plantillaProject,
        items: [
          {
            id: IDS.itemGab,
            moduleId: IDS.modGab,
            quantity: 2,
            optionChoices: plantillaChoices,
          },
        ],
      },
      catalog,
    });
    // quantity 2 no duplica patrones (los agujeros son iguales por copia)
    expect(alt.patterns.length).toBe(result.patterns.length);
    expect(alt.data.totalHolesCount).toBe(result.data.totalHolesCount);
  });
});
