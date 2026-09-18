/**
 * #781 review §1 — canonical workshop-code assignment shared by every flow.
 *
 * The SAME rule orders occurrences and parts before `-L<n>`/`Pnn` numbering
 * in the BOM flow (generateCutRowsWithLinks / generatePieceLabels) and the
 * release flow (releaseCutRowsFromDemand): occurrences by their durable key,
 * parts by partId. Reordering input arrays must never change the codes.
 */

import { describe, expect, it } from 'vitest';
import type { Catalog, PieceLabel, ProductionCutRow, Project, ProjectItem } from './types';
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
import {
  applyFrozenWorkshopOccurrenceOrdinals,
  canonicalWorkshopOccurrences,
  validateFrozenWorkshopOccurrenceOrdinals,
  type WorkshopOccurrenceAssignment,
  type WorkshopOccurrenceProjection,
} from './engine/cut';

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
   * have OPPOSITE lexical orders in each flow, sharing ONE frozen
   * occurrence authority. §10: the test knows the PHYSICAL IDENTITY FIRST
   * (the frozen ordinal each derived item / demand unit carries) and checks
   * the code afterwards — never deducing occurrences from dims or '-L2-'.
   * No manual ordinal injection into the Project: the BOM context is
   * DERIVED via the frozen projection, exactly as the web wiring does.
   *
   *   physical A = item-z (lexical last) = fi-a (lexical first), ordinal 1
   *   physical B = item-a (lexical first) = fi-z (lexical last), ordinal 2
   */
  const PROJECTION: WorkshopOccurrenceProjection = {
    releaseId: 'rel-x',
    releaseNumber: 1,
    coversAllCurrentInstances: true,
    assignments: [
      { furnitureInstanceId: 'fi-a', projectItemId: 'item-z', workshopOccurrenceOrdinal: 1 },
      { furnitureInstanceId: 'fi-z', projectItemId: 'item-a', workshopOccurrenceOrdinal: 2 },
    ],
  };

  function buildProject(): Project {
    return {
      ...plantillaGabOnlyProject,
      items: [
        { id: 'item-z', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices, customDims: { widthMm: 720, heightMm: 720, depthMm: 580 } },
        { id: 'item-a', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices, customDims: { widthMm: 650, heightMm: 690, depthMm: 580 } },
      ],
    } as Project;
  }

  /** Full derived BOM context (both occurrences), as the web wiring builds it. */
  function bomSide() {
    const project = buildProject();
    const derived: Project = {
      ...project,
      items: applyFrozenWorkshopOccurrenceOrdinals(project.items, PROJECTION),
    };
    return generateCutRowsWithLinks(derived, plantillaCatalogWithModules);
  }

  /**
   * BOM side of ONE physical occurrence: the derived context restricted to
   * that occurrence's item — every link belongs to exactly that ordinal,
   * by construction (identity first, code after).
   */
  function singleOccurrenceBom(ordinal: 1 | 2) {
    const assignment = PROJECTION.assignments.find((a) => a.workshopOccurrenceOrdinal === ordinal)!;
    const project = buildProject();
    const item = project.items.find((i) => i.id === assignment.projectItemId)!;
    const derived: Project = {
      ...project,
      items: applyFrozenWorkshopOccurrenceOrdinals([item], { ...PROJECTION, assignments: [assignment] }),
    };
    return generateCutRowsWithLinks(derived, plantillaCatalogWithModules);
  }

  /** Demand built from each occurrence's resolved parts. */
  function buildDemand(): ReleaseCuttingDemandView {
    const materialId = plantillaCatalogWithModules.materials[0]?.id ?? '';
    return {
      releaseId: 'rel-x',
      releaseNumber: 1,
      designRevisionId: 'dr-x',
      designRevisionNumber: 1,
      manufacturingFingerprint: 'fp-x',
      schemaVersion: 1,
      units: PROJECTION.assignments.map((assignment) => {
        const links = singleOccurrenceBom(assignment.workshopOccurrenceOrdinal as 1 | 2).links;
        return {
          furnitureInstanceId: assignment.furnitureInstanceId,
          furnitureDefinitionId: IDS.modGab,
          workshopOccurrenceOrdinal: assignment.workshopOccurrenceOrdinal,
          pieces: links.map((link) => ({
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
        };
      }),
    };
  }

  function releaseSide(demand: ReleaseCuttingDemandView) {
    const moduleCode = plantillaCatalogWithModules.modules.find((m) => m.id === IDS.modGab)?.code ?? '';
    const catalog = {
      ...plantillaCatalogWithModules,
      modules: plantillaCatalogWithModules.modules.map((m) => ({ ...m, code: moduleCode })),
    } as Catalog;
    return { rows: releaseCutRowsFromDemand(demand, catalog), demand };
  }

  it('la misma ocurrencia física recibe el MISMO código en BOM y Release (autoridad congelada, por ocurrencia y por parte)', () => {
    const full = bomSide();
    expect(full.links.length).toBeGreaterThan(0);

    // BOM code per FROZEN identity (ordinal, partId). The per-occurrence
    // contexts establish WHICH parts belong to which physical occurrence
    // (identity first); the FULL derived context supplies the code each
    // occurrence actually gets (-L suffixes depend on the occurrence SET).
    // Parts pair by partId + resolved dims, which differ per occurrence by
    // construction (custom width AND height) — never by code suffix.
    const bomCode = new Map<string, string>();
    for (const assignment of PROJECTION.assignments) {
      for (const single of singleOccurrenceBom(assignment.workshopOccurrenceOrdinal as 1 | 2).links) {
        const fullLink = full.links.find(
          (l) =>
            l.partId === single.partId &&
            l.part.lengthMm === single.part.lengthMm &&
            l.part.widthMm === single.part.widthMm,
        );
        expect(fullLink, `part ${single.partId} of occurrence ${assignment.workshopOccurrenceOrdinal} must exist in the full context`).toBeDefined();
        bomCode.set(`${assignment.workshopOccurrenceOrdinal}#${single.partId}`, fullLink!.labelRef);
      }
    }
    expect(bomCode.size).toBe(full.links.length);

    const release = releaseSide(buildDemand());
    const expectedSequence = [...release.demand.units]
      .sort((a, b) => a.workshopOccurrenceOrdinal - b.workshopOccurrenceOrdinal)
      .flatMap((unit) =>
        [...unit.pieces]
          .sort((a, b) => a.partId.localeCompare(b.partId))
          .map((piece) => ({ ordinal: unit.workshopOccurrenceOrdinal, partId: piece.partId })),
      );
    expect(expectedSequence).toHaveLength(release.rows.length);
    expectedSequence.forEach(({ ordinal, partId }, index) => {
      expect(
        release.rows[index]?.labelRef,
        `physical identity (occurrence ${ordinal}, part ${partId})`,
      ).toBe(bomCode.get(`${ordinal}#${partId}`));
    });
    // The repeated module really got distinct line suffixes per frozen
    // ordinal in both flows.
    expect(release.rows.some((row) => (row.labelRef ?? '').includes('-L2-'))).toBe(true);
    expect(full.rows.some((row) => (row.labelRef ?? '').includes('-L2-'))).toBe(true);
  });

  it('§12: reordenar items/units/pieces con ordinales congelados no cambia el mapeo ocurrencia→código', () => {
    const base = bomSide();
    const baseRelease = releaseSide(buildDemand());
    const shuffledProject: Project = { ...buildProject(), items: [...buildProject().items].reverse() };
    const reorderedBom = generateCutRowsWithLinks(
      { ...shuffledProject, items: applyFrozenWorkshopOccurrenceOrdinals(shuffledProject.items, PROJECTION) },
      plantillaCatalogWithModules,
    ).rows;
    const demand: ReleaseCuttingDemandView = {
      ...buildDemand(),
      units: [...buildDemand().units].reverse().map((unit) => ({
        ...unit,
        pieces: [...unit.pieces].reverse(),
      })),
    };
    const reorderedRelease = releaseSide(demand);

    const key = (rows: readonly ProductionCutRow[]) =>
      rows.map((row) => `${row.partName}→${row.labelRef}`).sort().join('|');
    expect(key(reorderedBom)).toBe(key(base.rows));
    expect(key(reorderedRelease.rows)).toBe(key(baseRelease.rows));
    expect(key(reorderedRelease.rows)).toBe(key(reorderedBom));
  });
});

describe('validación de ordinales congelados (#781 review §7/§8)', () => {
  const occ = (id: string, ordinal?: number) => ({ id, workshopOccurrenceOrdinal: ordinal });

  it('todos presentes y válidos → orden por ordinal', () => {
    expect(
      canonicalWorkshopOccurrences([occ('c', 3), occ('a', 1), occ('b', 2)]).map((o) => o.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('ninguno presente → fallback por id durable (live/legacy)', () => {
    expect(
      canonicalWorkshopOccurrences([occ('z'), occ('a')]).map((o) => o.id),
    ).toEqual(['a', 'z']);
  });

  it('PARCIAL (algunos sí, algunos no) → falla cerrado, sin fallback silencioso', () => {
    expect(() => canonicalWorkshopOccurrences([occ('a', 1), occ('b')])).toThrow(
      /mixto/i,
    );
  });

  it('DUPLICADOS → dos ocurrencias físicas nunca comparten autoridad', () => {
    expect(() => canonicalWorkshopOccurrences([occ('a', 1), occ('b', 1)])).toThrow(
      /duplic/i,
    );
    expect(() => validateFrozenWorkshopOccurrenceOrdinals([occ('a', 2), occ('b', 2)])).toThrow(
      /duplic/i,
    );
  });

  it('INVÁLIDOS (no entero, < 1) → falla cerrado', () => {
    expect(() => canonicalWorkshopOccurrences([occ('a', 0), occ('b', 1)])).toThrow(
      /entero >= 1/i,
    );
    expect(() => canonicalWorkshopOccurrences([occ('a', 1.5), occ('b', 2)])).toThrow(
      /entero >= 1/i,
    );
  });
});

describe('applyFrozenWorkshopOccurrenceOrdinals — contexto BOM derivado (#781 review §5)', () => {
  const baseItem = (id: string, quantity: number): ProjectItem => ({
    id,
    moduleId: IDS.modGab,
    quantity,
    optionChoices: plantillaChoices,
  });
  const projection = (assignments: readonly WorkshopOccurrenceAssignment[]): WorkshopOccurrenceProjection => ({
    releaseId: 'rel-1',
    releaseNumber: 1,
    coversAllCurrentInstances: true,
    assignments,
  });

  it('expande un ítem quantity 3 en 3 ítems derivados 1:1 con su ordinal congelado (id = instancia)', () => {
    const derived = applyFrozenWorkshopOccurrenceOrdinals(
      [baseItem('line-a', 3)],
      projection([
        { furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
        { furnitureInstanceId: 'fi-2', projectItemId: 'line-a', workshopOccurrenceOrdinal: 2 },
        { furnitureInstanceId: 'fi-3', projectItemId: 'line-a', workshopOccurrenceOrdinal: 3 },
      ]),
    );
    expect(derived.map((item) => [item.id, item.quantity, item.workshopOccurrenceOrdinal])).toEqual([
      ['fi-1', 1, 1],
      ['fi-2', 1, 2],
      ['fi-3', 1, 3],
    ]);
  });

  it('proyección vacía → ítems vivos intactos (sin liberación)', () => {
    const items = [baseItem('line-a', 2)];
    expect(applyFrozenWorkshopOccurrenceOrdinals(items, undefined)).toBe(items);
    expect(applyFrozenWorkshopOccurrenceOrdinals(items, projection([]))).toBe(items);
  });

  it('cobertura PARTIAL del ítem → falla cerrado (nunca mezcla congelado/vivo)', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1), baseItem('line-b', 1)],
        projection([{ furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 }]),
      ),
    ).toThrow(/no cubre/i);
  });

  it('ordinales duplicados en la proyección → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 2)],
        projection([
          { furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
          { furnitureInstanceId: 'fi-2', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
        ]),
      ),
    ).toThrow(/duplic/i);
  });
});
