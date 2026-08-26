/**
 * Anti-leak guard (PR 6 / spec #4148): Optimizer export excludes ambient materials.
 *
 * Ambient materials (floor/wall textures) MUST NEVER become Optimizer cut rows.
 * The export serializes `ProductionCutRow[]`, which come exclusively from board
 * parts (components). This guard generates cut rows from a catalog WITH ambient
 * materials populated + kitchen spaces referencing them, exports the workbook,
 * reloads it, and asserts no ambient identifier (id/code/name) appears in ANY
 * cell across both sheets (Plantilla + Referencias).
 */

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  generateCutRows,
  type AmbientMaterial,
  type Catalog,
  type KitchenSpace,
  type Project,
} from '@granete/domain';
import {
  plantillaCatalogWithModules,
  plantillaGabOnlyProject,
} from '@granete/domain/fixtures';
import { optimizerExport } from './optimizerExport';

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

const projectWithAmbientRefs: Project = {
  ...plantillaGabOnlyProject,
  kitchenLayout: {
    walls: [],
    placements: [],
    spaces: [spaceWithAmbientRefs],
    activeSpaceId: spaceWithAmbientRefs.id,
  },
};

async function loadWorkbook(
  bytes: Uint8Array,
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook;
}

/** Collect every cell value across every sheet as a flat string list. */
function collectCellStrings(workbook: ExcelJS.Workbook): string[] {
  const out: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        const value = cell.value;
        if (value === null || value === undefined) return;
        if (typeof value === 'object') {
          const rich = (value as { richText?: { text?: unknown }[] }).richText;
          if (Array.isArray(rich)) {
            for (const run of rich) out.push(String(run.text ?? ''));
            return;
          }
          const result = (value as { result?: unknown }).result;
          if (result !== undefined) {
            out.push(String(result));
            return;
          }
          out.push(JSON.stringify(value));
          return;
        }
        out.push(String(value));
      });
    });
  });
  return out;
}

describe('anti-leak guard: Optimizer export excludes ambient materials', () => {
  it('no ambient identifier appears in any workbook cell', async () => {
    // Arrange: cut rows from an ambient-populated catalog whose kitchen space
    // references the ambient materials.
    const rows = generateCutRows(projectWithAmbientRefs, catalogWithAmbient);
    expect(rows.length).toBeGreaterThan(0);

    // Act: export + reload the workbook.
    const bytes = await optimizerExport(rows);
    const workbook = await loadWorkbook(bytes);
    const cells = collectCellStrings(workbook);

    // Assert: no ambient id/code/name in any cell (both Plantilla + Referencias).
    for (const token of AMBIENT_TOKENS) {
      for (const cellText of cells) {
        expect(cellText).not.toContain(token);
      }
    }
  });
});
