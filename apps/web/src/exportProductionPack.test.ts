import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  plantillaCatalogWithModules,
  plantillaProject,
} from '@muebles/domain/fixtures';
import {
  buildProductionPackExport,
  productionPackFileName,
} from './exportProductionPack';

describe('productionPackFileName', () => {
  it('sanitizes project name', () => {
    expect(productionPackFileName('Cocina / Norte')).toBe(
      'pack-produccion-Cocina-Norte.zip',
    );
  });
});

describe('buildProductionPackExport', () => {
  it('fails when project has no exportable cut list', async () => {
    const result = await buildProductionPackExport(
      { ...plantillaProject, items: [] },
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('builds a zip containing optimizer and optional production files', async () => {
    const result = await buildProductionPackExport(
      { ...plantillaProject, status: 'accepted' },
      plantillaCatalogWithModules,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toMatch(/^pack-produccion-.*\.zip$/);
    expect(result.bytes.byteLength).toBeGreaterThan(500);

    const zip = await JSZip.loadAsync(result.bytes);
    const names = Object.keys(zip.files);
    expect(names.some((n) => n.startsWith('optimizer-') && n.endsWith('.xlsx'))).toBe(
      true,
    );
    // Herrajes and labels when the plantilla BOM supports them
    expect(names.length).toBeGreaterThanOrEqual(1);
  });
});
