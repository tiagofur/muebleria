import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createSeedWorkspace } from '@muebles/storage/seed';
import { buildProductionPackExport, productionPackFileName } from './exportProductionPack';

describe('buildProductionPackExport (Issue #134)', () => {
  it('builds a valid ZIP with 4 production files', async () => {
    const seed = createSeedWorkspace();
    const project = seed.projects.find((p) => p.name === 'Demo plantilla')!;

    const result = await buildProductionPackExport(
      project,
      seed.catalog,
      'Cliente Test',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileName).toBe(productionPackFileName(project.name));
    expect(result.bytes.byteLength).toBeGreaterThan(1000);

    const zip = await JSZip.loadAsync(result.bytes);
    const filenames = Object.keys(zip.files);

    expect(filenames).toContain('optimizer_Demo_plantilla.xlsx');
    expect(filenames).toContain('herrajes_Demo_plantilla.xlsx');
    expect(filenames).toContain('etiquetas_Demo_plantilla.pdf');
    expect(filenames).toContain('resumen_materiales_Demo_plantilla.pdf');
  });

  it('fails with validation issues when project has missing choices', async () => {
    const seed = createSeedWorkspace();
    const invalidProject = {
      ...seed.projects[0]!,
      items: [],
    };
    const result = await buildProductionPackExport(invalidProject, seed.catalog);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
