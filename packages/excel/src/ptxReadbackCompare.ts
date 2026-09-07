/**
 * Deterministic expected-vs-actual comparison for #348 PTX import/readback
 * validation. Consumes the structures from ptxReadback.ts; PURE and OFFLINE
 * (no machine, no capability inference, no PTX mutation, no I/O).
 *
 * Negative-proof rule: the comparator intentionally has NO "validated" status
 * output. A green comparison is evidence for the evidence pack, never a
 * compatibility claim (docs/machines/ptx-validation.md §9).
 */

import type {
  PtxActualReadback,
  PtxExpectedReadback,
  PtxFindingClassification,
  PtxReadbackComparison,
  PtxReadbackFinding,
} from './ptxReadback';

interface CompareOptions {
  /**
   * Tolerance (mm) below which a dimension difference is treated as receiver
   * display rounding instead of a data error. The PTX serializer writes one
   * decimal, so receivers typically show at most that precision.
   */
  readonly dimensionWarningToleranceMm?: number;
}

const DEFAULT_DIMENSION_WARNING_TOLERANCE_MM = 1;

const PASS = 'PASS' as const;
const WARNING = 'WARNING' as const;
const BLOCKER = 'BLOCKER' as const;
const UNSUPPORTED = 'UNSUPPORTED_CAPABILITY' as const;
const NOT_OBSERVABLE = 'NOT_OBSERVABLE' as const;

function fmt(value: unknown): string {
  if (value === undefined) return '(no informado)';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '(inválido)';
  return String(value);
}

function finding(
  field: string,
  classification: PtxFindingClassification,
  expected?: unknown,
  actual?: unknown,
  note?: string,
): PtxReadbackFinding {
  return {
    field,
    classification,
    expected: expected === undefined ? undefined : fmt(expected),
    actual: actual === undefined ? undefined : fmt(actual),
    note,
  };
}

function dimDiff(
  field: string,
  expected: number,
  actual: number | undefined,
  toleranceMm: number,
): PtxReadbackFinding {
  if (actual === undefined) {
    return finding(field, NOT_OBSERVABLE, expected);
  }
  const diff = Math.abs(expected - actual);
  if (diff <= 0.05) return finding(field, PASS, expected, actual);
  if (diff <= toleranceMm) {
    return finding(
      field,
      WARNING,
      expected,
      actual,
      `Diferencia de ${diff.toFixed(2)}mm podría ser redondeo del receptor; confirmar antes de descartar`,
    );
  }
  return finding(field, BLOCKER, expected, actual, `Diferencia de ${diff.toFixed(2)}mm`);
}

function isMmUnit(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'mm' || normalized === 'milimetros' || normalized === 'millimeters';
}

function compareTrim(
  expected: PtxExpectedReadback['job']['trimMm'],
  actual: PtxActualReadback['trimMm'],
): PtxReadbackFinding[] {
  const sides = ['topMm', 'bottomMm', 'leftMm', 'rightMm'] as const;
  return sides.map((side) => {
    const exp = expected[side];
    const act = actual?.[side];
    if (act === undefined) return finding(`job.trimMm.${side}`, NOT_OBSERVABLE, exp);
    return Math.abs(exp - act) <= 0.05
      ? finding(`job.trimMm.${side}`, PASS, exp, act)
      : finding(`job.trimMm.${side}`, BLOCKER, exp, act, 'Trim distinto cambia las medidas utiles del tablero');
  });
}

function compareCutOrder(
  expected: readonly string[],
  observed: readonly string[] | undefined,
): PtxReadbackFinding[] {
  if (!observed) {
    return [finding('cutOrder', NOT_OBSERVABLE, `${expected.length} pasos`)];
  }
  const same = expected.length === observed.length && expected.every((s, i) => s === observed[i]);
  if (same) return [finding('cutOrder', PASS, `${expected.length} pasos`, `${observed.length} pasos`)];
  const firstDiff = expected.findIndex((s, i) => s !== observed[i]);
  return [
    finding(
      'cutOrder',
      WARNING,
      `${expected.length} pasos`,
      `${observed.length} pasos`,
      `Primera diferencia en el paso ${firstDiff + 1}: la clasificación depende del ownership de la optimización (docs/machines/ptx-validation.md §7); un receptor que reordena legítimamente no es bloqueante por sí solo`,
    ),
  ];
}

/**
 * Compares the frozen expected readback against an operator-captured actual
 * readback. Deterministic: same inputs always produce the same findings.
 */
export function comparePtxReadback(
  expected: PtxExpectedReadback,
  actual: PtxActualReadback,
  options?: CompareOptions,
): PtxReadbackComparison {
  const toleranceMm = options?.dimensionWarningToleranceMm ?? DEFAULT_DIMENSION_WARNING_TOLERANCE_MM;
  const findings: PtxReadbackFinding[] = [];

  // --- Job level ---
  findings.push(
    actual.units === undefined
      ? finding('job.units', NOT_OBSERVABLE, expected.job.units)
      : isMmUnit(actual.units)
        ? finding('job.units', PASS, expected.job.units, actual.units)
        : finding('job.units', BLOCKER, expected.job.units, actual.units, 'Unidad distinta invalida todas las medidas del readback'),
  );

  if (actual.kerfMm === undefined) {
    findings.push(finding('job.kerfMm', NOT_OBSERVABLE, expected.job.kerfMm));
  } else if (Math.abs(expected.job.kerfMm - actual.kerfMm) <= 0.05) {
    findings.push(finding('job.kerfMm', PASS, expected.job.kerfMm, actual.kerfMm));
  } else {
    findings.push(
      finding('job.kerfMm', BLOCKER, expected.job.kerfMm, actual.kerfMm, 'Kerf distinto desplaza todas las posiciones de corte'),
    );
  }

  findings.push(...compareTrim(expected.job.trimMm, actual.trimMm));

  if (actual.sheetCount === undefined) {
    findings.push(finding('job.sheetCount', NOT_OBSERVABLE, expected.job.sheetCount));
  } else {
    findings.push(
      actual.sheetCount === expected.job.sheetCount
        ? finding('job.sheetCount', PASS, expected.job.sheetCount, actual.sheetCount)
        : finding('job.sheetCount', BLOCKER, expected.job.sheetCount, actual.sheetCount),
    );
  }

  if (actual.placedPieceCount === undefined) {
    findings.push(finding('job.placedPieceCount', NOT_OBSERVABLE, expected.job.placedPieceCount));
  } else {
    findings.push(
      actual.placedPieceCount === expected.job.placedPieceCount
        ? finding('job.placedPieceCount', PASS, expected.job.placedPieceCount, actual.placedPieceCount)
        : finding(
            'job.placedPieceCount',
            BLOCKER,
            expected.job.placedPieceCount,
            actual.placedPieceCount,
            'Conteo de piezas colocadas distinto: verificar colapso/expansión de cantidades antes de seguir',
          ),
    );
  }

  // --- Materials ---
  const actualMaterialsProvided = actual.materials !== undefined;
  const actualMaterials = actual.materials ?? [];
  if (!actualMaterialsProvided) {
    findings.push(
      finding(
        'materials',
        NOT_OBSERVABLE,
        `${expected.materials.length} materiales`,
        undefined,
        'El receptor no expone materiales: sin este readback no hay validación de material',
      ),
    );
  }
  // Skip per-material findings when the receiver exposes no material list at
  // all: the absence was already reported once as NOT_OBSERVABLE above.
  for (const expMat of expected.materials) {
    if (!actualMaterialsProvided) break;
    const actMat = actualMaterials.find((m) => m.materialCode === expMat.materialCode);
    const field = `materials[${expMat.materialCode}]`;
    if (!actMat) {
      findings.push(
        finding(
          `${field}.materialCode`,
          BLOCKER,
          expMat.materialCode,
          undefined,
          'Material del fixture ausente en el readback',
        ),
      );
      continue;
    }
    findings.push(finding(`${field}.materialCode`, PASS, expMat.materialCode, actMat.materialCode));
    findings.push(dimDiff(`${field}.sheetLengthMm`, expMat.sheetLengthMm, actMat.sheetLengthMm, toleranceMm));
    findings.push(dimDiff(`${field}.sheetWidthMm`, expMat.sheetWidthMm, actMat.sheetWidthMm, toleranceMm));
    findings.push(dimDiff(`${field}.thicknessMm`, expMat.thicknessMm, actMat.thicknessMm, toleranceMm));
  }
  const unexpectedMaterials = actualMaterials.filter(
    (m) => m.materialCode && !expected.materials.some((e) => e.materialCode === m.materialCode),
  );
  for (const mat of unexpectedMaterials) {
    findings.push(
      finding(
        `materials[${mat.materialCode}].materialCode`,
        BLOCKER,
        undefined,
        mat.materialCode,
        'Material inesperado: no existe en el fixture congelado',
      ),
    );
  }

  // --- Parts (matched by partCode) ---
  const actualPartsProvided = actual.parts !== undefined;
  const actualParts = actual.parts ?? [];
  if (!actualPartsProvided) {
    findings.push(
      finding(
        'parts',
        NOT_OBSERVABLE,
        `${expected.parts.length} piezas`,
        undefined,
        'El receptor no expone lista de piezas: sin este readback no hay validación de contenido',
      ),
    );
  }
  // Same rule as materials: no part list exposed → reported once above.
  for (const expPart of expected.parts) {
    if (!actualPartsProvided) break;
    const actPart = actualParts.find((p) => p.partCode === expPart.partCode);
    const field = `parts[${expPart.partCode}]`;
    if (!actPart) {
      findings.push(
        finding(`${field}.partCode`, BLOCKER, expPart.partCode, undefined, 'Pieza del fixture ausente en el readback'),
      );
      continue;
    }

    if (actPart.quantity === undefined) {
      findings.push(finding(`${field}.quantity`, NOT_OBSERVABLE, expPart.quantity));
    } else {
      findings.push(
        actPart.quantity === expPart.quantity
          ? finding(`${field}.quantity`, PASS, expPart.quantity, actPart.quantity)
          : finding(
              `${field}.quantity`,
              BLOCKER,
              expPart.quantity,
              actPart.quantity,
              'Cantidad de piezas distinta: el receptor colapsó o expandió instancias',
            ),
      );
    }

    findings.push(dimDiff(`${field}.finishedLengthMm`, expPart.finishedLengthMm, actPart.finishedLengthMm, toleranceMm));
    findings.push(dimDiff(`${field}.finishedWidthMm`, expPart.finishedWidthMm, actPart.finishedWidthMm, toleranceMm));

    // Cut dims only when the receiver exposes them AND the instance is not rotated,
    // because a rotated placement swaps length/width by design.
    if (actPart.cutLengthMm !== undefined || actPart.cutWidthMm !== undefined) {
      const rotatedNow = (actPart.rotatedCount ?? 0) > 0;
      if (rotatedNow && expPart.rotatedCount > 0) {
        findings.push(
          finding(
            `${field}.cutLengthMm`,
            NOT_OBSERVABLE,
            expPart.cutLengthMm,
            actPart.cutLengthMm,
            'Instancia rotada: las medidas de corte intercambian L/A por diseño; comparar contra la orientación reportada',
          ),
        );
      } else {
        findings.push(dimDiff(`${field}.cutLengthMm`, expPart.cutLengthMm, actPart.cutLengthMm, toleranceMm));
        findings.push(dimDiff(`${field}.cutWidthMm`, expPart.cutWidthMm, actPart.cutWidthMm, toleranceMm));
      }
    }

    findings.push(dimDiff(`${field}.thicknessMm`, expPart.thicknessMm, actPart.thicknessMm, toleranceMm));

    // Material identity: code mismatch is blocking; name-only evidence is a warning.
    if (actPart.materialCode === undefined) {
      if (actPart.materialName !== undefined) {
        const expMat = expected.materials.find((m) => m.materialCode === expPart.materialCode);
        const nameMatches = expMat !== undefined && actPart.materialName === expMat.materialName;
        findings.push(
          finding(
            `${field}.materialCode`,
            WARNING,
            expPart.materialCode,
            actPart.materialName,
            nameMatches
              ? 'El receptor no expone código de material; el nombre coincide — evaluar si la identidad de material es trazable en el taller'
              : 'El receptor no expone código de material y el nombre no coincide',
          ),
        );
      } else {
        findings.push(finding(`${field}.materialCode`, NOT_OBSERVABLE, expPart.materialCode));
      }
    } else {
      findings.push(
        actPart.materialCode === expPart.materialCode
          ? finding(`${field}.materialCode`, PASS, expPart.materialCode, actPart.materialCode)
          : finding(`${field}.materialCode`, BLOCKER, expPart.materialCode, actPart.materialCode),
      );
    }

    // Grain/orientation: physically binding. Grain-1 pieces must never rotate.
    if (actPart.grain === undefined) {
      findings.push(finding(`${field}.grain`, NOT_OBSERVABLE, expPart.grain));
    } else {
      findings.push(
        actPart.grain === expPart.grain
          ? finding(`${field}.grain`, PASS, expPart.grain, actPart.grain)
          : finding(
              `${field}.grain`,
              BLOCKER,
              expPart.grain,
              actPart.grain,
              'Semáforo de veta distinto: la orientación física de la pieza puede quedar al revés',
            ),
      );
    }

    if (actPart.rotatedCount === undefined) {
      findings.push(finding(`${field}.rotatedCount`, NOT_OBSERVABLE, expPart.rotatedCount));
    } else if (actPart.rotatedCount === expPart.rotatedCount) {
      findings.push(finding(`${field}.rotatedCount`, PASS, expPart.rotatedCount, actPart.rotatedCount));
    } else if (expPart.grain === 1) {
      findings.push(
        finding(
          `${field}.rotatedCount`,
          BLOCKER,
          expPart.rotatedCount,
          actPart.rotatedCount,
          'Pieza con veta rotada o desrotada por el receptor: rotación no permitida con grain=1',
        ),
      );
    } else {
      findings.push(
        finding(
          `${field}.rotatedCount`,
          WARNING,
          expPart.rotatedCount,
          actPart.rotatedCount,
          'Rotación distinta en pieza sin veta: legal si el receptor re-optimiza la ubicación; clasificar según ownership de la optimización (§7)',
        ),
      );
    }

    // Edge band thickness (the only band data PTX carries; code/name are not represented).
    if (expPart.edgeBandThicknessMm === undefined) {
      findings.push(
        finding(
          `${field}.edgeBandThicknessMm`,
          UNSUPPORTED,
          '(sin canto en fixture)',
          actPart.edgeBandThicknessMm,
          'PTX actual no distingue "sin canto" de "canto 0": verificar qué muestra el receptor',
        ),
      );
    } else if (actPart.edgeBandThicknessMm === undefined) {
      findings.push(finding(`${field}.edgeBandThicknessMm`, NOT_OBSERVABLE, expPart.edgeBandThicknessMm));
    } else {
      findings.push(
        Math.abs(expPart.edgeBandThicknessMm - actPart.edgeBandThicknessMm) <= 0.05
          ? finding(`${field}.edgeBandThicknessMm`, PASS, expPart.edgeBandThicknessMm, actPart.edgeBandThicknessMm)
          : finding(
              `${field}.edgeBandThicknessMm`,
              BLOCKER,
              expPart.edgeBandThicknessMm,
              actPart.edgeBandThicknessMm,
              'Espesor de canto distinto: afecta deducción de medida en crudo y enchapado',
            ),
      );
    }

    // Barcodes: identity carriers for downstream flow. Loss of identity with
    // dimensions retained must be evaluated explicitly, never auto-passed.
    if (!actPart.barcodes || actPart.barcodes.length === 0) {
      findings.push(
        finding(
          `${field}.barcodes`,
          WARNING,
          expPart.barcodes.join(', '),
          undefined,
          'El receptor no expone el código de barras/pieza: evaluar explícitamente cómo se identifica la pieza cortada aguas abajo',
        ),
      );
    } else {
      const allMatch =
        expPart.barcodes.length === actPart.barcodes.length &&
        expPart.barcodes.every((b) => actPart.barcodes!.includes(b));
      findings.push(
        allMatch
          ? finding(`${field}.barcodes`, PASS, expPart.barcodes.join(', '), actPart.barcodes.join(', '))
          : finding(
              `${field}.barcodes`,
              WARNING,
              expPart.barcodes.join(', '),
              actPart.barcodes.join(', '),
              'Códigos de barra distintos: la identidad sobrevive pero cambió — evaluar trazabilidad aguas abajo',
            ),
      );
    }
  }

  const unexpectedParts = actualParts.filter(
    (p) => !expected.parts.some((e) => e.partCode === p.partCode),
  );
  for (const part of unexpectedParts) {
    findings.push(
      finding(
        `parts[${part.partCode}].partCode`,
        BLOCKER,
        undefined,
        part.partCode,
        'Pieza inesperada: no existe en el fixture congelado',
      ),
    );
  }

  // --- Cut order ---
  findings.push(...compareCutOrder(expected.cutOrderExpected, actual.cutOrderObserved));

  // --- Fields the current PTX cannot represent (always reported) ---
  for (const fieldName of expected.notRepresentedByCurrentPtx) {
    findings.push(
      finding(
        `notRepresented.${fieldName}`,
        UNSUPPORTED,
        undefined,
        undefined,
        'El PTX actual no transporta este dato: la provenance debe demostrarse fuera del archivo (evidence pack)',
      ),
    );
  }

  const count = (classification: PtxFindingClassification) =>
    findings.filter((f) => f.classification === classification).length;

  return {
    findings,
    blockerCount: count(BLOCKER),
    warningCount: count(WARNING),
    unsupportedCount: count(UNSUPPORTED),
    notObservableCount: count(NOT_OBSERVABLE),
    passCount: count(PASS),
  };
}
