/**
 * PTX postprocessor adapter (#351 foundation, #650 CADmatic 4 candidate route).
 *
 * Two serialization routes, selected by EXACT profile revision — never by
 * name/metadata guessing:
 *
 * - `ptx-cadmatic-4@r2` (PTX_CADMATIC_4_CANDIDATE_PROFILE): the documented
 *   PTX compiler of #650/#657 — CutPlan/CutProgram → compileCutPlanToPtxDocument
 *   → validate → serializePtxDocumentBytes. Every effective option declared by
 *   the profile (headerVersion, headerOrigin, trimType, decimalPlaces,
 *   encoding, lineEnding, includeVectors, supportedFunctions,
 *   supportsPositiveTrim) is consumed by this route; an option value the
 *   implementation does not support blocks with a specific reason instead of
 *   being ignored. canSerialize runs the REAL compilation preflight (the
 *   compiler is pure and deterministic), so every ptx_compile.* failure
 *   (missing/stale program, cnc-nesting, positive trims, phase > 3, missing
 *   thickness, non-ASCII identity, non-representable decimals, unresolved
 *   material…) surfaces as an actionable blocker BEFORE any bytes exist, and
 *   `ready === true` guarantees serialize() executes for the same input.
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
  type AdapterBlockReason,
  type AdapterReadiness,
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
import { PtxDocumentInvalidError } from '../ptx/validate';
import { serializePtxDocumentBytes } from '../ptx/serialize';
import { PTX_COMPILER_REQUIRED_DIMENSIONS, PTX_REQUIRED_DIMENSIONS } from './profiles';

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

/** Exact profile revisions routed to the documented PTX compiler (#650). */
export function profileUsesDocumentedPtxCompiler(profile: OutputCompatibilityProfile): boolean {
  return (
    profile.ref.outputCompatibilityProfileId === 'ptx-cadmatic-4' &&
    profile.ref.revisionId === 'r2'
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
  const missing = checkRequiredDimensions(profile, PTX_COMPILER_REQUIRED_DIMENSIONS);
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
  if (dims.supportsPositiveTrim !== false) {
    unsupported('supportsPositiveTrim=true no implementado: los códigos 90..99 siguen deshabilitados y el compilador rechaza refilados positivos');
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

  if (reasons.length > 0 || lineEnding === undefined || typeof decimalPlaces !== 'number') {
    return { reasons };
  }

  return {
    config: {
      compileOptions: {
        headerVersion,
        headerOrigin: headerOrigin as number,
        trimType: trimType as 0 | 1,
        title: PTX_CANDIDATE_TITLE,
        decimalPlaces: decimalPlaces as number,
        includeVectors: (includeVectors as boolean) === true ? true : undefined,
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
      code: 'OPERATION_NOT_REPRESENTABLE',
      detail: `${error.code}: ${error.message}`,
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

/** Compiles + validates + serializes through the documented route; throws AdapterSerializationBlocked on any blocker. */
function serializeWithDocumentedCompiler(
  job: ResolvedCuttingJob,
  profile: OutputCompatibilityProfile,
): Uint8Array {
  const route = resolvePtxCompilerRoute(profile);
  const reasons: AdapterBlockReason[] = [...route.reasons];
  let bytes: Uint8Array | undefined;

  if (!route.config) {
    throw new AdapterSerializationBlocked(reasons);
  }

  try {
    const compiled = compileCutPlanToPtxDocument(job.cutPlan, route.config.compileOptions);
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
      bytes = serializePtxDocumentBytes(compiled.document, {
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
 */
export const PTX_ADAPTER_IMPLEMENTATION_DESCRIPTOR = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.1.0',
  producedFormatFamily: 'ptx',
  generator: 'packages/excel/src/machines/ptxAdapter.ts@2',
} as const;

export const PTX_POSTPROCESSOR_ADAPTER: PostprocessorAdapter<ResolvedCuttingJob> = {
  postprocessorAdapterId: 'granete-ptx',
  adapterVersion: '1.1.0',
  implementationDigest: 'b56de3839ac9a0da94aa9c90b62d56cad19aefea27d365ff934cac46c1f70d8b',
  producedFormatFamily: 'ptx',
  requiredDimensions: PTX_REQUIRED_DIMENSIONS,

  canSerialize(job: ResolvedCuttingJob, profile: OutputCompatibilityProfile): AdapterReadiness {
    const reasons: AdapterBlockReason[] = [
      ...checkFormatFamily(profile, 'ptx'),
      ...checkRequiredDimensions(
        profile,
        profileUsesDocumentedPtxCompiler(profile)
          ? PTX_COMPILER_REQUIRED_DIMENSIONS
          : PTX_REQUIRED_DIMENSIONS,
      ),
    ];

    if (profileUsesDocumentedPtxCompiler(profile) && reasons.length === 0) {
      const route = resolvePtxCompilerRoute(profile);
      reasons.push(...route.reasons);
      if (route.config) {
        // Real preflight: the compiler is pure/deterministic, so running it
        // here guarantees ready=true ⇒ serialize() executes unchanged. Every
        // ptx_compile.* cause (missing program, trims, phase, thickness,
        // identity, decimals, material…) surfaces as a specific blocker.
        try {
          const compiled = compileCutPlanToPtxDocument(job.cutPlan, route.config.compileOptions);
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

  serialize(job: ResolvedCuttingJob, profile: OutputCompatibilityProfile): Uint8Array {
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
