import { describe, expect, it } from 'vitest';
import { deriveProjectPartExecutions } from './partExecutionDerivation';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaProject,
} from './__fixtures__/plantillaDemo';

/**
 * Derivation from the catalog BOM (#301): pieces expand with real routing —
 * CNC only when the drilling resolver yields holes for the piece — and one
 * physical unit per unit of line quantity.
 */
describe('deriveProjectPartExecutions — del BOM del catálogo a las piezas físicas', () => {
  const releasedAt = '2026-08-21T10:00:00.000Z';
  const project = {
    ...plantillaProject,
    productionRelease: {
      id: 'rel-2026-08-21',
      projectId: plantillaProject.id,
      projectVersion: plantillaProject.version ?? 1,
      designRevisionId: 'dr-1',
      bomFingerprint: 'fp-1',
      releasedBy: 'sup-1',
      releasedAt,
      checks: [],
    },
  };

  it('deriva piezas y unidades con la revisión liberada', () => {
    const result = deriveProjectPartExecutions(project, plantillaCatalogWithModules);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { parts, units } = result.executions;
    expect(parts.length).toBeGreaterThan(0);
    expect(units.length).toBe(plantillaProject.items.reduce((acc, i) => acc + i.quantity, 0));
    for (const p of parts) expect(p.productionRevision).toBe('rel-2026-08-21');
    for (const u of units) expect(u.productionRevision).toBe('rel-2026-08-21');
    // Toda ruta empieza en cut y termina antes de ready
    for (const p of parts) {
      expect(p.requiredOperations[0]?.type).toBe('cut');
      expect(p.status).toBe('pending');
    }
  });

  it('piezas con perforaciones reales reciben ruta CNC; las demás no', () => {
    const result = deriveProjectPartExecutions(
      { ...project, items: project.items.filter((i) => i.id === IDS.itemGab) },
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { parts } = result.executions;
    const withCnc = parts.filter((p) => p.requiredOperations.some((op) => op.type === 'cnc'));
    const withoutCnc = parts.filter((p) => !p.requiredOperations.some((op) => op.type === 'cnc'));
    // El gabete tiene minifix/bisagras en costados y piso (projectDrilling.test):
    // al menos esas piezas van por CNC, y no todas (las hay sin mecanizado).
    expect(withCnc.length).toBeGreaterThan(0);
    expect(withoutCnc.length).toBeGreaterThan(0);
  });

  it('reporta la línea que falla en vez de romper el release completo', () => {
    const broken = {
      ...project,
      items: [
        ...project.items,
        { id: 'item-roto', moduleId: 'mod-inexistente', quantity: 1, optionChoices: {} },
      ],
    };
    const result = deriveProjectPartExecutions(broken, plantillaCatalogWithModules);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.projectItemId).toBe('item-roto');
    expect(result.error.message).toContain('mod-inexistente');
  });
});
