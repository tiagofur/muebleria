/**
 * #781 review §1 — canonical workshop-code assignment shared by every flow.
 *
 * The SAME rule orders occurrences and parts before `-L<n>`/`Pnn` numbering
 * in the BOM flow (generateCutRowsWithLinks / generatePieceLabels) and the
 * release flow (releaseCutRowsFromDemand): occurrences by their durable key,
 * parts by partId. Reordering input arrays must never change the codes.
 */

import { describe, expect, it } from 'vitest';
import type { Catalog, PieceLabel, ProductionCutRow, Project } from './types';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaChoices,
  plantillaGabOnlyProject,
} from './__fixtures__/plantillaDemo';
import { generateCutRowsWithLinks, generatePieceLabels } from './engine';
import {
  releaseCutRowsFromDemand,
  type ReleaseCuttingDemandPieceView,
  type ReleaseCuttingDemandView,
} from './engineeringCuttingDemand';

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

describe('identidad cross-flow de fabricación (#781 review — blocker final)', () => {
  /**
   * §11 critical test: two units of the SAME moduleCode whose durable ids
   * have OPPOSITE lexical orders in each flow (project items AND furniture
   * instances both oppose the frozen ordinals), sharing the SAME frozen
   * manufacturing occurrence ordinals. The demand fixture is derived from
   * the BOM's own resolved parts so the comparison is PER PHYSICAL
   * OCCURRENCE + PER PART — never the global code set (which would hide an
   * A↔B swap).
   */
  function buildProject(): Project {
    return {
      ...plantillaGabOnlyProject,
      items: [
        // item-z is ordinal 1 but lexically LAST; item-a is ordinal 2 but
        // lexically FIRST — the item lexical order opposes the ordinals.
        { id: 'item-z', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices, workshopOccurrenceOrdinal: 1, customDims: { widthMm: 720, heightMm: 720, depthMm: 580 } },
        { id: 'item-a', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices, workshopOccurrenceOrdinal: 2, customDims: { widthMm: 650, heightMm: 720, depthMm: 580 } },
      ],
    } as Project;
  }

  function bomSide() {
    return generateCutRowsWithLinks(buildProject(), plantillaCatalogWithModules);
  }

  /** Demand built FROM the BOM's resolved parts, grouped per occurrence. */
  function buildDemandFromBom(links: ReturnType<typeof generateCutRowsWithLinks>['links']): ReleaseCuttingDemandView {
    const materialId = plantillaCatalogWithModules.materials[0]?.id ?? '';
    // Instance lexical order OPPOSES the item lexical order: under the
    // legacy id-order fallback, occurrence A would be L2 in BOM but bare in
    // Release (crossed codes) — only the frozen ordinal makes them agree.
    //   physical A = item-z (lexical last) = fi-a (lexical first), ordinal 1
    //   physical B = item-a (lexical first) = fi-z (lexical last), ordinal 2
    const units: { fi: string; ordinal: number; links: typeof links }[] = [
      { fi: 'fi-a', ordinal: 1, links: [] },
      { fi: 'fi-z', ordinal: 2, links: [] },
    ];
    for (const link of links) {
      // Occurrence 2 carries the -L2- line suffix in the BOM codes.
      const isSecond = link.labelRef.includes('-L2-');
      (isSecond ? units[1]! : units[0]!).links.push(link);
    }
    return {
      releaseId: 'rel-x',
      releaseNumber: 1,
      designRevisionId: 'dr-x',
      designRevisionNumber: 1,
      manufacturingFingerprint: 'fp-x',
      schemaVersion: 1,
      // fi-a is ordinal 1 and lexically FIRST while its project item
      // (item-z) is lexically LAST: the two flows' lexical orders OPPOSE
      // each other, so only the shared frozen ordinal can align the codes.
      units: units.map(({ fi, ordinal, links: unitLinks }) => ({
        furnitureInstanceId: fi,
        furnitureDefinitionId: IDS.modGab,
        workshopOccurrenceOrdinal: ordinal,
        pieces: unitLinks.map((link) => ({
          partId: link.partId,
          partCode: link.part.code ?? null,
          description: link.part.description ?? link.partId,
          quantity: link.part.quantity,
          lengthMm: link.part.lengthMm,
          widthMm: link.part.widthMm,
          thicknessMm: link.part.thicknessMm ?? 18,
          materialId: link.part.materialId || materialId,
          grain: link.part.grain === 0 ? 0 : 1,
          l1: 0, l2: 0, w1: 0, w2: 0,
        }) as ReleaseCuttingDemandPieceView),
      })),
    };
  }

  function releaseSide(demand: ReleaseCuttingDemandView) {
    const moduleCode = plantillaCatalogWithModules.modules.find((m) => m.id === IDS.modGab)?.code ?? '';
    const catalog = {
      ...plantillaCatalogWithModules,
      modules: plantillaCatalogWithModules.modules.map((m) => ({ ...m, code: moduleCode })),
    } as Catalog;
    return releaseCutRowsFromDemand(demand, catalog);
  }

  it('la misma ocurrencia física recibe el MISMO código en BOM y Release (órdenes léxicos opuestos, por ocurrencia y por parte)', () => {
    const bom = bomSide();
    expect(bom.links.length).toBeGreaterThan(0);
    expect(bom.links.some((l) => l.labelRef.includes('-L2-'))).toBe(true);

    const demand = buildDemandFromBom(bom.links);
    const demandRows = releaseSide(demand);
    expect(demandRows).toHaveLength(demand.units.reduce((sum, u) => sum + u.pieces.length, 0));

    // BOM code per PHYSICAL identity: (occurrence ordinal, partId). PartIds
    // repeat ACROSS occurrences (definition namespace) but are unique within
    // one — the pair is the physical part identity.
    const bomCode = new Map(
      bom.links.map((l) => [`${l.labelRef.includes('-L2-') ? 2 : 1}#${l.partId}`, l.labelRef]),
    );
    expect(bomCode.size).toBe(bom.links.length);

    // Release rows iterate units in frozen-ordinal order and pieces in
    // canonical partId order — walk the SAME sequence and compare code by
    // code. A swapped L2 fails here even though the global SET would match.
    const expectedSequence = [...demand.units]
      .sort((a, b) => a.workshopOccurrenceOrdinal - b.workshopOccurrenceOrdinal)
      .flatMap((unit) =>
        [...unit.pieces]
          .sort((a, b) => a.partId.localeCompare(b.partId))
          .map((piece) => ({ ordinal: unit.workshopOccurrenceOrdinal, partId: piece.partId })),
      );
    expect(expectedSequence).toHaveLength(demandRows.length);
    expectedSequence.forEach(({ ordinal, partId }, index) => {
      expect(
        demandRows[index]?.labelRef,
        `physical identity (occurrence ${ordinal}, part ${partId})`,
      ).toBe(bomCode.get(`${ordinal}#${partId}`));
    });
  });

  it('§12: reordenar items/units/pieces con ordinales congelados no cambia el mapeo ocurrencia→código', () => {
    const baseBom = bomSide().rows;
    const shuffledProject: Project = { ...buildProject(), items: [...buildProject().items].reverse() };
    const reorderedBom = generateCutRowsWithLinks(shuffledProject, plantillaCatalogWithModules).rows;

    const bom = bomSide();
    const baseRelease = releaseSide(buildDemandFromBom(bom.links));
    const demand: ReleaseCuttingDemandView = {
      ...buildDemandFromBom(bom.links),
      units: [...buildDemandFromBom(bom.links).units].reverse().map((unit) => ({
        ...unit,
        pieces: [...unit.pieces].reverse(),
      })),
    };
    const reorderedRelease = releaseSide(demand);

    const key = (rows: readonly ProductionCutRow[]) =>
      rows.map((row) => `${row.partName}→${row.labelRef}`).sort().join('|');
    expect(key(reorderedBom)).toBe(key(baseBom));
    expect(key(reorderedRelease)).toBe(key(baseRelease));
    // Cross-flow equality survives the reordering too.
    expect(key(reorderedRelease)).toBe(key(reorderedBom));
  });
});
