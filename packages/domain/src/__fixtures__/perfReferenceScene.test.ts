/**
 * F147 / #312 (P3D-6) — gate de honestidad del fixture de referencia.
 *
 * La escena de referencia es el insumo del baseline de performance; si un
 * cambio de catálogo la adelgaza por debajo del mínimo del North Star §18,
 * el baseline deja de medir lo acordado. Este test lo impide.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPerfReferenceProject,
  perfReferenceCatalog,
} from './perfReferenceScene';
import { resolveBom } from '../engine/bom';

describe('perfReferenceScene — escena de referencia (#312)', () => {
  const project = buildPerfReferenceProject();

  it('es determinista: dos builds producen el mismo proyecto', () => {
    expect(buildPerfReferenceProject()).toEqual(project);
  });

  it('tiene 20–30+ muebles: 23 instancias en el espacio activo', () => {
    const active = project.kitchenLayout!;
    expect(active.placements.length).toBeGreaterThanOrEqual(20);
    expect(active.placements.length).toBeLessThanOrEqual(30);
    // Multi-ambiente: el segundo espacio existe y también coloca.
    expect(active.spaces?.length).toBe(2);
    const office = active.spaces!.find((s) => s.id === 'perf-space-office')!;
    expect(office.placements.length).toBeGreaterThan(0);
  });

  it('resuelve cientos de piezas (≥300) y herrajes visibles', () => {
    let parts = 0;
    let hardwareLines = 0;
    let resolvedModules = 0;
    for (const item of project.items) {
      const module = perfReferenceCatalog.modules.find(
        (m) => m.id === item.moduleId,
      );
      expect(module, `módulo ${item.moduleId} debe existir en el catálogo`)
        .toBeDefined();
      const bom = resolveBom(
        module!,
        item.optionChoices,
        perfReferenceCatalog,
        item.measurePresetId,
      );
      parts += bom.boardParts.length * item.quantity;
      hardwareLines += bom.hardwareLines.length * item.quantity;
      resolvedModules += 1;
    }
    expect(resolvedModules).toBe(project.items.length);
    expect(parts).toBeGreaterThanOrEqual(300);
    expect(hardwareLines).toBeGreaterThan(0);
  });

  it('todos los placements referencian ítems/instancias válidos y muros existentes', () => {
    const itemIds = new Set(project.items.map((i) => i.id));
    for (const space of project.kitchenLayout!.spaces ?? []) {
      const wallIds = new Set(space.walls.map((w) => w.id));
      for (const p of space.placements) {
        expect(itemIds.has(p.itemId)).toBe(true);
        if (p.mode === 'free') continue;
        expect(wallIds.has(p.wallId)).toBe(true);
      }
    }
  });
});
