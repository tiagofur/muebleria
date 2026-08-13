/**
 * Ambient materials validation tests (spec #4148 / design #4151).
 *
 * Presentation-only catalog entities: floor/wall textures for the 3D room scene.
 * They MUST NOT carry pricing/BOM fields (clean separation from MaterialBoard).
 */

import { describe, expect, it } from 'vitest';
import {
  type AmbientMaterial,
  type AmbientSurfaceType,
  type Catalog,
  type KitchenSpace,
  ValidationError,
  validateAmbientRefs,
  validateCatalogEntityCodes,
} from './index';

function ambient(
  overrides: Partial<AmbientMaterial> & { id: string },
): AmbientMaterial {
  return {
    code: 'AMB-01',
    name: 'Porcelanato',
    active: true,
    surfaceType: 'floor',
    ...overrides,
  };
}

function emptyCatalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    materials: [],
    edges: [],
    hardware: [],
    optionGroups: [],
    modules: [],
    ...overrides,
  };
}

function space(overrides: Partial<KitchenSpace> & { id: string }): KitchenSpace {
  return {
    name: 'Cocina',
    walls: [],
    placements: [],
    ...overrides,
  };
}

describe('validateCatalogEntityCodes — ambient materials', () => {
  it('accepts valid floor + wall entries', () => {
    const catalog = emptyCatalog({
      ambientMaterials: [
        ambient({ id: 'amb-floor', code: 'FLOOR-01', surfaceType: 'floor' }),
        ambient({ id: 'amb-wall', code: 'WALL-01', surfaceType: 'wall' }),
      ],
    });
    expect(() => validateCatalogEntityCodes(catalog)).not.toThrow();
  });

  it('accepts a catalog with no ambientMaterials (backward compat)', () => {
    expect(() => validateCatalogEntityCodes(emptyCatalog())).not.toThrow();
  });

  it('rejects empty code on an ambient material', () => {
    const catalog = emptyCatalog({
      ambientMaterials: [ambient({ id: 'amb-1', code: '' })],
    });
    expect(() => validateCatalogEntityCodes(catalog)).toThrow(ValidationError);
  });

  it('rejects empty name on an ambient material', () => {
    const catalog = emptyCatalog({
      ambientMaterials: [ambient({ id: 'amb-1', name: '  ' })],
    });
    expect(() => validateCatalogEntityCodes(catalog)).toThrow(ValidationError);
  });

  it('rejects duplicate ambient code within the collection', () => {
    const catalog = emptyCatalog({
      ambientMaterials: [
        ambient({ id: 'amb-1', code: 'FLOOR-01' }),
        ambient({ id: 'amb-2', code: 'FLOOR-01' }),
      ],
    });
    expect(() => validateCatalogEntityCodes(catalog)).toThrow(ValidationError);
  });

  it('allows the same code shared between a board and an ambient (separate namespaces)', () => {
    const catalog = emptyCatalog({
      materials: [
        {
          id: 'mat-1',
          code: 'MADERA',
          name: 'Tablero Madera',
          widthMm: 1830,
          lengthMm: 2440,
          thicknessMm: 15,
          grainDefault: false,
          boardPrice: 100,
          wastePercent: 0,
          costPerM2: 100,
          active: true,
        },
      ],
      ambientMaterials: [
        ambient({ id: 'amb-1', code: 'MADERA' }),
      ],
    });
    expect(() => validateCatalogEntityCodes(catalog)).not.toThrow();
  });

  it('rejects an invalid surfaceType at runtime (untrusted input)', () => {
    // The TS union forbids 'ceiling', but untrusted/persisted data may carry it.
    // The validator must reject it as a runtime guard.
    const catalog = emptyCatalog({
      ambientMaterials: [
        ambient({
          id: 'amb-1',
          surfaceType: 'ceiling' as AmbientSurfaceType,
        }),
      ],
    });
    expect(() => validateCatalogEntityCodes(catalog)).toThrow(ValidationError);
  });
});

describe('validateAmbientRefs — kitchen space floor/wall refs', () => {
  const floorActive = ambient({
    id: 'amb-floor',
    code: 'FLOOR-01',
    surfaceType: 'floor',
    active: true,
  });
  const wallActive = ambient({
    id: 'amb-wall',
    code: 'WALL-01',
    surfaceType: 'wall',
    active: true,
  });
  const floorInactive = ambient({
    id: 'amb-floor-off',
    code: 'FLOOR-OFF',
    surfaceType: 'floor',
    active: false,
  });

  it('returns no errors for valid floor + wall refs', () => {
    const errors = validateAmbientRefs([floorActive, wallActive], [
      space({
        id: 'sp-1',
        floorMaterialId: 'amb-floor',
        wallMaterialId: 'amb-wall',
      }),
    ]);
    expect(errors).toEqual([]);
  });

  it('returns no errors for a space with no refs (backward compat)', () => {
    const errors = validateAmbientRefs([floorActive], [space({ id: 'sp-1' })]);
    expect(errors).toEqual([]);
  });

  it('returns no errors when there are no spaces', () => {
    const errors = validateAmbientRefs([floorActive], []);
    expect(errors).toEqual([]);
  });

  it('allows any active finish material to be assigned to floor, wall, or ceiling (universal finishes)', () => {
    const errors = validateAmbientRefs([wallActive, floorActive], [
      space({ id: 'sp-1', floorMaterialId: 'amb-wall', wallMaterialId: 'amb-floor', ceilingMaterialId: 'amb-wall' }),
    ]);
    expect(errors).toEqual([]);
  });

  it('errors when floorMaterialId points to an inactive ambient', () => {
    const errors = validateAmbientRefs([floorInactive], [
      space({ id: 'sp-1', floorMaterialId: 'amb-floor-off' }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ValidationError);
  });

  it('errors when floorMaterialId points to an unknown id', () => {
    const errors = validateAmbientRefs([floorActive], [
      space({ id: 'sp-1', floorMaterialId: 'does-not-exist' }),
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ValidationError);
  });

  it('collects multiple errors across spaces and refs', () => {
    const errors = validateAmbientRefs([floorActive, wallActive, floorInactive], [
      space({ id: 'sp-1', floorMaterialId: 'unknown-a' }),
      space({ id: 'sp-2', wallMaterialId: 'amb-floor-off', floorMaterialId: 'unknown-b' }),
    ]);
    expect(errors).toHaveLength(3);
    for (const err of errors) {
      expect(err).toBeInstanceOf(ValidationError);
    }
  });
});
