import { describe, expect, it } from 'vitest';
import {
  mirrorComponentPlacement,
  mirrorComponentInstance,
  resolveAgregadoInstance,
} from './agregados';
import type { Agregado, ModuleAgregadoInstance } from './types';

describe('agregados domain helpers', () => {
  describe('mirrorComponentPlacement', () => {
    it('flips lateral_izquierdo <-> lateral_derecho', () => {
      expect(mirrorComponentPlacement('lateral_izquierdo')).toBe('lateral_derecho');
      expect(mirrorComponentPlacement('lateral_derecho')).toBe('lateral_izquierdo');
    });

    it('preserves symmetric placements', () => {
      expect(mirrorComponentPlacement('puerta')).toBe('puerta');
      expect(mirrorComponentPlacement('frontal')).toBe('frontal');
      expect(mirrorComponentPlacement('base')).toBe('base');
    });
  });

  describe('mirrorComponentInstance', () => {
    it('mirrors placement override and rotateY', () => {
      const original = {
        componentId: 'comp-puerta-izq',
        quantity: 1,
        placementOverride: 'lateral_izquierdo' as const,
        overrides: {
          rotateY: 90,
        },
      };

      const mirrored = mirrorComponentInstance(original);
      expect(mirrored.placementOverride).toBe('lateral_derecho');
      expect(mirrored.overrides?.rotateY).toBe(270);
    });
  });

  describe('resolveAgregadoInstance', () => {
    const mockAgregado: Agregado = {
      id: 'agr-puerta-std',
      code: 'AGR-PTR-01',
      name: 'Puerta estándar izquierda con bisagras',
      components: [
        {
          componentId: 'comp-puerta',
          quantity: 1,
          placementOverride: 'lateral_izquierdo',
        },
      ],
      hardwareLines: [
        {
          id: 'hl-bisagra',
          quantity: 2,
          optionRole: 'BISAGRA',
          hardwareId: 'hw-bisagra-35mm',
        },
        {
          id: 'hl-jaladera',
          quantity: 1,
          optionRole: 'JALADERA',
          hardwareId: 'hw-jaladera-128',
        },
      ],
    };

    it('resolves normal (non-mirrored) agregado instance', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'agr-puerta-std',
        quantity: 2,
        mirrored: false,
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.components).toHaveLength(1);
      expect(resolved.components[0]?.quantity).toBe(2);
      expect(resolved.components[0]?.placementOverride).toBe('lateral_izquierdo');
      expect(resolved.hardwareLines).toHaveLength(2);
      expect(resolved.hardwareLines[0]?.quantity).toBe(4); // 2 * 2
      expect(resolved.hardwareLines[1]?.quantity).toBe(2); // 1 * 2
    });

    it('resolves mirrored agregado instance', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'agr-puerta-std',
        quantity: 1,
        mirrored: true,
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.components[0]?.placementOverride).toBe('lateral_derecho');
    });

    it('returns empty lists for non-existent agregado', () => {
      const inst: ModuleAgregadoInstance = {
        agregadoId: 'non-existent',
        quantity: 1,
      };

      const resolved = resolveAgregadoInstance(inst, [mockAgregado]);
      expect(resolved.components).toEqual([]);
      expect(resolved.hardwareLines).toEqual([]);
    });
  });
});
