/**
 * Semantic readback verification: parsed PTX bytes vs the original CutPlan
 * (#650 PR 5, R1-hardened).
 *
 * This is the closing step of the compiler chain required by the issue:
 *   optimizeCutPlan → validated cutProgram → compileCutPlanToPtxDocument
 *   → validatePtxDocument → serializePtxDocumentBytes → parsePtxDocumentBytes
 *   → verifyCutPlanPtxReadback === [].
 *
 * Independence boundaries, stated honestly and enforced by a source guard
 * test: this module imports ONLY types from compileCutPlan.ts — never the
 * compiler's productive helpers (FUNCTION staging, structural preorder,
 * PATTERN TYPE, releases, vector geometry, sanitizers). Every expected
 * invariant is re-derived here from the CutProgramTrace with deliberately
 * duplicated rules: if the writer classifies a phase wrong, this checker
 * computes the expectation independently and the mutation surfaces. Sharing
 * the derivation would let an industrial bug in the writer verify itself.
 *
 * Also independent at the format level (#656's parser vs serializer) and at
 * the program level (executeCutProgram re-runs each sheet; the compiler is
 * never re-run to compute expectations). The inverse mapping (durable id ↔
 * local index) is the audit bridge; full from-scratch tree inference from
 * bytes alone is NOT possible in this subset (staging class and phase-3 recut
 * axis are underdetermined without the mapping — a documented limitation;
 * VECTORS carry the absolute positions when emitted).
 *
 * Tolerance absorbs IEEE-754 arithmetic noise only (relative 1e-9) — never a
 * manufacturing or visual-grouping tolerance.
 */

import { executeCutProgram } from '@granete/domain';
import type { CutPlan, CutPlanSheet, CutProgramTrace, CutProgramTraceDivision } from '@granete/domain';
import type {
  PtxBoardRecord,
  PtxCutRecord,
  PtxDocument,
  PtxJobRecord,
  PtxMaterialRecord,
  PtxOffcutRecord,
  PtxPartsReqRecord,
  PtxPatternRecord,
  PtxVectorRecord,
} from './records';
import { PTX_UNITS } from './records';
import { validatePtxDocument } from './validate';
import type {
  CompileCutPlanToPtxOptions,
  PtxCompilationMapping,
  PtxCompiledSheetMapping,
} from './compileCutPlan';
import { scopedRegionKey } from './scopedRegionRef';

export interface CutPlanPtxReadbackIssue {
  readonly code: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Independent derivations (duplicated from the documented candidate
// contract ON PURPOSE — cross-check, not shared productive logic)
// ---------------------------------------------------------------------------

/** Auxiliary-text filter for display cells (comments, JOBS name). Never identity. */
function auxAscii(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
  }
  return out;
}

/** Independently derived expectation for one division (staging model). */
interface LocalDivisionExpectation {
  readonly division: CutProgramTraceDivision;
  readonly phase: number;
  readonly functionCode: number;
  readonly keptPieceRef?: string;
  readonly restPieceRef?: string;
}

/**
 * Staging generations, re-derived: the staging root (raw board, or the r3
 * usable root after the trim projection) is generation 1; dividing a
 * generation-g region is a phase-g pass; the kept child moves to g+1, the
 * rest child stays at g. FUNCTION: phases ≤ 2 by axis role (y→1 rip, x→2
 * cross), phase 3 → 3. Divisions whose parent has no generation (the r3 trim
 * prefix) are skipped. Returns null when the trace needs a phase beyond the
 * supported subset (the compiler must have rejected such a plan already).
 */
function deriveDivisionExpectations(
  trace: CutProgramTrace,
  stagingRootRegionId: string,
): readonly LocalDivisionExpectation[] | null {
  const generation = new Map<string, number>([[stagingRootRegionId, 1]]);
  const pieceByRegion = new Map<string, string>();
  for (const terminal of trace.terminals) {
    if (terminal.kind === 'piece' && terminal.pieceRef) {
      pieceByRegion.set(terminal.regionId, terminal.pieceRef);
    }
  }
  const expectations: LocalDivisionExpectation[] = [];
  for (const division of trace.divisions) {
    const parentGeneration = generation.get(division.parentRegionId);
    if (parentGeneration === undefined) continue;
    const phase = parentGeneration;
    if (phase > 3) return null;
    generation.set(division.keptRegionId, parentGeneration + 1);
    if (division.restRegionId) {
      generation.set(division.restRegionId, phase);
    }
    expectations.push({
      division,
      phase,
      functionCode: phase <= 2 ? (division.axis === 'y' ? 1 : 2) : 3,
      keptPieceRef: pieceByRegion.get(division.keptRegionId),
      restPieceRef: division.restRegionId ? pieceByRegion.get(division.restRegionId) : undefined,
    });
  }
  return expectations;
}

/**
 * r3 trim projection, re-derived independently of the writer's planner
 * (#661): the perimeter trim prefix must be a chain of trim divisions from
 * the raw board to ONE usable root, and each executed margin
 * (parentExtent − keptExtent, the TOTAL including kerf) maps by
 * axis + leadingBand to the fixed-frame slot:
 *   y + leadingBand → FRIP · y + far → VRIP · x + leadingBand → FXCT ·
 *   x + far → VXCT.
 * Returns null when the structure does not match this contract (the writer
 * must have failed closed already — a parsed document that reaches this
 * state is an issue by itself).
 */
interface LocalTrimProjection {
  readonly usableRootRegionId: string;
  readonly trimFripMm?: number;
  readonly trimVripMm?: number;
  readonly trimFxctMm?: number;
  readonly trimVXctMm?: number;
}

function deriveTrimProjection(trace: CutProgramTrace): LocalTrimProjection | null {
  const divisionByParent = new Map<string, CutProgramTraceDivision>();
  for (const division of trace.divisions) {
    divisionByParent.set(division.parentRegionId, division);
  }
  const chain: CutProgramTraceDivision[] = [];
  let current = trace.boardRegionId;
  for (;;) {
    const division = divisionByParent.get(current);
    if (!division || division.trim !== true) break;
    chain.push(division);
    current = division.keptRegionId;
  }
  const chainCutIds = new Set(chain.map((division) => division.cutId));
  for (const division of trace.divisions) {
    if (division.trim === true && !chainCutIds.has(division.cutId)) {
      return null;
    }
  }
  const margins: Record<'frip' | 'vrip' | 'fxct' | 'vxct', number[]> = {
    frip: [],
    vrip: [],
    fxct: [],
    vxct: [],
  };
  for (const division of chain) {
    const parentExtentMm =
      division.axis === 'x' ? division.parentRect.lengthMm : division.parentRect.widthMm;
    const marginMm = parentExtentMm - division.keptExtentMm;
    if (!Number.isFinite(marginMm) || marginMm <= 0) return null;
    const slot =
      division.axis === 'y'
        ? division.leadingBand
          ? 'frip'
          : 'vrip'
        : division.leadingBand
          ? 'fxct'
          : 'vxct';
    margins[slot].push(marginMm);
  }
  for (const slot of Object.keys(margins) as (keyof typeof margins)[]) {
    if (margins[slot].length > 1) return null;
  }
  return {
    usableRootRegionId: current,
    trimFripMm: margins.frip[0],
    trimVripMm: margins.vrip[0],
    trimFxctMm: margins.fxct[0],
    trimVXctMm: margins.vxct[0],
  };
}

/**
 * Structural preorder, re-derived: kept subtree first, then the rest
 * subtree, from the staging root (usable root under r3). CUT_INDEX must
 * follow this order while SEQUENCE carries the scheduled execution order —
 * the two coincide on simple fixtures but are checked independently
 * (dossier fragment 03). Null when the tree is not reachable from the root.
 */
function deriveStructuralPreorder(
  trace: CutProgramTrace,
  stagingRootRegionId: string,
): readonly CutProgramTraceDivision[] | null {
  const divisionByParentRegion = new Map<string, CutProgramTraceDivision>();
  for (const division of trace.divisions) {
    divisionByParentRegion.set(division.parentRegionId, division);
  }
  const out: CutProgramTraceDivision[] = [];
  const visit = (regionId: string): void => {
    const division = divisionByParentRegion.get(regionId);
    if (!division) return;
    out.push(division);
    visit(division.keptRegionId);
    if (division.restRegionId) visit(division.restRegionId);
  };
  visit(stagingRootRegionId);
  const expectedCount = trace.divisions.filter((division) => division.trim !== true).length;
  return out.length === expectedCount ? out : null;
}

/** PATTERNS.TYPE, re-derived: 0 (longitudinal rip) when the first productive division advances along y, else 4. */
function derivePatternType(trace: CutProgramTrace): number {
  const first = trace.divisions.find((division) => division.trim !== true);
  return first && first.axis === 'y' ? 0 : 4;
}

/** Independently derived release-row expectation for one leaf. */
interface LocalReleaseExpectation {
  readonly regionId: string;
  readonly kind: 'offcut' | 'part';
  readonly pieceRef?: string;
  readonly dimensionMm: number;
  readonly functionCode: number;
  /** r3: cutId of the producing division (scheduler anchor). */
  readonly producerOrder?: number;
  /** r3: true when the row must be a physical FUNCTION 92 pass. */
  readonly offcutRelease92?: boolean;
}

/**
 * Release rows, re-derived: remnant leaves (attribution via Xn, fragment
 * 04) and a rest-side piece of a double-piece division get a QTY_RPT=0 row
 * whose DIMENSION is the leaf extent along its producing division's axis.
 * Exact-fit terminals never get a fictitious row.
 *
 * r3 (#661): a remnant additionally REQUIRES a physical FUNCTION 92 row
 * when it is the rest-side terminal of a productive phase-2/FUNCTION-2
 * producer with a known extent and productive kept-side content (a
 * consuming division or a piece) — the demonstrated subset of
 * 04_contrato_r3_refilados.md §6.2. Every other remnant must keep the
 * relational QTY_RPT=0 representation.
 */
function deriveReleases(
  trace: CutProgramTrace,
  expectations: readonly LocalDivisionExpectation[],
  offcutRelease92: boolean,
): readonly LocalReleaseExpectation[] {
  const expectationByLeafRegion = new Map<string, LocalDivisionExpectation>();
  for (const expectation of expectations) {
    expectationByLeafRegion.set(expectation.division.keptRegionId, expectation);
    if (expectation.division.restRegionId) {
      expectationByLeafRegion.set(expectation.division.restRegionId, expectation);
    }
  }
  const productiveCutIds = new Set(expectations.map((e) => e.division.cutId));
  const releases: LocalReleaseExpectation[] = [];
  for (const terminal of trace.terminals) {
    const producing = expectationByLeafRegion.get(terminal.regionId);
    if (!producing) continue;
    const division = producing.division;
    const isKept = division.keptRegionId === terminal.regionId;
    const restExtentMm =
      division.axis === 'x' ? division.restRect?.lengthMm : division.restRect?.widthMm;
    if (terminal.kind === 'remnant') {
      const eligible =
        offcutRelease92 &&
        !isKept &&
        producing.phase === 2 &&
        producing.functionCode === 2 &&
        restExtentMm !== undefined &&
        Number.isFinite(restExtentMm) &&
        restExtentMm > 0 &&
        productiveCutIds.has(division.cutId) &&
        (trace.divisions.some(
          (candidate) =>
            candidate.trim !== true && candidate.parentRegionId === division.keptRegionId,
        ) ||
          trace.terminals.some(
            (candidate) => candidate.regionId === division.keptRegionId && candidate.kind === 'piece',
          ));
      releases.push({
        regionId: terminal.regionId,
        kind: 'offcut',
        dimensionMm: isKept ? division.keptExtentMm : restExtentMm!,
        functionCode: eligible ? 92 : producing.functionCode,
        producerOrder: eligible ? division.order : undefined,
        offcutRelease92: eligible ? true : undefined,
      });
      continue;
    }
    if (
      terminal.kind === 'piece' &&
      !isKept &&
      producing.keptPieceRef !== undefined &&
      producing.restPieceRef === terminal.pieceRef
    ) {
      releases.push({
        regionId: terminal.regionId,
        kind: 'part',
        pieceRef: terminal.pieceRef,
        dimensionMm: restExtentMm!,
        functionCode: producing.functionCode,
      });
    }
  }
  return releases;
}

/**
 * r3 SEQUENCE expectation, re-derived with a different formulation than the
 * writer's insertion scheduler: every productive division keeps the rank of
 * its execution order, and each FUNCTION 92 release takes the fractional
 * slot right after its producer (producer.order + 0.5). Sorting those keys
 * and numbering 1..M must reproduce the writer's contiguous schedule — and
 * any mutation that moves a 92 out of `producer < 92 < dependent recut`
 * breaks a row's expected SEQUENCE.
 */
function deriveScheduledSequences(
  expectations: readonly LocalDivisionExpectation[],
  releases: readonly LocalReleaseExpectation[],
): { readonly sequenceByCutId: ReadonlyMap<string, number>; readonly sequenceByRegionId: ReadonlyMap<string, number> } {
  const events: { readonly key: number; readonly kind: 'division' | 'offcut_release'; readonly id: string }[] = [];
  for (const expectation of expectations) {
    events.push({ key: expectation.division.order, kind: 'division', id: expectation.division.cutId });
  }
  for (const release of releases) {
    if (release.offcutRelease92 === true && release.producerOrder !== undefined) {
      events.push({ key: release.producerOrder + 0.5, kind: 'offcut_release', id: release.regionId });
    }
  }
  events.sort((a, b) => a.key - b.key);
  const sequenceByCutId = new Map<string, number>();
  const sequenceByRegionId = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.kind === 'division') {
      sequenceByCutId.set(event.id, index + 1);
    } else {
      sequenceByRegionId.set(event.id, index + 1);
    }
  });
  return { sequenceByCutId, sequenceByRegionId };
}

/**
 * VECTORS line, re-derived: the cut line at the kerf-band edge away from the
 * kept region, spanning the parent on the other axis, converted to the
 * top-left origin convention (yTop = boardWidth − yBottom).
 */
function deriveVectorLine(
  division: CutProgramTraceDivision,
  boardWidthMm: number,
): { readonly xStart: number; readonly yStart: number; readonly xEnd: number; readonly yEnd: number } {
  const parent = division.parentRect;
  const band = division.kerfBandRect;
  if (division.axis === 'x') {
    const x = division.leadingBand ? band.xMm : band.xMm + band.lengthMm;
    return {
      xStart: x,
      yStart: boardWidthMm - parent.yMm,
      xEnd: x,
      yEnd: boardWidthMm - (parent.yMm + parent.widthMm),
    };
  }
  const y = division.leadingBand ? band.yMm : band.yMm + band.widthMm;
  return {
    xStart: parent.xMm,
    yStart: boardWidthMm - y,
    xEnd: parent.xMm + parent.lengthMm,
    yEnd: boardWidthMm - y,
  };
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export function verifyCutPlanPtxReadback(
  parsed: PtxDocument,
  cutPlan: CutPlan,
  mapping: PtxCompilationMapping,
  options: CompileCutPlanToPtxOptions,
): readonly CutPlanPtxReadbackIssue[] {
  const issues: CutPlanPtxReadbackIssue[] = [];
  const push = (code: string, message: string): void => {
    issues.push({ code, message });
  };

  // 1. Format/relational validation of the parsed bytes.
  for (const issue of validatePtxDocument(parsed)) {
    push(`ptx_invalid.${issue.code}`, issue.message);
  }
  if (issues.length > 0) return issues;

  const close = (a: number, b: number): boolean =>
    Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  const snap = (value: number): number => {
    const factor = 10 ** options.decimalPlaces;
    return Math.round(value * factor) / factor;
  };
  const expectedComment = (value: string): string | undefined => auxAscii(value) || undefined;

  // 2. Header carries the caller's declared candidate options.
  if (parsed.header.units !== PTX_UNITS.metric) {
    push('header.units', `UNITS=${parsed.header.units} no es métrico (el dominio emite mm)`);
  }
  if (parsed.header.version !== options.headerVersion) {
    push('header.version', `VERSION=${parsed.header.version} ≠ ${options.headerVersion}`);
  }
  if (parsed.header.origin !== options.headerOrigin) {
    push('header.origin', `ORIGIN=${parsed.header.origin} ≠ ${options.headerOrigin}`);
  }
  if (parsed.header.trimType !== options.trimType) {
    push('header.trim_type', `TRIM_TYPE=${parsed.header.trimType} ≠ ${options.trimType}`);
  }
  if (parsed.header.title !== options.title) {
    push('header.title', `TITLE='${parsed.header.title}' ≠ '${options.title}'`);
  }

  // 4. Table views in file order. The traces (and, under r3, the trim
  //    projections) are re-executed first: every later expectation derives
  //    from the executed programs, never from the parsed bytes.
  const r3 = options.supportsPositiveTrim === true;
  const jobRows = parsed.records.filter((r): r is PtxJobRecord => r.type === 'JOBS');
  const materialRows = parsed.records.filter((r): r is PtxMaterialRecord => r.type === 'MATERIALS');
  const partsRows = parsed.records.filter((r): r is PtxPartsReqRecord => r.type === 'PARTS_REQ');
  const boardRows = parsed.records.filter((r): r is PtxBoardRecord => r.type === 'BOARDS');
  const patternRows = parsed.records.filter((r): r is PtxPatternRecord => r.type === 'PATTERNS');
  const offcutRows = parsed.records.filter((r): r is PtxOffcutRecord => r.type === 'OFFCUTS');
  const vectorRows = parsed.records.filter((r): r is PtxVectorRecord => r.type === 'VECTORS');
  const cutRows = parsed.records.filter((r): r is PtxCutRecord => r.type === 'CUTS');
  const cutsByPattern = new Map<number, PtxCutRecord[]>();
  for (const row of cutRows) {
    const list = cutsByPattern.get(row.patternIndex) ?? [];
    list.push(row);
    cutsByPattern.set(row.patternIndex, list);
  }

  const globalOffcutIndexByRegion = new Map<string, number>();
  let runningOffcutIndex = 1;
  const sheetTraces = new Map<number, CutProgramTrace>();
  const sheetProjections = new Map<number, LocalTrimProjection | null>();
  for (const sheet of cutPlan.sheets) {
    if (!sheet.cutProgram) {
      push('sheet.program_missing', `la hoja ${sheet.sheetIndex} no trae programa de cortes`);
      continue;
    }
    try {
      const trace = executeCutProgram(sheet.cutProgram);
      sheetTraces.set(sheet.sheetIndex, trace);
      sheetProjections.set(sheet.sheetIndex, deriveTrimProjection(trace));
      for (const terminal of trace.terminals) {
        if (terminal.kind === 'remnant') {
          globalOffcutIndexByRegion.set(
            scopedRegionKey({ sheetIndex: sheet.sheetIndex, regionId: terminal.regionId }),
            runningOffcutIndex++,
          );
        }
      }
    } catch {
      push('sheet.program_invalid', `la hoja ${sheet.sheetIndex} no ejecuta un programa válido`);
    }
  }

  // MATERIALS.TRIM_* expectation (r3 only): re-derived per sheet from the
  // executed trims, then required to agree across the sheets of one material
  // (one MATERIALS row cannot carry two different executed margins).
  const expectedTrimsByMaterial = new Map<string, LocalTrimProjection | 'inconsistent'>();
  if (r3) {
    const byMaterial = new Map<string, LocalTrimProjection[]>();
    for (const sheet of cutPlan.sheets) {
      const projection = sheetProjections.get(sheet.sheetIndex);
      if (!projection) continue;
      const list = byMaterial.get(sheet.materialCode) ?? [];
      list.push(projection);
      byMaterial.set(sheet.materialCode, list);
    }
    for (const [code, projections] of byMaterial) {
      const slots = [
        ['trimFripMm', projections.map((p) => p.trimFripMm)],
        ['trimVripMm', projections.map((p) => p.trimVripMm)],
        ['trimFxctMm', projections.map((p) => p.trimFxctMm)],
        ['trimVXctMm', projections.map((p) => p.trimVXctMm)],
      ] as const;
      let consistent = true;
      for (const [, values] of slots) {
        const defined = values.filter((value) => value !== undefined);
        if (defined.length === 0) continue;
        if (
          defined.length !== values.length ||
          defined.some((value) => !close(value, defined[0]!))
        ) {
          consistent = false;
        }
      }
      expectedTrimsByMaterial.set(code, consistent ? projections[0]! : 'inconsistent');
    }
  }

  if (jobRows.length !== 1 || jobRows[0]!.jobIndex !== mapping.jobIndex) {
    push('jobs.count', `se esperaba un único JOBS con índice ${mapping.jobIndex}`);
  } else {
    // JOBS.NAME is auxiliary display text (stable projectId, no clock).
    const expectedName = auxAscii(cutPlan.projectId) || 'GRANETE-JOB';
    if (jobRows[0]!.name !== expectedName) {
      push('jobs.name', `JOBS NAME='${jobRows[0]!.name}' ≠ '${expectedName}' (projectId estable, sin reloj)`);
    }
  }

  // 4. Materials: kerf must equal the plan kerf, thickness the industrial
  //    thickness (recomputed from the plan — raw codes, since the compiler
  //    rejects non-ASCII identity), and BOOK the documented conservative
  //    policy (1: "counts boards" is all S03 pp.134–135 establishes).
  const expectedThickness = new Map<string, number>();
  for (const sheet of cutPlan.sheets) {
    expectedThickness.set(sheet.materialCode, sheet.thicknessMm ?? Number.NaN);
  }
  for (const sheet of cutPlan.sheets) {
    for (const piece of sheet.pieces) {
      const code = piece.materialCode ?? sheet.materialCode;
      if (!expectedThickness.has(code)) {
        expectedThickness.set(code, piece.thicknessMm ?? sheet.thicknessMm ?? Number.NaN);
      }
    }
  }
  if (materialRows.length !== mapping.materialIndexByCode.size) {
    push('materials.count', `MATERIALS=${materialRows.length}, esperados ${mapping.materialIndexByCode.size}`);
  }
  for (const row of materialRows) {
    const expectedIndex = mapping.materialIndexByCode.get(row.code);
    if (expectedIndex === undefined) {
      push('materials.unknown', `MATERIALS code='${row.code}' no está en el mapeo`);
      continue;
    }
    if (row.materialIndex !== expectedIndex) {
      push('materials.index', `MATERIALS '${row.code}' MAT_INDEX=${row.materialIndex} ≠ ${expectedIndex}`);
    }
    if (
      !close(row.kerfRip, snap(cutPlan.config.sawKerfMm)) ||
      !close(row.kerfCrosscut, snap(cutPlan.config.sawKerfMm))
    ) {
      push('materials.kerf', `MATERIALS '${row.code}' kerf ${row.kerfRip}/${row.kerfCrosscut} ≠ kerf del plan ${snap(cutPlan.config.sawKerfMm)}`);
    }
    const thickness = expectedThickness.get(row.code);
    if (thickness === undefined || Number.isNaN(thickness)) {
      push('materials.thickness_missing', `MATERIALS '${row.code}' sin espesor esperado en el plan`);
    } else if (!close(row.thickness, snap(thickness))) {
      push('materials.thickness', `MATERIALS '${row.code}' THICK=${row.thickness} ≠ ${snap(thickness)}`);
    }
    if (row.bookQuantity !== 1) {
      push('materials.book', `MATERIALS '${row.code}' BOOK=${row.bookQuantity} ≠ 1 (política documentada: cuenta tableros, un tablero por ciclo; el total del job NO está establecido en S03)`);
    }
    if (r3) {
      // r3 (#661): the four trims must equal the independently re-derived
      // executed margins (totals including kerf); a side without a trim pass
      // must stay ABSENT; HEAD/FRCT/VRCT must never carry an override (G3).
      const expected = expectedTrimsByMaterial.get(row.code);
      if (!expected) {
        push('materials.trims', `MATERIALS '${row.code}' sin proyección de trims derivable para su material`);
      } else if (expected === 'inconsistent') {
        push('materials.trims', `MATERIALS '${row.code}': hojas del mismo material con refilados ejecutados distintos`);
      } else {
        const trimChecks = [
          ['TRIM_FRIP', row.trimFRip, expected.trimFripMm],
          ['TRIM_VRIP', row.trimVRip, expected.trimVripMm],
          ['TRIM_FXCT', row.trimFXct, expected.trimFxctMm],
          ['TRIM_VXCT', row.trimVXct, expected.trimVXctMm],
        ] as const;
        for (const [field, actual, expectedMm] of trimChecks) {
          if (expectedMm === undefined) {
            if (actual !== undefined) {
              push('materials.trims', `MATERIALS '${row.code}' ${field}=${actual} debe estar AUSENTE (sin refilo ejecutado en ese lado; ausente ≠ 0)`);
            }
          } else if (actual === undefined || !close(actual, snap(expectedMm))) {
            push('materials.trims', `MATERIALS '${row.code}' ${field}=${actual ?? 'ausente'} ≠ margen ejecutado ${snap(expectedMm)} (total incluyendo kerf)`);
          }
        }
        for (const [field, actual] of [
          ['TRIM_HEAD', row.trimHead],
          ['TRIM_FRCT', row.trimFRct],
          ['TRIM_VRCT', row.trimVRct],
        ] as const) {
          if (actual !== undefined) {
            push('materials.trims', `MATERIALS '${row.code}' ${field}=${actual} debe estar AUSENTE (G3: los cuatro márgenes no alimentan HEAD/recut)`);
          }
        }
      }
    }
  }

  // 5. PARTS_REQ: one row per placed piece, in sheet/piece order. Codes are
  //    raw identity (non-ASCII would have failed compilation); an empty
  //    partCode gets the explicit technical code PART-<n>.
  const expectedPieces = cutPlan.sheets.flatMap((sheet) =>
    sheet.pieces.map((piece) => ({ sheet, piece })),
  );
  if (partsRows.length !== expectedPieces.length) {
    push('parts.count', `PARTS_REQ=${partsRows.length}, esperadas ${expectedPieces.length} piezas colocadas`);
  }
  expectedPieces.forEach(({ sheet, piece }, position) => {
    const row = partsRows[position];
    if (!row) return;
    const expectedPartIndex = mapping.partIndexByPieceRef.get(piece.id);
    if (expectedPartIndex === undefined) {
      push('parts.unmapped', `pieza ${piece.id} sin PART_INDEX en el mapeo`);
      return;
    }
    if (row.partIndex !== expectedPartIndex) {
      push('parts.order', `PARTS_REQ fila ${position + 1} PART_INDEX=${row.partIndex} ≠ ${expectedPartIndex} (pieza ${piece.id})`);
    }
    const expectedCode = piece.partCode === '' ? `PART-${expectedPartIndex}` : piece.partCode;
    if (row.code !== expectedCode) {
      push('parts.code', `PARTS_REQ ${expectedPartIndex} CODE='${row.code}' ≠ '${expectedCode}'`);
    }
    if (!close(row.length, snap(piece.lengthMm)) || !close(row.width, snap(piece.widthMm))) {
      push('parts.dims', `PARTS_REQ ${expectedPartIndex} ${row.length}×${row.width} ≠ medidas resueltas ${snap(piece.lengthMm)}×${snap(piece.widthMm)} (pieza ${piece.id})`);
    }
    const expectedGrain = piece.grain === 0 ? 0 : 1;
    if (row.grain !== expectedGrain) {
      push('parts.grain', `PARTS_REQ ${expectedPartIndex} GRAIN=${row.grain} ≠ ${expectedGrain}`);
    }
    if (row.requiredQuantity !== 1 || (row.producedQuantity ?? 0) !== 1) {
      push('parts.qty', `PARTS_REQ ${expectedPartIndex} QTY_REQ/QTY_PROD=${row.requiredQuantity}/${row.producedQuantity} ≠ 1/1 (sin agregación)`);
    }
    const materialCode = piece.materialCode ?? sheet.materialCode;
    const expectedMaterialIndex = mapping.materialIndexByCode.get(materialCode);
    if (expectedMaterialIndex === undefined || row.materialIndex !== expectedMaterialIndex) {
      push('parts.material', `PARTS_REQ ${expectedPartIndex} MAT_INDEX=${row.materialIndex} ≠ material '${materialCode}'`);
    }
  });

  // 6. BOARDS / PATTERNS / CUTS / OFFCUTS / VECTORS per sheet.
  if (boardRows.length !== cutPlan.sheets.length) {
    push('boards.count', `BOARDS=${boardRows.length} ≠ hojas ${cutPlan.sheets.length}`);
  }
  if (patternRows.length !== cutPlan.sheets.length) {
    push('patterns.count', `PATTERNS=${patternRows.length} ≠ hojas ${cutPlan.sheets.length}`);
  }
  cutPlan.sheets.forEach((sheet, position) => {
    if (
      position < mapping.sheetIndexByPatternIndex.length &&
      mapping.sheetIndexByPatternIndex[position] !== sheet.sheetIndex
    ) {
      push('patterns.sheet_map', `PTN_INDEX ${position + 1} mapea hoja ${mapping.sheetIndexByPatternIndex[position]} ≠ ${sheet.sheetIndex}`);
    }
  });

  cutPlan.sheets.forEach((sheet, sheetPosition) => {
    const trace = sheetTraces.get(sheet.sheetIndex);
    const sheetMapping = mapping.sheets.find((s) => s.sheetIndex === sheet.sheetIndex);
    if (!trace || !sheetMapping) {
      push('sheet.unmapped', `hoja ${sheet.sheetIndex} sin traza ejecutada o sin mapeo`);
      return;
    }
    verifySheetReadback({
      sheet,
      trace,
      sheetMapping,
      parsed,
      boardRow: boardRows[sheetPosition],
      patternRow: patternRows[sheetPosition],
      cutsByPattern,
      offcutRows,
      vectorRows,
      globalOffcutIndexByRegion,
      mapping,
      options,
      push,
      close,
      snap,
      expectedComment,
    });
  });

  // 7. Family-level completeness: no extra records beyond the contract.
  //    Under r3 the compiled CUTS are the PRODUCTIVE divisions only (the
  //    perimeter trims live in MATERIALS.TRIM_*) plus the releases.
  const totalDivisions = [...sheetTraces.values()].reduce(
    (sum, trace) =>
      sum + (r3 ? trace.divisions.filter((division) => division.trim !== true).length : trace.divisions.length),
    0,
  );
  let totalReleases = 0;
  for (const sheet of cutPlan.sheets) {
    const trace = sheetTraces.get(sheet.sheetIndex);
    if (!trace) continue;
    const projection = sheetProjections.get(sheet.sheetIndex);
    const stagingRoot = r3 && projection ? projection.usableRootRegionId : trace.boardRegionId;
    const expectations = deriveDivisionExpectations(trace, stagingRoot);
    if (expectations) {
      totalReleases += deriveReleases(trace, expectations, r3).length;
    }
  }
  if (cutRows.length !== totalDivisions + totalReleases) {
    push('cuts.count', `CUTS=${cutRows.length} ≠ divisiones ${totalDivisions} + liberaciones ${totalReleases}`);
  }
  if (offcutRows.length !== globalOffcutIndexByRegion.size) {
    push('offcuts.count', `OFFCUTS=${offcutRows.length} ≠ retazos ${globalOffcutIndexByRegion.size}`);
  }
  if (options.includeVectors === true) {
    if (vectorRows.length !== totalDivisions) {
      push('vectors.count', `VECTORS=${vectorRows.length} ≠ divisiones ${totalDivisions}`);
    }
  } else if (vectorRows.length > 0) {
    push('vectors.unexpected', `el documento se compiló sin vectores pero trae ${vectorRows.length}`);
  }

  return issues;
}

interface SheetVerificationContext {
  readonly sheet: CutPlanSheet;
  readonly trace: CutProgramTrace;
  readonly sheetMapping: PtxCompiledSheetMapping;
  readonly parsed: PtxDocument;
  readonly boardRow: PtxBoardRecord | undefined;
  readonly patternRow: PtxPatternRecord | undefined;
  readonly cutsByPattern: ReadonlyMap<number, readonly PtxCutRecord[]>;
  readonly offcutRows: readonly PtxOffcutRecord[];
  readonly vectorRows: readonly PtxVectorRecord[];
  readonly globalOffcutIndexByRegion: ReadonlyMap<string, number>;
  readonly mapping: PtxCompilationMapping;
  readonly options: CompileCutPlanToPtxOptions;
  readonly push: (code: string, message: string) => void;
  readonly close: (a: number, b: number) => boolean;
  readonly snap: (value: number) => number;
  readonly expectedComment: (value: string) => string | undefined;
}

function verifySheetReadback(ctx: SheetVerificationContext): void {
  const {
    sheet,
    trace,
    sheetMapping,
    boardRow,
    patternRow,
    cutsByPattern,
    offcutRows,
    vectorRows,
    globalOffcutIndexByRegion,
    mapping,
    options,
    push,
    close,
    snap,
    expectedComment,
  } = ctx;

  const r3 = options.supportsPositiveTrim === true;
  // r3 (#661): the PTX pattern starts at the usable root after the perimeter
  // trim prefix; re-derived independently from the executed trace.
  const projection = deriveTrimProjection(trace);
  if (r3 && !projection) {
    push('sheet.trim_unprojectable', `hoja ${sheet.sheetIndex}: el prefijo de refilos no cuadra con la proyección r3`);
    return;
  }
  const stagingRoot = r3 && projection ? projection.usableRootRegionId : trace.boardRegionId;
  const expectations = deriveDivisionExpectations(trace, stagingRoot);
  const preorder = deriveStructuralPreorder(trace, stagingRoot);
  if (!expectations || !preorder) {
    push('sheet.phase_unsupported', `hoja ${sheet.sheetIndex}: estructura no representable en el subconjunto`);
    return;
  }
  const expectationByCutId = new Map(expectations.map((e) => [e.division.cutId, e]));
  const releases = deriveReleases(trace, expectations, r3);
  const schedule = r3 ? deriveScheduledSequences(expectations, releases) : undefined;

  if (!boardRow) {
    push('boards.missing', `hoja ${sheet.sheetIndex} sin fila BOARDS`);
  } else {
    if (boardRow.boardIndex !== sheetMapping.boardIndex) {
      push('boards.index', `BOARDS BRD_INDEX=${boardRow.boardIndex} ≠ ${sheetMapping.boardIndex}`);
    }
    if (
      !close(boardRow.length, snap(sheet.sheetLengthMm)) ||
      !close(boardRow.width, snap(sheet.sheetWidthMm))
    ) {
      push('boards.dims', `BOARDS ${boardRow.length}×${boardRow.width} ≠ tablero ${snap(sheet.sheetLengthMm)}×${snap(sheet.sheetWidthMm)} (hoja ${sheet.sheetIndex})`);
    }
    const sheetMaterialIndex = mapping.materialIndexByCode.get(sheet.materialCode);
    if (sheetMaterialIndex === undefined || boardRow.materialIndex !== sheetMaterialIndex) {
      push('boards.material', `BOARDS MAT_INDEX=${boardRow.materialIndex} ≠ material '${sheet.materialCode}'`);
    }
  }

  if (!patternRow) {
    push('patterns.missing', `hoja ${sheet.sheetIndex} sin fila PATTERNS`);
  } else {
    const expectedType = derivePatternType(trace);
    if (patternRow.patternIndex !== sheetMapping.patternIndex) {
      push('patterns.index', `PATTERNS PTN_INDEX=${patternRow.patternIndex} ≠ ${sheetMapping.patternIndex}`);
    }
    if (patternRow.patternType !== expectedType || patternRow.patternType !== sheetMapping.patternType) {
      push('patterns.type', `PATTERNS TYPE=${patternRow.patternType} ≠ política documentada (${expectedType})`);
    }
    if (patternRow.boardIndex !== sheetMapping.boardIndex) {
      push('patterns.board', `PATTERNS BRD_INDEX=${patternRow.boardIndex} ≠ ${sheetMapping.boardIndex}`);
    }
    if (
      patternRow.runQuantity !== 1 ||
      patternRow.cyclesQuantity !== 1 ||
      patternRow.maxBook !== 1
    ) {
      push('patterns.compression', `PATTERNS QTY_RUN/QTY_CYCLES/MAX_BOOK=${patternRow.runQuantity}/${patternRow.cyclesQuantity}/${patternRow.maxBook} ≠ 1/1/1 (un tablero por ciclo, sin compresión)`);
    }
  }

  // --- CUTS rows: divisions in structural preorder, then release rows -----
  const rows = cutsByPattern.get(sheetMapping.patternIndex) ?? [];
  if (rows.length !== preorder.length + releases.length) {
    push('cuts.sheet_count', `patrón ${sheetMapping.patternIndex}: CUTS=${rows.length} ≠ ${preorder.length} divisiones + ${releases.length} liberaciones`);
  }

  // Byte-derived extent reconstruction: the board extents come from BOARDS
  // and each row derives its children extents (dimension, parent, kerf);
  // results are compared against the independently executed trace.
  const extentAlongAxis = new Map<string, number>();
  const recordExtent = (regionId: string, axis: 'x' | 'y', extent: number): void => {
    extentAlongAxis.set(`${regionId}:${axis}`, extent);
  };
  const boardLengthBytes = boardRow ? boardRow.length : sheet.sheetLengthMm;
  const boardWidthBytes = boardRow ? boardRow.width : sheet.sheetWidthMm;
  recordExtent(trace.boardRegionId, 'x', boardLengthBytes);
  recordExtent(trace.boardRegionId, 'y', boardWidthBytes);
  const kerfBytes = materialKerfBytes(ctx);
  if (r3 && projection) {
    // The usable root's extents derive from BYTES: raw BOARDS extents minus
    // the MATERIALS.TRIM_* margins of each side (the demonstrated fixed
    // frame). Byte-absent sides fall back to the re-derived projection — the
    // materials.trims check already reports that absence.
    const trimBytes = materialTrimBytes(ctx, projection);
    recordExtent(
      stagingRoot,
      'x',
      boardLengthBytes - (trimBytes.trimFXct ?? 0) - (trimBytes.trimVXct ?? 0),
    );
    recordExtent(
      stagingRoot,
      'y',
      boardWidthBytes - (trimBytes.trimFRip ?? 0) - (trimBytes.trimVRip ?? 0),
    );
  }

  preorder.forEach((division, position) => {
    const row = rows[position];
    const label = `CUTS patrón ${sheetMapping.patternIndex} fila ${position + 1} (cutId ${division.cutId})`;
    if (!row) return;
    const expectation = expectationByCutId.get(division.cutId)!;
    const expectedCutIndex = sheetMapping.cutIndexByCutId.get(division.cutId);
    if (expectedCutIndex === undefined || row.cutIndex !== expectedCutIndex || expectedCutIndex !== position + 1) {
      push('cuts.index', `${label}: CUT_INDEX=${row.cutIndex} ≠ ${expectedCutIndex ?? '?'} (posición preorder ${position + 1})`);
    }
    // SEQUENCE: r2 = the program's execution order; r3 = the scheduled event
    // order re-derived with the fractional-key formulation (fragment 03).
    const expectedSequence = schedule ? schedule.sequenceByCutId.get(division.cutId) : division.order;
    if (row.sequence !== expectedSequence) {
      push(
        'cuts.sequence',
        `${label}: SEQUENCE=${row.sequence} ≠ ${schedule ? 'secuencia programada' : 'orden de ejecución'} ${expectedSequence}`,
      );
    }
    if (row.functionCode !== expectation.functionCode) {
      push('cuts.function', `${label}: FUNCTION=${row.functionCode} ≠ política documentada (${expectation.functionCode}, fase ${expectation.phase}, eje ${division.axis})`);
    }
    if (!close(row.dimension, snap(division.keptExtentMm))) {
      push('cuts.dimension', `${label}: DIMENSION=${row.dimension} ≠ medida relativa conservada ${snap(division.keptExtentMm)}`);
    }
    if (row.repeatQuantity !== 1) {
      push('cuts.repeat', `${label}: QTY_RPT=${row.repeatQuantity} ≠ 1 (sin compresión)`);
    }
    const expectedReference =
      expectation.keptPieceRef !== undefined
        ? { kind: 'part' as const, partIndex: mapping.partIndexByPieceRef.get(expectation.keptPieceRef) ?? -1 }
        : { kind: 'none' as const };
    if (
      row.partReference.kind !== expectedReference.kind ||
      (expectedReference.kind === 'part' && row.partReference.kind === 'part' && row.partReference.partIndex !== expectedReference.partIndex)
    ) {
      push('cuts.part_ref', `${label}: PART_INDEX no corresponde a la hoja de pieza esperada (${expectation.keptPieceRef ?? 'sin pieza'})`);
    }
    const expectedProduced = expectation.keptPieceRef !== undefined ? 1 : 0;
    if (row.producedQuantity !== expectedProduced) {
      push('cuts.produced', `${label}: QTY_PARTS=${row.producedQuantity} ≠ ${expectedProduced}`);
    }
    if (row.comment !== expectedComment(division.cutId)) {
      push('cuts.comment', `${label}: COMMENT='${row.comment}' ≠ '${expectedComment(division.cutId) ?? ''}'`);
    }

    // Extent derivation from bytes: parent extent comes from previously
    // derived rows (or the BOARDS record); kerf comes from MATERIALS.
    const parentExtent =
      extentAlongAxis.get(`${division.parentRegionId}:${division.axis}`) ?? Number.NaN;
    const derivedGap = parentExtent - row.dimension - kerfBytes;
    const traceParentExtent =
      division.axis === 'x' ? division.parentRect.lengthMm : division.parentRect.widthMm;
    if (!close(parentExtent, snap(traceParentExtent))) {
      push('cuts.parent_extent', `${label}: extensión del padre derivada de bytes (${parentExtent}) ≠ ejecutada (${snap(traceParentExtent)})`);
    }
    recordExtent(division.keptRegionId, division.axis, row.dimension);
    if (division.restRect) {
      const traceRestExtent =
        division.axis === 'x' ? division.restRect.lengthMm : division.restRect.widthMm;
      if (derivedGap <= 0 || !close(derivedGap, snap(traceRestExtent))) {
        push('cuts.rest_extent', `${label}: resto derivado de bytes (${derivedGap}) ≠ ejecutado (${snap(traceRestExtent)})`);
      }
      recordExtent(division.restRegionId!, division.axis, derivedGap);
    } else if (derivedGap > kerfBytes + 1e-9 * Math.max(1, kerfBytes)) {
      push('cuts.rest_missing', `${label}: bytes derivan un resto sólido de ${derivedGap - kerfBytes} mm que el programa no declara`);
    }
    // The other axis is inherited from the parent (guillotine invariance);
    // recorded so deeper rows can read it.
    const otherAxis = division.axis === 'x' ? 'y' : 'x';
    const parentOther = extentAlongAxis.get(`${division.parentRegionId}:${otherAxis}`) ?? Number.NaN;
    recordExtent(division.keptRegionId, otherAxis, parentOther);
    if (division.restRegionId) {
      recordExtent(division.restRegionId, otherAxis, parentOther);
    }
  });

  releases.forEach((release, position) => {
    const row = rows[preorder.length + position];
    const label = `liberación '${release.regionId}' (patrón ${sheetMapping.patternIndex})`;
    if (!row) return;
    if (release.offcutRelease92 === true) {
      // r3 physical FUNCTION 92 pass (#661 contract §6.2/§19): QTY_RPT=1,
      // QTY_PARTS ABSENT, FUNCTION 92, scheduled after the producer and
      // before every dependent recut.
      const expectedSequence = schedule?.sequenceByRegionId.get(release.regionId);
      if (row.sequence === undefined || expectedSequence === undefined || row.sequence !== expectedSequence) {
        push('release.sequence', `${label}: SEQUENCE=${row.sequence} ≠ secuencia programada ${expectedSequence ?? '?'} (productor < 92 < recut dependiente)`);
      }
      if (row.repeatQuantity !== 1) {
        push('release.no_pass', `${label}: QTY_RPT=${row.repeatQuantity} ≠ 1 (una pasada física 92, no una fila relacional)`);
      }
      if (row.producedQuantity !== undefined) {
        push('release.produced', `${label}: QTY_PARTS=${row.producedQuantity} debe estar AUSENTE (la 92 libera un Xn, no una pieza de PARTS_REQ)`);
      }
      if (row.functionCode !== 92) {
        push('release.function', `${label}: FUNCTION=${row.functionCode} ≠ 92`);
      }
      if (!close(row.dimension, snap(release.dimensionMm))) {
        push('release.dimension', `${label}: DIMENSION=${row.dimension} ≠ ${snap(release.dimensionMm)}`);
      }
      if (row.comment !== expectedComment(release.regionId)) {
        push('release.comment', `${label}: COMMENT='${row.comment}' ≠ '${expectedComment(release.regionId) ?? ''}'`);
      }
      const expectedCutIndex = sheetMapping.releaseCutIndexByRegionId.get(release.regionId);
      if (expectedCutIndex === undefined || row.cutIndex !== expectedCutIndex) {
        push('release.index', `${label}: CUT_INDEX=${row.cutIndex} ≠ ${expectedCutIndex ?? '?'}`);
      }
      if (release.kind === 'offcut') {
        const expectedOffcutIndex = globalOffcutIndexByRegion.get(
          scopedRegionKey({ sheetIndex: sheet.sheetIndex, regionId: release.regionId }),
        );
        if (
          row.partReference.kind !== 'offcut' ||
          expectedOffcutIndex === undefined ||
          row.partReference.offcutIndex !== expectedOffcutIndex
        ) {
          push('release.offcut_ref', `${label}: PART_INDEX no referencia X${expectedOffcutIndex ?? '?'}`);
        }
      } else {
        push('release.function', `${label}: una release 92 debe referenciar un offcut`);
      }
      return;
    }
    if (row.sequence !== 0 || row.repeatQuantity !== 0) {
      push('release.no_pass', `${label}: SEQUENCE=${row.sequence}/QTY_RPT=${row.repeatQuantity} ≠ 0/0 (una liberación no es una pasada)`);
    }
    if (row.producedQuantity !== 1) {
      push('release.produced', `${label}: QTY_PARTS=${row.producedQuantity} ≠ 1`);
    }
    if (!close(row.dimension, snap(release.dimensionMm))) {
      push('release.dimension', `${label}: DIMENSION=${row.dimension} ≠ ${snap(release.dimensionMm)}`);
    }
    if (row.functionCode !== release.functionCode) {
      push('release.function', `${label}: FUNCTION=${row.functionCode} ≠ ${release.functionCode}`);
    }
    if (row.comment !== expectedComment(release.regionId)) {
      push('release.comment', `${label}: COMMENT='${row.comment}' ≠ '${expectedComment(release.regionId) ?? ''}'`);
    }
    const expectedCutIndex = sheetMapping.releaseCutIndexByRegionId.get(release.regionId);
    if (expectedCutIndex === undefined || row.cutIndex !== expectedCutIndex) {
      push('release.index', `${label}: CUT_INDEX=${row.cutIndex} ≠ ${expectedCutIndex ?? '?'}`);
    }
    if (release.kind === 'offcut') {
      const expectedOffcutIndex = globalOffcutIndexByRegion.get(
        scopedRegionKey({ sheetIndex: sheet.sheetIndex, regionId: release.regionId }),
      );
      if (
        row.partReference.kind !== 'offcut' ||
        expectedOffcutIndex === undefined ||
        row.partReference.offcutIndex !== expectedOffcutIndex
      ) {
        push('release.offcut_ref', `${label}: PART_INDEX no referencia X${expectedOffcutIndex ?? '?'}`);
      }
    } else if (
      row.partReference.kind !== 'part' ||
      row.partReference.partIndex !== (mapping.partIndexByPieceRef.get(release.pieceRef!) ?? -1)
    ) {
      push('release.part_ref', `${label}: PART_INDEX no referencia la pieza ${release.pieceRef}`);
    }
  });

  // r3 (#661 M8): no Xn may back two physical release events — duplicates and
  // missing expected references are both concrete failures.
  if (r3) {
    const fn92Rows = (cutsByPattern.get(sheetMapping.patternIndex) ?? []).filter(
      (row) => row.functionCode === 92,
    );
    const seenXn = new Map<number, number>();
    for (const row of fn92Rows) {
      if (row.partReference.kind !== 'offcut') continue;
      const previous = seenXn.get(row.partReference.offcutIndex);
      if (previous !== undefined) {
        push('release.offcut_duplicate', `patrón ${sheetMapping.patternIndex}: X${row.partReference.offcutIndex} respaldado por dos releases físicas (filas CUT_INDEX ${previous} y ${row.cutIndex})`);
      } else {
        seenXn.set(row.partReference.offcutIndex, row.cutIndex);
      }
    }
  }

  // --- OFFCUTS rows for this sheet's remnant leaves ----------------------
  const remnantTerminals = trace.terminals.filter((t) => t.kind === 'remnant');
  for (const terminal of remnantTerminals) {
    const expectedIndex = globalOffcutIndexByRegion.get(
      scopedRegionKey({ sheetIndex: sheet.sheetIndex, regionId: terminal.regionId }),
    );
    const row = offcutRows.find((r) => expectedIndex !== undefined && r.offcutIndex === expectedIndex);
    if (!row) {
      push('offcuts.missing', `retazo '${terminal.regionId}' (X${expectedIndex ?? '?'}) sin fila OFFCUTS`);
      continue;
    }
    if (
      !close(row.length, snap(terminal.rect.lengthMm)) ||
      !close(row.width, snap(terminal.rect.widthMm))
    ) {
      push('offcuts.dims', `OFFCUTS X${expectedIndex} ${row.length}×${row.width} ≠ hoja ejecutada ${snap(terminal.rect.lengthMm)}×${snap(terminal.rect.widthMm)}`);
    }
    const sheetMaterialIndex = mapping.materialIndexByCode.get(sheet.materialCode);
    if (sheetMaterialIndex === undefined || row.materialIndex !== sheetMaterialIndex) {
      push('offcuts.material', `OFFCUTS X${expectedIndex} MAT_INDEX=${row.materialIndex} ≠ material de la hoja`);
    }
  }

  // --- VECTORS: absolute cut lines, top-left origin ----------------------
  if (options.includeVectors === true) {
    preorder.forEach((division, position) => {
      const matching = vectorRows.filter(
        (v) => v.patternIndex === sheetMapping.patternIndex && v.cutIndex === position + 1,
      );
      const label = `VECTORS patrón ${sheetMapping.patternIndex} corte ${position + 1} (cutId ${division.cutId})`;
      if (matching.length !== 1) {
        push('vectors.count', `${label}: ${matching.length} filas, se esperaba 1`);
        return;
      }
      const expected = deriveVectorLine(division, trace.boardRect.widthMm);
      const row = matching[0]!;
      if (
        !close(row.xStart, expected.xStart) ||
        !close(row.yStart, expected.yStart) ||
        !close(row.xEnd, expected.xEnd) ||
        !close(row.yEnd, expected.yEnd)
      ) {
        push(
          'vectors.line',
          `${label}: (${row.xStart},${row.yStart})-(${row.xEnd},${row.yEnd}) ≠ línea esperada (${expected.xStart},${expected.yStart})-(${expected.xEnd},${expected.yEnd})`,
        );
      }
    });
  }
}

function materialKerfBytes(ctx: SheetVerificationContext): number {
  // The bytes declare ONE uniform kerf per material (equality with the plan
  // kerf is checked in step 4); the sheet material's kerf is the derivation
  // input. Falls back to the executed trace's first kerf when the row is
  // missing — the corresponding materials issue has already been reported.
  const index = ctx.mapping.materialIndexByCode.get(ctx.sheet.materialCode);
  for (const record of ctx.parsed.records) {
    if (record.type === 'MATERIALS' && record.materialIndex === index) {
      return record.kerfRip;
    }
  }
  return ctx.trace.divisions[0]?.kerfMm ?? 0;
}

/**
 * TRIM_* values as parsed from the sheet material's bytes (extent-derivation
 * input for the usable root under r3). A byte-absent side falls back to the
 * independently re-derived margin; the absence itself is reported by the
 * materials.trims check, so the fallback only keeps the extent derivation
 * running.
 */
function materialTrimBytes(
  ctx: SheetVerificationContext,
  projection: LocalTrimProjection,
): { readonly trimFRip?: number; readonly trimVRip?: number; readonly trimFXct?: number; readonly trimVXct?: number } {
  const index = ctx.mapping.materialIndexByCode.get(ctx.sheet.materialCode);
  let row: PtxMaterialRecord | undefined;
  for (const record of ctx.parsed.records) {
    if (record.type === 'MATERIALS' && record.materialIndex === index) {
      row = record;
      break;
    }
  }
  return {
    trimFRip: row?.trimFRip ?? projection.trimFripMm,
    trimVRip: row?.trimVRip ?? projection.trimVripMm,
    trimFXct: row?.trimFXct ?? projection.trimFxctMm,
    trimVXct: row?.trimVXct ?? projection.trimVXctMm,
  };
}
