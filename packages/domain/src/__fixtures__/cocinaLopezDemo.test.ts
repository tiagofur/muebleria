import { describe, expect, it } from 'vitest';
import {
  createCocinaLopezDemoProject,
  seedAmbientMaterials,
  seedCatalogExpandedLatAm,
} from './cocinaLopezDemo';
import {
  validateAmbientRefs,
  validateCatalogEntityCodes,
} from '../engine/validate';

describe('cocinaLopezDemo seed', () => {
  it('creates valid Cocina López demo project with L-shaped layout and 10 items', () => {
    const project = createCocinaLopezDemoProject();
    expect(project.id).toBe('proj-cocina-lopez-demo');
    expect(project.items).toHaveLength(10);
    expect(project.kitchenLayout?.walls).toHaveLength(2);
    expect(project.kitchenLayout?.placements).toHaveLength(10);
    expect(project.kitchenLayout?.floorMaterialId).toBe('amb-floor-porcelanato');
    expect(project.kitchenLayout?.wallMaterialId).toBe('amb-wall-yeso-blanco');
  });

  it('provides seedCatalogExpandedLatAm with 17 modules and valid ambient materials', () => {
    expect(seedCatalogExpandedLatAm.modules.length).toBeGreaterThanOrEqual(15);
    expect(seedCatalogExpandedLatAm.ambientMaterials).toBe(seedAmbientMaterials);
    expect(() => validateCatalogEntityCodes(seedCatalogExpandedLatAm)).not.toThrow();
  });

  it('validates ambient material references for Cocina López space', () => {
    const project = createCocinaLopezDemoProject();
    const layout = project.kitchenLayout!;
    const ambientMaterials = seedCatalogExpandedLatAm.ambientMaterials!;

    const errors = validateAmbientRefs(ambientMaterials, [
      {
        id: 'space-1',
        name: 'Cocina López',
        walls: layout.walls,
        placements: layout.placements,
        floorMaterialId: layout.floorMaterialId,
        wallMaterialId: layout.wallMaterialId,
      },
    ]);

    expect(errors).toEqual([]);
  });
});
