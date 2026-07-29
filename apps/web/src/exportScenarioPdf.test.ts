import { describe, expect, it } from 'vitest';
import { plantillaGabOnlyProject, plantillaCatalogWithModules } from '@muebles/domain/fixtures';
import { buildCommercialScenarioPdfExport, scenarioPdfFileName } from './exportScenarioPdf';

describe('buildCommercialScenarioPdfExport (#137)', () => {
  it('builds a valid A/B scenario comparison PDF', async () => {
    const result = await buildCommercialScenarioPdfExport(
      plantillaGabOnlyProject,
      plantillaCatalogWithModules,
      'FRENTE',
      plantillaCatalogWithModules.materials[0]!.id,
      'Cliente Test',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileName).toBe(scenarioPdfFileName(plantillaGabOnlyProject.name));
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });

  it('fails gracefully when scenario comparison fails', async () => {
    const invalidProject = {
      ...plantillaGabOnlyProject,
      items: [],
    };
    const result = await buildCommercialScenarioPdfExport(
      invalidProject,
      plantillaCatalogWithModules,
      'FRENTE',
      'invalid-choice',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('no tiene muebles');
    }
  });
});
