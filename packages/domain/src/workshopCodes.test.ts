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
   * §11 critical test: two units of the SAME module with IDENTICAL
   * dimensions, partIds, and optionChoices. Physical identity is established
   * by (furnitureInstanceId, partId) or (workshopOccurrenceOrdinal, partId),
   * NEVER by dimensions. Reversed lexical order of item ids vs furniture
   * instance ids proves code stability under reordering.
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
    // Both items are IDENTICAL: same moduleId, same quantity, same optionChoices.
    // No customDims — physical identity is never derived from dimensions.
    return {
      ...plantillaGabOnlyProject,
      items: [
        { id: 'item-z', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices },
        { id: 'item-a', moduleId: IDS.modGab, quantity: 1, optionChoices: plantillaChoices },
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
   * BOM side of ONE physical occurrence: manually constructs a derived item
   * (bypasses dense-ordinal validation which only applies to full projections).
   */
  function singleOccurrenceBom(ordinal: 1 | 2) {
    const assignment = PROJECTION.assignments.find((a) => a.workshopOccurrenceOrdinal === ordinal)!;
    const project = buildProject();
    const item = project.items.find((i) => i.id === assignment.projectItemId)!;
    // Manually derive: keep item.id, transport furnitureInstanceId separately.
    const derivedItem: ProjectItem = {
      ...item,
      furnitureInstanceId: assignment.furnitureInstanceId,
      quantity: 1,
      workshopOccurrenceOrdinal: assignment.workshopOccurrenceOrdinal,
    };
    const derived: Project = {
      ...project,
      items: [derivedItem],
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

  it('la misma ocurrencia física recibe el MISMO código en BOM y Release (por ordinal y partId, no por dims)', () => {
    const full = bomSide();
    expect(full.links.length).toBeGreaterThan(0);

    // BOM code per FROZEN identity (ordinal, partId). Since items are
    // identical, we group full BOM links by partId; within each group the
    // links appear in canonical ordinal order (1..N) because
    // canonicalWorkshopOccurrences sorts by ordinal first.
    const fullByPartId = new Map<string, string[]>();
    for (const link of full.links) {
      const list = fullByPartId.get(link.partId) ?? [];
      list.push(link.labelRef);
      fullByPartId.set(link.partId, list);
    }
    const bomCode = new Map<string, string>();
    for (const assignment of PROJECTION.assignments) {
      const ordinal = assignment.workshopOccurrenceOrdinal;
      for (const single of singleOccurrenceBom(ordinal as 1 | 2).links) {
        const fullLabels = fullByPartId.get(single.partId);
        expect(fullLabels, `part ${single.partId} must exist in the full context`).toBeDefined();
        // ordinal is 1-based; array index is 0-based
        const labelRef = fullLabels![ordinal - 1];
        expect(labelRef, `ordinal ${ordinal}, part ${single.partId} must have a labelRef at position ${ordinal - 1}`).toBeDefined();
        bomCode.set(`${ordinal}#${single.partId}`, labelRef!);
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

  it('BOM code == Release code por identidad física (ordinal, partId) — mismos módulos idénticos', () => {
    // Verify that for each physical occurrence (ordinal), the BOM code and
    // Release code are the SAME — the shared frozen authority produces
    // identical codes regardless of the consumer flow.
    const bom = bomSide();
    const release = releaseSide(buildDemand());

    // Group full BOM links by partId; within each group the links appear in
    // canonical ordinal order (1..N) because canonicalWorkshopOccurrences
    // sorts by ordinal first.
    const bomByPartId = new Map<string, string[]>();
    for (const link of bom.links) {
      const list = bomByPartId.get(link.partId) ?? [];
      list.push(link.labelRef);
      bomByPartId.set(link.partId, list);
    }

    // Group release rows by ordinal using the demand units.
    const releaseByOrdinal = new Map<number, Map<string, string>>();
    for (const unit of release.demand.units) {
      const byPartId = new Map<string, string>();
      for (const piece of unit.pieces) {
        // Find the release row for this piece (matched by position in the
        // sorted ordinal+partId sequence).
        const seq = [...release.demand.units]
          .sort((a, b) => a.workshopOccurrenceOrdinal - b.workshopOccurrenceOrdinal)
          .flatMap((u) =>
            [...u.pieces]
              .sort((a, b) => a.partId.localeCompare(b.partId))
              .map((p) => ({ ordinal: u.workshopOccurrenceOrdinal, partId: p.partId, label: '' })),
          );
        // Build label lookup from release rows.
        for (let i = 0; i < release.rows.length && i < seq.length; i++) {
          const row = release.rows[i];
          seq[i]!.label = (row?.labelRef ?? row?.partCode ?? '') as string;
        }
        const match = seq.find((s) => s.ordinal === unit.workshopOccurrenceOrdinal && s.partId === piece.partId);
        if (match) byPartId.set(piece.partId, match.label);
      }
      releaseByOrdinal.set(unit.workshopOccurrenceOrdinal, byPartId);
    }

    // For each ordinal, verify BOM code == Release code per partId.
    for (let ordinal = 1; ordinal <= PROJECTION.assignments.length; ordinal++) {
      const releaseParts = releaseByOrdinal.get(ordinal);
      if (!releaseParts) continue;
      for (const [partId, releaseLabel] of releaseParts) {
        const bomLabels = bomByPartId.get(partId);
        if (!bomLabels || bomLabels.length < ordinal) continue;
        const bomLabel = bomLabels[ordinal - 1];
        expect(releaseLabel, `ordinal ${ordinal}, partId ${partId}`).toBe(bomLabel);
      }
    }
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

  it('expande un ítem quantity 3 en 3 ítems derivados 1:1 — id se conserva, furnitureInstanceId es separado', () => {
    const derived = applyFrozenWorkshopOccurrenceOrdinals(
      [baseItem('line-a', 3)],
      projection([
        { furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
        { furnitureInstanceId: 'fi-2', projectItemId: 'line-a', workshopOccurrenceOrdinal: 2 },
        { furnitureInstanceId: 'fi-3', projectItemId: 'line-a', workshopOccurrenceOrdinal: 3 },
      ]),
    );
    // #781 FIX: item.id MUST be preserved (quote-line identity).
    // furnitureInstanceId is a SEPARATE field.
    expect(derived.map((item) => [item.id, item.furnitureInstanceId, item.quantity, item.workshopOccurrenceOrdinal])).toEqual([
      ['line-a', 'fi-1', 1, 1],
      ['line-a', 'fi-2', 1, 2],
      ['line-a', 'fi-3', 1, 3],
    ]);
  });

  it('undefined → ítems vivos intactos (sin liberación: pre-release)', () => {
    const items = [baseItem('line-a', 2)];
    expect(applyFrozenWorkshopOccurrenceOrdinals(items, undefined)).toBe(items);
  });

  it('#781 micro-task #2B — projection([]) + ítems → throw (claim frozen vacío)', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 2)],
        projection([]),
      ),
    ).toThrow(/no contiene ocurrencias/i);
  });

  it('#781 micro-task #2B — projection([], coversAll=false) → throw aunque vacío', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 2)],
        { ...projection([]), coversAllCurrentInstances: false },
      ),
    ).toThrow(/no cubre todas/i);
  });

  it('#781 micro-task #2B — projection([]) + proyecto vacío → [] (vacuidad)', () => {
    expect(applyFrozenWorkshopOccurrenceOrdinals([], projection([]))).toEqual([]);
  });

  it('cobertura PARTIAL del ítem → falla cerrado (nunca mezcla congelado/vivo)', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1), baseItem('line-b', 1)],
        projection([{ furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 }]),
      ),
    ).toThrow(/no cubre/i);
  });

  it('coversAllCurrentInstances=false → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1)],
        { ...projection([{ furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 }]), coversAllCurrentInstances: false },
      ),
    ).toThrow(/no cubre todas/i);
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

  it('ordinales con huecos (no densos 1..N) → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 2)],
        projection([
          { furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
          { furnitureInstanceId: 'fi-2', projectItemId: 'line-a', workshopOccurrenceOrdinal: 3 },
        ]),
      ),
    ).toThrow(/denso/i);
  });

  it('assignments por projectItem != item.quantity → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 2)],
        projection([
          { furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
        ]),
      ),
    ).toThrow(/no coincide/i);
  });

  it('projectItemId inexistente → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1)],
        projection([
          { furnitureInstanceId: 'fi-1', projectItemId: 'line-UNKNOWN', workshopOccurrenceOrdinal: 1 },
        ]),
      ),
    ).toThrow(/no cubre/i);
  });

  it('regresión: derivar contexto frozen NO pierde placement ni cambia el BOM', () => {
    const item: ProjectItem = {
      id: 'line-a',
      moduleId: IDS.modGab,
      quantity: 1,
      optionChoices: plantillaChoices,
      customDims: { widthMm: 720, heightMm: 720, depthMm: 580 },
      baseMode: 'plinth_board',
    };
    const derived = applyFrozenWorkshopOccurrenceOrdinals(
      [item],
      projection([
        { furnitureInstanceId: 'fi-1', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
      ]),
    );
    expect(derived).toHaveLength(1);
    const d = derived[0]!;
    expect(d.id).toBe('line-a');
    expect(d.furnitureInstanceId).toBe('fi-1');
    expect(d.customDims).toEqual({ widthMm: 720, heightMm: 720, depthMm: 580 });
    expect(d.baseMode).toBe('plinth_board');
    expect(d.moduleId).toBe(IDS.modGab);
    expect(d.optionChoices).toEqual(plantillaChoices);
  });

  it('#781 micro-task #2 A — assignment no consumido → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1)],
        projection([
          { furnitureInstanceId: 'fi-a', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
          { furnitureInstanceId: 'fi-b', projectItemId: 'line-UNKNOWN', workshopOccurrenceOrdinal: 2 },
        ]),
      ),
    ).toThrow(/no corresponden a ningún ítem/i);
  });

  it('#781 micro-task #2 B — projectItemId vacío → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1)],
        projection([
          { furnitureInstanceId: 'fi-a', projectItemId: '', workshopOccurrenceOrdinal: 1 },
        ]),
      ),
    ).toThrow(/projectItemId vacío/i);
  });

  it('#781 micro-task #2 C — furnitureInstanceId duplicado → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1), baseItem('line-b', 1)],
        projection([
          { furnitureInstanceId: 'fi-a', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
          { furnitureInstanceId: 'fi-a', projectItemId: 'line-b', workshopOccurrenceOrdinal: 2 },
        ]),
      ),
    ).toThrow(/misma identidad física/i);
  });

  it('#781 micro-task #2 C2 — furnitureInstanceId vacío → falla cerrado', () => {
    expect(() =>
      applyFrozenWorkshopOccurrenceOrdinals(
        [baseItem('line-a', 1)],
        projection([
          { furnitureInstanceId: '', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
        ]),
      ),
    ).toThrow(/sin identidad física/i);
  });

  it('#781 micro-task #2 D — happy path: 2 frozen, 2 current, todos consumidos', () => {
    const derived = applyFrozenWorkshopOccurrenceOrdinals(
      [baseItem('line-a', 1), baseItem('line-b', 1)],
      projection([
        { furnitureInstanceId: 'fi-a', projectItemId: 'line-a', workshopOccurrenceOrdinal: 1 },
        { furnitureInstanceId: 'fi-b', projectItemId: 'line-b', workshopOccurrenceOrdinal: 2 },
      ]),
    );
    expect(derived).toHaveLength(2);
    expect(derived.map((item) => [item.id, item.furnitureInstanceId, item.quantity, item.workshopOccurrenceOrdinal])).toEqual([
      ['line-a', 'fi-a', 1, 1],
      ['line-b', 'fi-b', 1, 2],
    ]);
  });
});
