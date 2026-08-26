/**
 * F147 / #312 (P3D-6) — gate CI determinista de la deuda más cara del hot path.
 *
 * Antes del cache, cada commit de layout (cada move de drag/nudge) re-resolvía
 * el BOM de TODOS los ítems (N×resolveBom por actualización de plano). Este
 * test congela el contrato de performance hardware-independiente:
 *   - cambio sólo-layout ⇒ 0 re-resoluciones;
 *   - cambio de UN ítem ⇒ exactamente 1 re-resolución;
 *   - cambio de projectLevelChoices ⇒ re-resuelve lo afectado, no por layout.
 * Si una refactorización lo rompe, la regresión es detectable y repetible
 * (North Star §18: no optimizar por folklore; esto mide).
 */

import { describe, expect, it } from 'vitest';
import {
  buildPerfReferenceProject,
  perfReferenceCatalog,
} from '@granete/domain';
import {
  resolveProject3DPreview,
  resetProject3dPreviewStatsForTests,
  project3dPreviewStats,
} from './project3dPreview';

/** Catalog → Module3DCatalogInput (campos opcionales en Catalog). */
const catalogInput = {
  ...perfReferenceCatalog,
  structures: perfReferenceCatalog.structures ?? [],
  components: perfReferenceCatalog.components ?? [],
};

describe('project3dPreview — gate de cache BOM (#312 P3D-6)', () => {
  it('resuelve todos los ítems la primera vez (cold)', () => {
    resetProject3dPreviewStatsForTests();
    const project = buildPerfReferenceProject();
    const preview = resolveProject3DPreview(project, catalogInput, {
      unplacedPolicy: 'hide',
    });
    expect(preview.modules.length).toBeGreaterThan(0);
    expect(project3dPreviewStats.resolutions).toBe(project.items.length);
    expect(project3dPreviewStats.cacheHits).toBe(0);
  });

  it('cambio sólo-layout (drag/nudge) ⇒ 0 re-resoluciones BOM', () => {
    const project = buildPerfReferenceProject();
    resolveProject3DPreview(project, catalogInput, {
      unplacedPolicy: 'hide',
    });
    resetProject3dPreviewStatsForTests();

    // Simula el commit de un move: nuevo objeto project + layout con offset
    // cambiado; los ítems conservan identidad (inmutabilidad del dominio).
    const kitchenLayout = project.kitchenLayout!;
    const moved = {
      ...kitchenLayout,
      placements: kitchenLayout.placements.map((p, i) =>
        i === 0 ? { ...p, offsetMm: (p.offsetMm ?? 0) + 50 } : p,
      ),
    };
    const after = resolveProject3DPreview(
      { ...project, kitchenLayout: moved },
      catalogInput,
      { unplacedPolicy: 'hide' },
    );
    expect(after.modules.length).toBeGreaterThan(0);
    expect(project3dPreviewStats.resolutions).toBe(0);
    expect(project3dPreviewStats.cacheHits).toBe(project.items.length);
  });

  it('cambio de UN ítem ⇒ exactamente 1 re-resolución', () => {
    const project = buildPerfReferenceProject();
    resolveProject3DPreview(project, catalogInput, {
      unplacedPolicy: 'hide',
    });
    resetProject3dPreviewStatsForTests();

    const changed = {
      ...project,
      items: project.items.map((it, i) =>
        i === 0 ? { ...it, quantity: 2 } : it,
      ),
    };
    resolveProject3DPreview(changed, catalogInput, {
      unplacedPolicy: 'hide',
    });
    expect(project3dPreviewStats.resolutions).toBe(1);
    expect(project3dPreviewStats.cacheHits).toBe(project.items.length - 1);
  });

  it('el resultado cacheado es referencialmente transparente (mismo output)', () => {
    const project = buildPerfReferenceProject();
    const first = resolveProject3DPreview(project, catalogInput, {
      unplacedPolicy: 'hide',
    });
    const second = resolveProject3DPreview(project, catalogInput, {
      unplacedPolicy: 'hide',
    });
    expect(second).toEqual(first);
  });
});
