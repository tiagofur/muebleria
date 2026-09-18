/**
 * #781 review §1 — canonical workshop-code assignment shared by every flow.
 *
 * The SAME rule orders occurrences and parts before `-L<n>`/`Pnn` numbering
 * in the BOM flow (generateCutRowsWithLinks / generatePieceLabels) and the
 * release flow (releaseCutRowsFromDemand): occurrences by their durable key,
 * parts by partId. Reordering input arrays must never change the codes.
 */

import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaGabOnlyProject,
} from './__fixtures__/plantillaDemo';
import { generateCutRowsWithLinks, generatePieceLabels } from './engine';
import type { PieceLabel, ProductionCutRow } from './types';

function withReversedItems(project: Project): Project {
  return { ...project, items: [...project.items].reverse() };
}

function codesOfRows(rows: readonly ProductionCutRow[]): string[] {
  return rows.map((row) => `${row.labelRef ?? ''}#${row.partCode}`).sort();
}

describe('generateCutRowsWithLinks — códigos canónicos (#781)', () => {
  it('reordenar project.items NO cambia labelRef/partCode de taller', () => {
    const base = generateCutRowsWithLinks(plantillaGabOnlyProject, plantillaCatalogWithModules);
    const reordered = generateCutRowsWithLinks(
      withReversedItems(plantillaGabOnlyProject),
      plantillaCatalogWithModules,
    );
    expect(codesOfRows(reordered.rows)).toEqual(codesOfRows(base.rows));
  });

  it('dos muebles idénticos reciben sufijos -L deterministas por orden canónico', () => {
    const twoUnits: Project = {
      ...plantillaGabOnlyProject,
      items: [
        { id: 'item-z', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices },
        { id: 'item-a', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices },
      ],
    };
    const { rows, links } = generateCutRowsWithLinks(twoUnits, plantillaCatalogWithModules);

    // Canonical order (item 'a' < item 'z') decides which occurrence is bare
    // and which gets -L2-, independent of the array order — and every label
    // stays unique across the two units.
    const labelRefs = links.map((link) => link.labelRef);
    expect(new Set(labelRefs).size).toBe(labelRefs.length);
    expect(labelRefs.some((ref) => ref.includes('-L2-'))).toBe(true);
    // Same physical parts in both units ⇒ same Pnn, only the line suffix
    // differs between the two occurrences.
    const byUnit = new Map<string, string[]>();
    rows.forEach((row) => {
      const ref = row.labelRef ?? '';
      const bare = ref.replace(/-L\d+-/, '-');
      const list = byUnit.get(bare) ?? [];
      list.push(ref);
      byUnit.set(bare, list);
    });
    for (const [bare, refs] of byUnit) {
      expect(refs, bare).toHaveLength(2);
    }
  });

  it('generatePieceLabels comparte la misma asignación canónica', () => {
    const baseLabels = generatePieceLabels(plantillaGabOnlyProject, plantillaCatalogWithModules);
    const reorderedLabels = generatePieceLabels(
      withReversedItems(plantillaGabOnlyProject),
      plantillaCatalogWithModules,
    );
    const code = (labels: readonly PieceLabel[]): string[] =>
      labels.map((label) => label.partCode ?? '').sort();
    expect(code(reorderedLabels)).toEqual(code(baseLabels));
  });
});
