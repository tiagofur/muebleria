/**
 * Anti-leak guard suite (PR 6 / spec #4148 "No leakage into commercial pipeline").
 *
 * Ambient materials are a clean separate type (`AmbientMaterial`) — never an
 * `ambientOnly` flag on `MaterialBoard`. These guards PROVE the separation holds:
 * even when `catalog.ambientMaterials` is populated AND a project's kitchen
 * spaces reference them, the commercial pipelines (BOM / cost / cutlist) emit
 * zero ambient materials.
 *
 * Each guard combines two assertions:
 *  (A) no ambient identifier (id / code / name) appears in the pipeline output;
 *  (B) the output is ambient-invariant (identical with/without ambientMaterials).
 */

import { describe, expect, it } from 'vitest';
import {
  calcProjectBreakdown,
  captureQuoteSnapshot,
  generateCutRows,
  resolveBom,
} from './engine';
import type { AmbientMaterial, Catalog, KitchenSpace, Project } from './types';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaGabOnlyProject,
} from './__fixtures__/plantillaDemo';

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
const AMBIENT_IDS = [AMBIENT_FLOOR.id, AMBIENT_WALL.id];
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

/** Catalog WITH ambient materials populated + kitchen spaces referencing them. */
const catalogWithAmbient: Catalog = {
  ...plantillaCatalogWithModules,
  ambientMaterials: [AMBIENT_FLOOR, AMBIENT_WALL],
};

/** Same board/edge/hardware/modules, but NO ambient materials (control). */
const catalogWithoutAmbient: Catalog = {
  ...plantillaCatalogWithModules,
};

/** Project whose kitchen layout references ambient materials in its spaces. */
const projectWithAmbientRefs: Project = {
  ...plantillaGabOnlyProject,
  kitchenLayout: {
    walls: [],
    placements: [],
    spaces: [spaceWithAmbientRefs],
    activeSpaceId: spaceWithAmbientRefs.id,
  },
};

function containsAmbientToken(text: string | undefined | null): boolean {
  if (!text) return false;
  return AMBIENT_TOKENS.some((token) => text.includes(token));
}

describe('anti-leak guard: ambient materials never enter BOM / cost / cutlist', () => {
  it('BOM resolves only board materials — never an ambient id', () => {
    // Arrange: resolve the seed module against the ambient-populated catalog.
    const module = catalogWithAmbient.modules.find((m) => m.id === IDS.modGab)!;
    // Act
    const bom = resolveBom(module, plantillaChoices, catalogWithAmbient);
    // Assert (A): every resolved material id is a real board material.
    expect(bom.boardParts.length).toBeGreaterThan(0);
    for (const part of bom.boardParts) {
      expect(AMBIENT_IDS).not.toContain(part.materialId);
      expect(
        catalogWithAmbient.materials.some((m) => m.id === part.materialId),
      ).toBe(true);
    }
  });

  it('cost breakdown is identical with/without ambient (ambient contributes 0)', () => {
    // Arrange / Act: live breakdown for a draft project ignores any snapshot.
    const withAmbient = calcProjectBreakdown(
      projectWithAmbientRefs,
      catalogWithAmbient,
    );
    const withoutAmbient = calcProjectBreakdown(
      plantillaGabOnlyProject,
      catalogWithoutAmbient,
    );
    // Assert (B): ambient materials + their kitchen refs change nothing.
    expect(withAmbient).toEqual(withoutAmbient);
  });

  it('quote snapshot unit-price keys reference only board/edge/hardware', () => {
    // Act
    const snapshot = captureQuoteSnapshot(
      projectWithAmbientRefs,
      catalogWithAmbient,
    );
    const pricedIds = [
      ...Object.keys(snapshot.materialCostPerM2 ?? {}),
      ...Object.keys(snapshot.edgeCostPerMl ?? {}),
      ...Object.keys(snapshot.hardwareCostPerUnit ?? {}),
    ];
    // Assert (A): no ambient id is ever priced.
    expect(pricedIds.length).toBeGreaterThan(0);
    for (const id of pricedIds) {
      expect(AMBIENT_IDS).not.toContain(id);
    }
  });

  it('cutlist rows reference only board materials — no ambient name/code', () => {
    // Act
    const rows = generateCutRows(projectWithAmbientRefs, catalogWithAmbient);
    // Assert (A): ambient identifiers appear in no textual cut-row field.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(containsAmbientToken(row.materialName)).toBe(false);
      expect(containsAmbientToken(row.description)).toBe(false);
      expect(containsAmbientToken(row.partName)).toBe(false);
      expect(containsAmbientToken(row.partCode)).toBe(false);
      expect(containsAmbientToken(row.moduleCode)).toBe(false);
      expect(containsAmbientToken(row.labelRef)).toBe(false);
    }
  });

  it('cutlist is ambient-invariant (identical rows with/without ambient)', () => {
    // Arrange / Act
    const withAmbient = generateCutRows(
      projectWithAmbientRefs,
      catalogWithAmbient,
    );
    const withoutAmbient = generateCutRows(
      plantillaGabOnlyProject,
      catalogWithoutAmbient,
    );
    // Assert (B)
    expect(withAmbient).toEqual(withoutAmbient);
  });
});
