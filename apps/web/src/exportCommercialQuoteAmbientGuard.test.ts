/**
 * Anti-leak guard (PR 6 / spec #4148): commercial quote export excludes ambient
 * materials.
 *
 * The client-facing cotización (F030) serializes module lines + domain breakdown
 * totals. Ambient materials are neither modules nor priced entities, so they can
 * never become quote lines. This guard builds a quote for a project whose kitchen
 * spaces reference ambient materials, then unzips the exported xlsx and asserts
 * no ambient identifier (id/code/name) appears in the workbook's shared strings
 * (where xlsx stores every string cell).
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  calcProjectBreakdown,
  type AmbientMaterial,
  type Catalog,
  type KitchenSpace,
  type Project,
} from '@granete/domain';
import {
  plantillaCatalogWithModules,
  plantillaGabOnlyProject,
} from '@granete/domain/fixtures';
import { buildCommercialQuoteExport } from './exportCommercialQuote';

const AMBIENT_FLOOR: AmbientMaterial = {
  id: 'amb-floor-ceramic',
  code: 'AMB-FLOOR-01',
  name: 'Porcelanato piso cerámico',
  active: true,
  surfaceType: 'floor',
  previewColor: '#c8b9a6',
  previewTextureUrl: 'media://ambient/floor-ceramic.png',
};
const AMBIENT_WALL: AmbientMaterial = {
  id: 'amb-wall-porcelain',
  code: 'AMB-WALL-01',
  name: 'Porcelanato muro',
  active: true,
  surfaceType: 'wall',
  previewColor: '#e8e2d8',
};
const AMBIENT_TOKENS = [
  AMBIENT_FLOOR.id,
  AMBIENT_WALL.id,
  AMBIENT_FLOOR.code,
  AMBIENT_WALL.code,
  AMBIENT_FLOOR.name,
  AMBIENT_WALL.name,
];

const spaceWithAmbientRefs: KitchenSpace = {
  id: 'space-cocina',
  name: 'Cocina',
  walls: [],
  placements: [],
  floorMaterialId: AMBIENT_FLOOR.id,
  wallMaterialId: AMBIENT_WALL.id,
  showCeiling: true,
};

const catalogWithAmbient: Catalog = {
  ...plantillaCatalogWithModules,
  ambientMaterials: [AMBIENT_FLOOR, AMBIENT_WALL],
};
const catalogWithoutAmbient: Catalog = {
  ...plantillaCatalogWithModules,
};

const projectWithAmbientRefs: Project = {
  ...plantillaGabOnlyProject,
  kitchenLayout: {
    walls: [],
    placements: [],
    spaces: [spaceWithAmbientRefs],
    activeSpaceId: spaceWithAmbientRefs.id,
  },
};

/** Unzip the xlsx and return the shared-strings document (all string cells). */
async function sharedStringsXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('xl/sharedStrings.xml');
  return file ? await file.async('string') : '';
}

describe('anti-leak guard: commercial quote export excludes ambient materials', () => {
  it('quote totals are ambient-invariant (ambient contributes 0)', () => {
    // Arrange / Act: live breakdown for a draft project ignores any snapshot.
    const withAmbient = calcProjectBreakdown(
      projectWithAmbientRefs,
      catalogWithAmbient,
    );
    const withoutAmbient = calcProjectBreakdown(
      projectWithAmbientRefs,
      catalogWithoutAmbient,
    );
    // Assert: ambient materials change nothing in the quote totals.
    expect(withAmbient).toEqual(withoutAmbient);
  });

  it('exported workbook shared strings contain no ambient identifier', async () => {
    // Act: build the client-facing quote for the ambient-referencing project.
    const result = await buildCommercialQuoteExport(
      projectWithAmbientRefs,
      catalogWithAmbient,
      catalogWithAmbient.customers ?? [],
    );
    // Assert: export succeeds and the artifact contains no ambient reference.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = await sharedStringsXml(result.bytes);
    for (const token of AMBIENT_TOKENS) {
      expect(xml).not.toContain(token);
    }
  });
});
