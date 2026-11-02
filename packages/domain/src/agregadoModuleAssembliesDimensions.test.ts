import { describe, expect, it } from 'vitest';
import { resolveModuleAgregadoAssemblies } from './agregadoAssembly';
import type { Agregado, Hardware, Module } from './types';

/**
 * #1453 F1 (review B2): the module/project preview resolves rigid-member
 * offset formulas with the catalog hardware's effective dimensions — the same
 * HW/HH/HD the Go layout resolve passes. Without the lookup the web preview
 * would evaluate HW=0 and diverge from the engine on every formula.
 */
describe('resolveModuleAgregadoAssemblies — fórmulas de miembro ven HW (#1453 F1)', () => {
  const hw: Hardware = {
    id: 'hw-pull-dims',
    code: 'PULL-DIM',
    name: 'Jaladera con bbox',
    unit: 'piece',
    costPerUnit: 1,
    active: true,
    previewShape: 'bar-pull',
    previewSizeMm: 96,
    dimensions: { widthMm: 128, heightMm: 32, depthMm: 35 },
  };

  const agregado = {
    id: 'agr-dim',
    code: 'AGR-DIM',
    name: 'Agregado con miembro HW',
    rigidMembers: [
      {
        memberId: 'm1',
        role: 'center_rail',
        source: { kind: 'fixed', fixed: { hardwareId: hw.id } },
        placement: {
          x: { ref: 'min', offsetMm: 0, offsetFormula: '(PW-HW)/2' },
          y: { ref: 'min', offsetMm: 0 },
          z: { ref: 'min', offsetMm: 0 },
        },
        bomRole: 'non_purchasing',
      },
    ],
  } as unknown as Agregado;

  const module = {
    id: 'mod-1',
    code: 'MOD-1',
    name: 'Módulo',
    hardwareLines: [],
    agregados: [
      {
        id: 'inst-1',
        agregadoId: 'agr-dim',
        quantity: 1,
        position: { xFormula: '0', yFormula: '0', zFormula: '0' },
      },
    ],
  } as unknown as Module;

  it('proyecta (PW-HW)/2 con las dimensions del catálogo (HW=128 → 236, no HW=0 → 300)', () => {
    const resolved = resolveModuleAgregadoAssemblies(
      module,
      { width: 600, height: 720, depth: 590 },
      { agregados: [agregado], hardware: [hw], components: [], materials: [] },
      { optionChoices: {} },
    );

    expect(resolved).toHaveLength(1);
    const assembly = resolved[0]!.resolvedAssembly;
    expect(assembly).toBeDefined();
    const member = assembly!.rigidMembers[0]!;
    expect(member.localTransform.translationMm[0]).toBe(236);
  });
});
