/**
 * PTX postprocessor adapter (#351 foundation, #650 CADmatic 4 candidate route,
 * #793 r5 productive final-gate route).
 *
 * Serialization routes, selected by EXACT profile revision — never by
 * name/metadata guessing:
 *
 * - `ptx-cadmatic-4@r2/r3/r4` (frozen history): the documented PTX compiler
 *   of #650/#657/#661/#781 — CutPlan/CutProgram → compileCutPlanToPtxDocument
 *   → validate → serializePtxDocumentBytes. Every effective option declared by
 *   the profile is consumed by this route; an option value the implementation
 *   does not support blocks with a specific reason instead of being ignored.
 *   canSerialize runs the REAL compilation preflight (the compiler is pure and
 *   deterministic), so every ptx_compile.* failure surfaces as an actionable
 *   blocker BEFORE any bytes exist, and `ready === true` guarantees serialize()
 *   executes for the same input. Byte identities of r2/r3/r4 are frozen.
 *
 * - `ptx-cadmatic-4@r5` (#793, the PRODUCTIVE final-gate candidate): the same
 *   documented compiler with the r5 contract — TITLE GRANETE-R5-FIELD-TEST
 *   (21 chars, inside the documented 25-char limit), strict Pattern Exchange
 *   spec preflight on BOTH the compiled document and the serialized bytes
 *   (serializePtxDocumentBytesSpecChecked — unchecked r5 bytes cannot exist),
 *   part-local pre-rotation PARTS_REQ dimensions, structural PARTS_UDI, the
 *   productive receiver policy HPP250-CAD4-R5-CANDIDATE, and PARTS_INF/
 *   PARTS_UDI labels projected from the NEUTRAL frozen manufacturing label
 *   authority carried by the resolved job. HARD GATES (fail-closed, never a
 *   fallback to r4/ptx-generic/legacy): the plan must pin a frozen release
 *   base that matches the label projection's release base; the job must carry
 *   the neutral projection AND its mapped partLabels with exact 1:1 code
 *   coverage; any missing r5 data BLOCKS.
 *
 * - Every other PTX profile revision (ptx-generic@r1 today): the legacy
 *   ptxCutPlanExport serializer, unchanged and still byte-identical to the
 *   audited #348 golden. The legacy serializer is NOT removed — other
 *   selections still depend on it — and this revision-bound routing means an
 *   old pinned selection keeps its historical behavior until re-selected.
 *
 * Field validation stays NOT_TESTED for every route: serializing never
 * promotes a compatibility claim.
 */

import {
  AdapterSerializationBlocked,
  manufacturingCncScope,
  type AdapterBlockReason,
  type AdapterReadiness,
  type ManufacturingLabelProjection,
  type OutputCompatibilityProfile,
  type PostprocessorAdapter,
  type ResolvedCuttingJob,
} from '@granete/domain';
import { generatePtxString } from '../ptxCutPlanExport';
import {
  compileCutPlanToPtxDocument,
  PtxCompilationError,
  type CompileCutPlanToPtxOptions,
} from '../ptx/compileCutPlan';
import type { PtxPartLabelData } from '../ptx/partLabels';
import { PtxDocumentInvalidError } from '../ptx/validate';
import { serializePtxDocumentBytes } from '../ptx/serialize';
import { serializePtxDocumentBytesSpecChecked } from '../ptx/specPreflight';
import {
  HPP250_CAD4_R5_CANDIDATE_POLICY_ID,
  HPP250_CAD4_R5_CANDIDATE_RECEIVER_POLICY,
} from '../ptx/receiverPolicy';
import {
  PTX_COMPILER_R4_REQUIRED_DIMENSIONS,
  PTX_COMPILER_R5_REQUIRED_DIMENSIONS,
  PTX_COMPILER_REQUIRED_DIMENSIONS,
  PTX_REQUIRED_DIMENSIONS,
} from './profiles';

/**
 * Resolved cutting job as the PTX adapter consumes it: the neutral domain
 * contract plus the export-layer label projection mapped from it
 * (`ptxPartLabelsFromManufacturingProjection` is the only sanctioned
 * producer). Structural typing keeps plain ResolvedCuttingJob inputs valid
 * for every non-r5 revision; the r5 route fails closed when either half of
 * the label authority is absent.
 */
export type PtxResolvedCuttingJob = ResolvedCuttingJob & {
  readonly partLabels?: readonly PtxPartLabelData[];
};

function checkRequiredDimensions(
  profile: OutputCompatibilityProfile,
  required: readonly string[],
): readonly AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [];
  for (const dimension of required) {
    if (profile.dimensions[dimension] === undefined) {
      reasons.push({
        code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
        dimension,
        detail: `dimension '${dimension}' of profile ${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId} has no field/repo evidence`,
      });
    }
  }
  return reasons;
}

export function checkFormatFamily(
  profile: OutputCompatibilityProfile,
  expected: PostprocessorAdapter['producedFormatFamily'],
): readonly AdapterBlockReason[] {
  return profile.formatFamily === expected
    ? []
    : [
        {
          code: 'FORMAT_FAMILY_MISMATCH',
          detail: `profile ${profile.ref.outputCompatibilityProfileId} is family '${profile.formatFamily}'; adapter produces '${expected}'`,
        },
      ];
}

// ---------------------------------------------------------------------------
// Documented-PTX compiler route (ptx-cadmatic-4@r2)
// ---------------------------------------------------------------------------

/** Fixed candidate label written to HEADER.TITLE — honest, deterministic, receiver-agnostic. */
export const PTX_CANDIDATE_TITLE = 'GRANETE-PTX-CANDIDATE NOT_MACHINE_VALIDATED';

/**
 * #793 r5 TITLE — fixed, ASCII, deterministic, 21 characters (inside the
 * documented 25-char Pattern Exchange limit; the r4 43-char title stays as
 * frozen historical evidence and is never reused). No customer/project
 * names, no UUID, no timestamp, no hostname, no user, no release name.
 */
export const PTX_R5_FIELD_TEST_TITLE = 'GRANETE-R5-FIELD-TEST';

/**
 * Exact profile revisions routed to the documented PTX compiler: r2 (#650,
 * trim = 0 only), r3 (#661, evidenced positive-trim subset), r4 (#781, field
 * dialect after the first CADLink rejection) and r5 (#793, productive
 * final-gate candidate with strict spec preflight + frozen label authority).
 * Selection is by EXACT revision — never by name or family.
 */
export function profileUsesDocumentedPtxCompiler(profile: OutputCompatibilityProfile): boolean {
  return (
    profile.ref.outputCompatibilityProfileId === 'ptx-cadmatic-4' &&
    (profile.ref.revisionId === 'r2' || profile.ref.revisionId === 'r3' || profile.ref.revisionId === 'r4' || profile.ref.revisionId === 'r5')
  );
}

/** True only for the #793 productive final-gate revision. */
export function isCadmatic4R5(profile: OutputCompatibilityProfile): boolean {
  return (
    profile.ref.outputCompatibilityProfileId === 'ptx-cadmatic-4' &&
    profile.ref.revisionId === 'r5'
  );
}

/** Profile-driven effective configuration for the compiler route. */
export interface PtxCompilerRouteConfig {
  readonly compileOptions: CompileCutPlanToPtxOptions;
  readonly lineEnding: '\r\n' | '\n';
  readonly allowedFunctions: readonly number[];
}

/**
 * Resolves the compiler route configuration from the profile dimensions.
 * Every dimension must exist AND carry a value this implementation actually
 * supports; anything else is a specific blocker (never a decorative option).
 */
export function resolvePtxCompilerRoute(profile: OutputCompatibilityProfile):
  { config?: PtxCompilerRouteConfig; reasons: readonly AdapterBlockReason[] } {
  const label = `${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`;
  const isCadmatic4R3 = label === 'ptx-cadmatic-4@r3';
  const isCadmatic4R4 = label === 'ptx-cadmatic-4@r4';
  const r5 = isCadmatic4R5(profile);
  // r4 (#781) additionally requires its field-dialect dimensions; r5 (#793)
  // requires the r4 set plus its own four decisions. r2/r3 keep their
  // historical sets and must not fail on dimensions they never had.
  const required = r5
    ? [...PTX_COMPILER_REQUIRED_DIMENSIONS, ...PTX_COMPILER_R5_REQUIRED_DIMENSIONS]
    : isCadmatic4R4
      ? [...PTX_COMPILER_REQUIRED_DIMENSIONS, ...PTX_COMPILER_R4_REQUIRED_DIMENSIONS]
      : PTX_COMPILER_REQUIRED_DIMENSIONS;
  const missing = checkRequiredDimensions(profile, required);
  if (missing.length > 0) return { reasons: missing };

  const dims = profile.dimensions;
  const reasons: AdapterBlockReason[] = [];
  const unsupported = (detail: string): void => {
    reasons.push({ code: 'SERIALIZER_NOT_IMPLEMENTED', detail });
  };

  if (String(dims.fileExtension) !== 'ptx') {
    unsupported(`fileExtension '${String(dims.fileExtension)}' no implementado: el candidato documentado emite .ptx`);
  }
  if (String(dims.encoding) !== 'ascii') {
    unsupported(`encoding '${String(dims.encoding)}' no implementado: el candidato documentado emite ASCII (la investigación NO autoriza extrapolar requisitos UTF-8 de SAW al PTX)`);
  }
  const lineEndingRaw = String(dims.lineEnding);
  const lineEnding = lineEndingRaw === 'crlf' ? '\r\n' : lineEndingRaw === 'lf' ? '\n' : undefined;
  if (!lineEnding) {
    unsupported(`lineEnding '${lineEndingRaw}' no implementado (crlf|lf)`);
  }
  if (String(dims.unit) !== 'mm') {
    unsupported(`unit '${String(dims.unit)}' no implementado: el dominio emite mm`);
  }
  const decimalPlaces = dims.decimalPlaces;
  if (
    typeof decimalPlaces !== 'number' ||
    !Number.isInteger(decimalPlaces) ||
    decimalPlaces < 0 ||
    decimalPlaces > 6
  ) {
    unsupported(`decimalPlaces '${String(decimalPlaces)}' no implementado (entero 0..6 con preflight de representabilidad exacta)`);
  }
  const headerVersion = Number(dims.headerVersion);
  if (!Number.isFinite(headerVersion) || headerVersion <= 0) {
    unsupported(`headerVersion '${String(dims.headerVersion)}' no es un número de versión positivo`);
  }
  const headerOrigin = dims.headerOrigin;
  if (typeof headerOrigin !== 'number' || !Number.isInteger(headerOrigin) || headerOrigin < 0) {
    unsupported(`headerOrigin '${String(dims.headerOrigin)}' no es un entero no negativo`);
  }
  const trimType = dims.trimType;
  if (trimType !== 0 && trimType !== 1) {
    unsupported(`trimType '${String(trimType)}' no está en el diccionario documentado (0|1)`);
  }
  const includeVectors = dims.includeVectors;
  if (typeof includeVectors !== 'boolean') {
    unsupported(`includeVectors '${String(dims.includeVectors)}' no es booleano`);
  }
  // r2 keeps supportsPositiveTrim=false (trims fail closed); r3 enables the
  // evidenced fixed-frame subset of 04_contrato_r3_refilados.md — the option
  // is forwarded verbatim so the compiler runs the exact revision policy.
  const supportsPositiveTrim = dims.supportsPositiveTrim;
  if (typeof supportsPositiveTrim !== 'boolean') {
    unsupported(`supportsPositiveTrim '${String(dims.supportsPositiveTrim)}' no es booleano`);
  }
  if (isCadmatic4R3 && supportsPositiveTrim === true && trimType !== 1) {
    reasons.push({
      code: 'ptx_compile.profile_option_unsupported',
      dimension: 'trimType',
      detail: `${label} con refilados positivos exige trimType=1 (fixed trim first)`,
    });
  }
  if (isCadmatic4R3 && includeVectors === true) {
    reasons.push({
      code: 'ptx_compile.profile_option_unsupported',
      dimension: 'includeVectors',
      detail: `${label} no implementa includeVectors=true: el contrato r3 exige VECTORS=off`,
    });
  }
  const supportedFunctionsRaw = String(dims.supportedFunctions)
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  const allowedFunctions = supportedFunctionsRaw.map((token) => Number(token));
  if (
    supportedFunctionsRaw.length === 0 ||
    allowedFunctions.some((code) => !Number.isInteger(code) || code < 0)
  ) {
    unsupported(`supportedFunctions '${String(dims.supportedFunctions)}' no es una lista de códigos enteros ≥ 0`);
  }

  // r4 (#781) field-dialect options — each one reaches the bytes through the
  // compiler; an unsupported value blocks instead of being decorative. r5
  // (#793) inherits the exact same dialect set on top of its own decisions.
  let offcutsWithQuantity: boolean | undefined;
  let offcutsBeforePatterns: boolean | undefined;
  let offcutCutMarkers: 'function92-only' | undefined;
  let partCodeAuthority: 'workshop-labelref' | undefined;
  let partCodeMaxLength: number | undefined;
  if (isCadmatic4R4 || r5) {
    if (dims.offcutsWithQuantity !== true) {
      unsupported(`offcutsWithQuantity '${String(dims.offcutsWithQuantity)}' no implementado (r4+ exige true: columna OFC_QTY evidenciada)`);
    } else {
      offcutsWithQuantity = true;
    }
    if (dims.offcutsBeforePatterns !== true) {
      unsupported(`offcutsBeforePatterns '${String(dims.offcutsBeforePatterns)}' no implementado (r4+ exige true: OFFCUTS declarado antes de PATTERNS/CUTS)`);
    } else {
      offcutsBeforePatterns = true;
    }
    if (dims.offcutCutMarkers !== 'function92-only') {
      unsupported(`offcutCutMarkers '${String(dims.offcutCutMarkers)}' no implementado (r4+ sólo 'function92-only': Xn exclusivamente en FUNCTION 92)`);
    } else {
      offcutCutMarkers = 'function92-only';
    }
    if (dims.partCodeAuthority !== 'workshop-labelref') {
      unsupported(`partCodeAuthority '${String(dims.partCodeAuthority)}' no implementado (r4+ sólo 'workshop-labelref': código de fabricación por pieza física)`);
    } else {
      partCodeAuthority = 'workshop-labelref';
    }
    partCodeMaxLength = dims.partCodeMaxLength as number;
    if (
      typeof partCodeMaxLength !== 'number' ||
      !Number.isInteger(partCodeMaxLength) ||
      partCodeMaxLength < 1
    ) {
      unsupported(`partCodeMaxLength '${String(dims.partCodeMaxLength)}' no es un entero ≥ 1`);
      partCodeMaxLength = undefined;
    }
    if (includeVectors === true) {
      reasons.push({
        code: 'ptx_compile.profile_option_unsupported',
        dimension: 'includeVectors',
        detail: `${label} no implementa includeVectors=true: el contrato mantiene VECTORS=off`,
      });
    }
    if (trimType !== 1) {
      reasons.push({
        code: 'ptx_compile.profile_option_unsupported',
        dimension: 'trimType',
        detail: `${label} con refilados positivos exige trimType=1 (hereda el frame fijo del contrato r3)`,
      });
    }
  }

  // r5 (#793) decisions — every value is consumed by the compiler route (the
  // spec preflight runs inside compileCutPlanToPtxDocument AND the serializer
  // boundary; the dimension/frame/UDI/receiver policies become compile
  // options). An unsupported value blocks instead of being decorative.
  let strictSpecPreflight: CompileCutPlanToPtxOptions['strictSpecPreflight'];
  let partsReqDimensionPolicy: CompileCutPlanToPtxOptions['partsReqDimensionPolicy'];
  let partsUdi: CompileCutPlanToPtxOptions['partsUdi'];
  if (r5) {
    if (dims.strictSpecPreflight !== 'pattern-exchange-v1') {
      unsupported(`strictSpecPreflight '${String(dims.strictSpecPreflight)}' no implementado (r5 exige 'pattern-exchange-v1' #788)`);
    } else {
      strictSpecPreflight = 'pattern-exchange-v1';
    }
    if (dims.partsReqDimensionPolicy !== 'part-local-pre-rotation-cut') {
      unsupported(`partsReqDimensionPolicy '${String(dims.partsReqDimensionPolicy)}' no implementado (r5 exige 'part-local-pre-rotation-cut' #789)`);
    } else {
      partsReqDimensionPolicy = 'part-local-pre-rotation-cut';
    }
    if (dims.partsUdi !== 'structural') {
      unsupported(`partsUdi '${String(dims.partsUdi)}' no implementado (r5 exige 'structural' #789)`);
    } else {
      partsUdi = 'structural';
    }
    if (dims.receiverPolicy !== HPP250_CAD4_R5_CANDIDATE_POLICY_ID) {
      unsupported(`receiverPolicy '${String(dims.receiverPolicy)}' no implementado (r5 sólo '${HPP250_CAD4_R5_CANDIDATE_POLICY_ID}': política productiva #790/#793)`);
    }
  }

  if (reasons.length > 0 || lineEnding === undefined || typeof decimalPlaces !== 'number') {
    return { reasons };
  }

  return {
    config: {
      compileOptions: {
        headerVersion,
        headerOrigin: headerOrigin as number,
        trimType: trimType as 0 | 1,
        title: r5 ? PTX_R5_FIELD_TEST_TITLE : PTX_CANDIDATE_TITLE,
        decimalPlaces: decimalPlaces as number,
        includeVectors: (includeVectors as boolean) === true ? true : undefined,
        supportsPositiveTrim: (supportsPositiveTrim as boolean) === true ? true : undefined,
        offcutsWithQuantity,
        offcutsBeforePatterns,
        offcutCutMarkers,
        partCodeAuthority,
        ...(partCodeMaxLength !== undefined ? { partCodeMaxLength } : {}),
        ...(strictSpecPreflight !== undefined ? { strictSpecPreflight } : {}),
        ...(partsReqDimensionPolicy !== undefined ? { partsReqDimensionPolicy } : {}),
        ...(partsUdi !== undefined ? { partsUdi } : {}),
        ...(r5 ? { receiverPolicy: HPP250_CAD4_R5_CANDIDATE_RECEIVER_POLICY } : {}),
      },
      lineEnding,
      allowedFunctions,
    },
    reasons,
  };
}

/** Maps any compiler failure to an actionable blocker (specific ptx_compile.* code in the detail). */
function compilationBlockReason(error: unknown): AdapterBlockReason {
  if (error instanceof PtxCompilationError) {
    return {
      code: error.code,
      detail: error.message,
      context: error.context,
    };
  }
  if (error instanceof PtxDocumentInvalidError) {
    return {
      code: 'OPERATION_NOT_REPRESENTABLE',
      detail: `documento PTX inválido tras la compilación: ${error.message}`,
    };
  }
  return {
    code: 'OPERATION_NOT_REPRESENTABLE',
    detail: error instanceof Error ? error.message : 'fallo desconocido del compilador PTX',
  };
}

// ---------------------------------------------------------------------------
// r5 hard gates (#793): frozen release identity + productive label authority
// ---------------------------------------------------------------------------

/**
 * Every #793 hard gate that must hold BEFORE the r5 route compiles anything.
 * Each missing piece BLOCKS with a specific reason — r5 never falls back to
 * r4, ptx-generic or the legacy serializer, and never serializes partial
 * label authority.
 */
function r5LabelAuthorityReasons(job: PtxResolvedCuttingJob): readonly AdapterBlockReason[] {
  const reasons: AdapterBlockReason[] = [];
  const projection: ManufacturingLabelProjection | undefined = job.manufacturingLabels;
  const labels = job.partLabels;

  if (projection === undefined) {
    reasons.push({
      code: 'ptx_compile.label_authority_missing',
      detail:
        'r5 exige la proyección neutral de etiquetas desde la verdad congelada del release (ManufacturingLabelProjection en el job): sin autoridad no se generan PARTS_INF/PARTS_UDI',
    });
    return reasons;
  }
  if (labels === undefined || labels.length === 0) {
    reasons.push({
      code: 'ptx_compile.label_authority_missing',
      detail:
        'r5 exige las partLabels proyectadas desde la proyección congelada (ptxPartLabelsFromManufacturingProjection): el compilador no reconstruye etiquetas',
    });
    return reasons;
  }

  // 1:1 code coverage between the frozen projection and its mapped labels —
  // a filtered, partial or hand-crafted projection can never reach bytes.
  const projectionCodes = new Set(projection.pieces.map((piece) => piece.manufacturingPartCode));
  const labelCodes = new Set(labels.map((label) => label.manufacturingPartCode));
  for (const code of projectionCodes) {
    if (!labelCodes.has(code)) {
      reasons.push({
        code: 'ptx_compile.label_missing',
        detail: `la proyección congelada lleva la pieza '${code}' pero las partLabels del job no`,
        context: { manufacturingPartCode: code },
      });
    }
  }
  for (const code of labelCodes) {
    if (!projectionCodes.has(code)) {
      reasons.push({
        code: 'ptx_compile.label_code_unknown',
        detail: `las partLabels del job llevan la pieza '${code}' fuera de la proyección congelada`,
        context: { manufacturingPartCode: code },
      });
    }
  }

  // Frozen release identity: the plan must pin a release base and it must be
  // the EXACT release the label projection was derived from.
  const planBase = job.cutPlan.releaseBase;
  if (planBase === undefined) {
    reasons.push({
      code: 'ptx_compile.release_identity_missing',
      detail:
        'r5 exige un plan generado desde una liberación congelada (CutPlan.releaseBase ausente): no se serializa un plan sin identidad frozen',
    });
  } else if (
    planBase.releaseId !== projection.releaseBase.releaseId ||
    planBase.designRevisionId !== projection.releaseBase.designRevisionId ||
    planBase.manufacturingFingerprint !== projection.releaseBase.manufacturingFingerprint
  ) {
    reasons.push({
      code: 'ptx_compile.release_identity_mismatch',
      detail:
        'la proyección de etiquetas corresponde a otra liberación/revisión: regenerá el plan desde la liberación de la proyección (nunca se re-etiqueta un plan con una autoridad ajena)',
      context: {
        planReleaseId: planBase.releaseId,
        projectionReleaseId: projection.releaseBase.releaseId,
      },
    });
  }

  // CNC scope identity must be the frozen release-derived scope (same
  // algorithm as the domain builder — imported, never duplicated).
  if (projection.cncScope !== manufacturingCncScope(projection.releaseBase)) {
    reasons.push({
      code: 'ptx_compile.release_identity_mismatch',
      detail: 'el scope CNC de la proyección no se deriva de su propia identidad frozen de release',
      context: { cncScope: projection.cncScope },
    });
  }

  return reasons;
}

/** Compiles + validates + serializes through the documented route; throws AdapterSerializationBlocked on any blocker. */
function serializeWithDocumentedCompiler(
  job: PtxResolvedCuttingJob,
  profile: OutputCompatibilityProfile,
): Uint8Array {
  const route = resolvePtxCompilerRoute(profile);
  const r5 = isCadmatic4R5(profile);
  const reasons: AdapterBlockReason[] = [...route.reasons];
  if (r5) {
    reasons.push(...r5LabelAuthorityReasons(job));
  }
  let bytes: Uint8Array | undefined;

  if (!route.config || reasons.length > 0) {
    throw new AdapterSerializationBlocked(reasons);
  }

  try {
    const compiled = compileCutPlanToPtxDocument(job.cutPlan, {
      ...route.config.compileOptions,
      ...(r5 ? { partLabels: job.partLabels } : {}),
    });
    const emittedFunctions = new Set(
      compiled.document.records
        .filter((record) => record.type === 'CUTS')
        .map((record) => record.functionCode),
    );
    for (const functionCode of emittedFunctions) {
      if (!route.config.allowedFunctions.includes(functionCode)) {
        reasons.push({
          code: 'OPERATION_NOT_REPRESENTABLE',
          detail: `el programa requiere FUNCTION ${functionCode}, fuera del subconjunto del perfil (${route.config.allowedFunctions.join(',')})`,
        });
      }
    }
    if (reasons.length === 0) {
      // r5 (#788/#793): bytes exist ONLY behind the strict Pattern Exchange
      // spec preflight boundary. r2/r3/r4 keep the historical unchecked
      // serializer — their bytes are frozen history expected to fail the
      // title rule (the regression fixture, not something to repair).
      bytes = r5
        ? serializePtxDocumentBytesSpecChecked(compiled.document, {
            decimalPlaces: route.config.compileOptions.decimalPlaces,
            lineEnding: route.config.lineEnding,
          })
        : serializePtxDocumentBytes(compiled.document, {
            decimalPlaces: route.config.compileOptions.decimalPlaces,
            lineEnding: route.config.lineEnding,
          });
    }
  } catch (error) {
    reasons.push(compilationBlockReason(error));
  }

  if (reasons.length > 0 || bytes === undefined) {
    throw new AdapterSerializationBlocked(reasons);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Adapter identity
// ---------------------------------------------------------------------------

/**
 * Canonical identity of the serialization behavior. Tests hash this and
 * compare against implementationDigest, so any behavior-relevant change
 * forces a new digest (and a new adapter version).
 *
 * v1.1.0: adds the revision-bound documented-PTX compiler route for
 * ptx-cadmatic-4@r2 (#650). The legacy route for other revisions is
 * unchanged and keeps its byte identity.
 * v1.2.0: routes ptx-cadmatic-4@r3 (#661) through the same compiler with the
 * evidenced positive-trim subset (supportsPositiveTrim + FUNCTION 92) and
 * forwards the flag to the compile options. r2 routing and the legacy route
 * are unchanged and keep their byte identities.
 * v1.3.0: routes ptx-cadmatic-4@r4 (#781) with the field-dialect subset —
 * OFFCUTS.OFC_QTY, OFFCUTS declared before PATTERNS/CUTS, Xn markers
 * restricted to FUNCTION 92, and PARTS_REQ.CODE as the workshop
 * manufacturing code (workshop-labelref authority, ≤50, fail-closed on
 * collisions). r2/r3 routing and the legacy route are unchanged and keep
 * their byte identities. (unpublished, same version): r4 OFFCUTS.CODE
 * serializes EMPTY per the functional field samples (R2201/R7301).
 * v1.4.0 (#793): routes ptx-cadmatic-4@r5 through the SAME documented
 * compiler with the r5 final-gate contract — TITLE GRANETE-R5-FIELD-TEST
 * (≤25), strict Pattern Exchange spec preflight on document AND bytes
 * (serializePtxDocumentBytesSpecChecked boundary), part-local pre-rotation
 * PARTS_REQ dimensions, structural PARTS_UDI, productive receiver policy
 * HPP250-CAD4-R5-CANDIDATE, and PARTS_INF/PARTS_UDI labels exclusively from
 * the neutral frozen manufacturing label projection of the release
 * (fail-closed: no projection/labels/frozen release identity ⇒ BLOCK, never
 * a fallback). r2/r3/r4 routing and the legacy route are unchanged and keep
 * their byte identities.
 */
export const PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.4.0',
  producedFormatFamily: 'ptx',
  generator: 'packages/excel/src/machines/ptxAdapter.ts@5',
  r4OffcutCode: 'empty-field-internal-region-id-not-serialized',
  r5Title: 'GRANETE-R5-FIELD-TEST',
  r5SerializationBoundary: 'strict-spec-preflight-checked-bytes-only',
  r5LabelAuthority: 'neutral-frozen-manufacturing-projection-fail-closed',
  r5ReceiverPolicy: 'HPP250-CAD4-R5-CANDIDATE',
} as const;

/**
 * Reviewable industrial contract bound to the current implementationDigest.
 * It deliberately fingerprints explicit behavior markers, effective profile
 * options and stable golden bytes — never whole source files or formatting
 * noise. Any governed change must update this record together with a new
 * adapter identity; CI compares every value against its independent source.
 * The 1.3.0 identity (granete-ptx@1.3.0 / e856f8e8…) stays recorded below as
 * immutable historical evidence — persisted selections pinned to it surface a
 * stale-adapter blocker and are never silently retargeted.
 */
export const PTX_ADAPTER_1_3_0_HISTORICAL_IDENTITY = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.3.0',
  implementationDigest: 'e856f8e88ba4deb7077ba24f4182378a8d706591bd8831affa0b45370d56584c',
} as const;

export const PTX_ADAPTER_INDUSTRIAL_CONTRACT = {
  implementationDigest: '8c13f67bfc8f1354984b90bbea1a3719b91905b62d63af570eec3d83a52a7916',
  behaviorMarkers: {
    compilerRoutes: ['ptx-cadmatic-4@r2', 'ptx-cadmatic-4@r3', 'ptx-cadmatic-4@r4', 'ptx-cadmatic-4@r5'],
    r3TrimProjection: 'fixed-frame-trim-type-1-vectors-off',
    r3ReleaseScheduling: 'phase-2-rest-remnant-function-92-before-dependent-recut',
    r4OffcutQuantity: 'ofc-qty-1-92-paired-offcuts-only',
    r4OffcutOrdering: 'offcuts-declared-before-patterns-no-forward-xn',
    r4OffcutMarkers: 'xn-references-only-on-function-92',
    r4OffcutCode: 'empty-field-internal-region-id-not-serialized',
    r4PartCodes: 'workshop-labelref-unique-per-piece-max-50-fail-closed',
    r5Title: 'granete-r5-field-test-21-chars-spec-limit-25',
    r5SpecPreflight: 'pattern-exchange-v1-document-and-serialized-bytes',
    r5PartsReqDimensions: 'part-local-pre-rotation-cut',
    r5PartsUdi: 'structural-info-cells-empty-without-authority',
    r5ReceiverPolicy: 'hpp250-cad4-r5-candidate',
    r5LabelAuthority: 'neutral-frozen-release-projection-1-1-coverage-fail-closed',
    r5CncAuthority: 'drawing-barcode1-only-with-explicit-machining-frozen-scope',
    r5LegacyFallback: 'none-block-instead',
    readback: 'parser-plus-independent-cut-program-verifier',
    legacyRoute: 'ptx-generic@r1-only',
  },
  profiles: {
    r2: {
      digest: '822221a6324199e63ec432966cfdd84b41dd8821fe09da1a3d1970e9fbae3c4a',
      goldenBytesSha256: '6f72cce42d7f2c17359275f6c64f1bf14c5145d168a12abc0f77ba23830f4baa',
    },
    r3: {
      digest: '4998b6a53e131eda776934e18a24ee7f7e55ce526cbea3b8ba74d3340cbb9537',
      goldenBytesSha256: 'f5e51ff7511960aae7eadef99a841fed9c824e4b28320ee83734db1430b2c7ee',
    },
    r4: {
      digest: '94401b8c17cd54b80e548bcc85cd184f80ba25ba97056ef6d46d81d1cb5114fc',
      goldenBytesSha256: '92209bfb8c35354a55f2289b6ab83ae22857c6ea496283ac5d7a3d6cee6df313',
    },
    r5: {
      digest: '3d3d215bf45859b6bf74ea931fc34e9d2b99e16ed346f67a33f68da482534c6b',
    },
  },
  legacyGoldenBytesSha256: '544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09',
} as const;

export const PTX_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<PtxResolvedCuttingJob> = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.4.0',
  implementationDigest: '8c13f67bfc8f1354984b90bbea1a3719b91905b62d63af570eec3d83a52a7916',
  producedFormatFamily: 'ptx',
  requiredDimensions: PTX_REQUIRED_DIMENSIONS,

  canSerialize(job: PtxResolvedCuttingJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const r5 = isCadmatic4R5(profile);
    const reasons: AdapterBlockReason[] = [
      ...checkFormatFamily(profile, 'ptx'),
      ...checkRequiredDimensions(
        profile,
        profileUsesDocumentedPtxCompiler(profile)
          ? r5
            ? [...PTX_COMPILER_REQUIRED_DIMENSIONS, ...PTX_COMPILER_R5_REQUIRED_DIMENSIONS]
            : PTX_COMPILER_REQUIRED_DIMENSIONS
          : PTX_REQUIRED_DIMENSIONS,
      ),
    ];

    if (profileUsesDocumentedPtxCompiler(profile) && reasons.length === 0) {
      const route = resolvePtxCompilerRoute(profile);
      reasons.push(...route.reasons);
      if (r5) {
        reasons.push(...r5LabelAuthorityReasons(job));
      }
      if (route.config && reasons.length === 0) {
        // Real preflight: the compiler is pure/deterministic, so running it
        // here guarantees ready=true ⇒ serialize() executes unchanged. Every
        // ptx_compile.* cause (missing program, trims, phase, thickness,
        // identity, decimals, material, labels…) surfaces as a specific
        // blocker. r5 compiles WITH its mapped partLabels — the exact
        // document serialize() will emit.
        try {
          const compiled = compileCutPlanToPtxDocument(job.cutPlan, {
            ...route.config.compileOptions,
            ...(r5 ? { partLabels: job.partLabels } : {}),
          });
          const emittedFunctions = new Set(
            compiled.document.records
              .filter((record) => record.type === 'CUTS')
              .map((record) => record.functionCode),
          );
          for (const functionCode of emittedFunctions) {
            if (!route.config.allowedFunctions.includes(functionCode)) {
              reasons.push({
                code: 'OPERATION_NOT_REPRESENTABLE',
                detail: `el programa requiere FUNCTION ${functionCode}, fuera del subconjunto del perfil (${route.config.allowedFunctions.join(',')})`,
              });
            }
          }
        } catch (error) {
          reasons.push(compilationBlockReason(error));
        }
      }
    }

    return { ready: reasons.length === 0, reasons };
  },

  serialize(job: PtxResolvedCuttingJob, profile: OutputCompatibilityProfile): Uint8Array {
    const readiness = this.canSerialize(job, profile);
    if (!readiness.ready) {
      throw new AdapterSerializationBlocked(readiness.reasons);
    }
    if (profileUsesDocumentedPtxCompiler(profile)) {
      return serializeWithDocumentedCompiler(job, profile);
    }
    const presentation = job.presentation ?? {};
    return new TextEncoder().encode(
      generatePtxString({
        cutPlan: job.cutPlan,
        projectName: presentation.projectName,
        customerName: presentation.customerName,
        projectCode: presentation.projectCode,
      }),
    );
  },
};
