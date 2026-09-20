/**
 * resolveManufacturingOutputTarget (#591): the authoritative resolver for
 * NORMAL production generation. One operation -> at most ONE configured
 * target; there is never an implicit fallback to ptx-generic or any other
 * candidate. Validation packs intentionally evaluate several profiles and
 * must NOT use this resolver.
 */

import {
  machineOutputBlockerMessageEs,
  type AdapterBlockReason,
  type CutPlan,
  type MachineOutputSelection,
  type ManufacturingLabelProjection,
  ManufacturingOperation,
  OutputCompatibilityProfile,
  ResolvedManufacturingOutputTarget,
  ValidationError,
} from '@granete/domain';
import {
  CLIENT_A_BHX050_PROFILE,
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_R5_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
  type ClientMachineProfileData,
} from './profiles';
import { PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import { SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { WOODWOP_MPR_POSTPROCESSOR_ADAPTER } from './woodWopMprAdapter';
import { ptxPartLabelsFromManufacturingProjection } from '../ptx/partLabels';
import type { PtxPartLabelData } from '../ptx/partLabels';

export const KNOWN_MACHINE_PROFILES: readonly ClientMachineProfileData[] = [
  CLIENT_A_HPP250_PROFILE,
  CLIENT_A_BHX050_PROFILE,
];

export const KNOWN_OUTPUT_PROFILES: readonly OutputCompatibilityProfile[] = [
  PTX_GENERIC_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  // r5 (#793, productive final-gate candidate: strict spec preflight +
  // frozen label authority + receiver policy) is the CURRENT selectable
  // revision of the CADmatic 4 profile. r1..r4 keep existing as immutable
  // historical constants (PTX_CADMATIC_4_R4_PROFILE stays exported for
  // history/tests), and selections pinned to them surface an actionable
  // stale-revision blocker — never an automatic retarget to r5.
  PTX_CADMATIC_4_R5_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  SAW_HOMAG_PROFILE,
  MPR_WOODWOP_PROFILE,
];

function adapterForFamily(family: string) {
  switch (family) {
    case 'ptx':
      return PTX_POSTPROCESSOR_ADAPTER;
    case 'saw':
      return SAW_POSTPROCESSOR_ADAPTER;
    case 'mpr':
      return WOODWOP_MPR_POSTPROCESSOR_ADAPTER;
    default:
      return undefined;
  }
}

/** Exact catalog resolution; historical references are displayable but never retargeted. */
function exactProfileForSelection(selection: MachineOutputSelection): OutputCompatibilityProfile | undefined {
  return KNOWN_OUTPUT_PROFILES.find(
    (profile) =>
      profile.ref.outputCompatibilityProfileId === selection.outputCompatibilityProfileId &&
      profile.ref.revisionId === selection.outputCompatibilityProfileRevisionId &&
      selection.outputCompatibilityProfileDigest !== null &&
      profile.digest === selection.outputCompatibilityProfileDigest,
  );
}

/**
 * Resolves only the persisted tuple against the current catalog. It deliberately
 * does not probe a synthetic job: operation readiness needs the real active job.
 */
export function resolveManufacturingOutputTarget(
  selection: MachineOutputSelection | undefined,
  operation: ManufacturingOperation,
): ResolvedManufacturingOutputTarget {
  if (!selection || selection.operation !== operation) {
    return { status: 'NO_OUTPUT_CONFIGURED', operation };
  }

  const currentMachine = KNOWN_MACHINE_PROFILES.find(
    (machine) => machine.ref.machineProfileId === selection.machineProfileId,
  );
  const machine = currentMachine?.ref.machineProfileRevisionId === selection.machineProfileRevisionId
    ? currentMachine
    : undefined;
  const currentProfile = KNOWN_OUTPUT_PROFILES.find(
    (profile) => profile.ref.outputCompatibilityProfileId === selection.outputCompatibilityProfileId,
  );
  const profile = exactProfileForSelection(selection);
  const adapter = profile ? adapterForFamily(profile.formatFamily) : undefined;

  const reasons: AdapterBlockReason[] = [];
  if (!currentMachine) {
    reasons.push({
      code: 'FORMAT_FAMILY_MISMATCH',
      detail: `máquina desconocida: ${selection.machineProfileId}`,
    });
  } else if (!machine) {
    reasons.push({
      code: 'PROFILE_DIGEST_MISMATCH',
      detail: `revisión de máquina ${selection.machineProfileId}@${selection.machineProfileRevisionId} ya no existe en el catálogo (${currentMachine.ref.machineProfileRevisionId})`,
    });
  }

  if (!currentProfile) {
    reasons.push({
      code: 'FORMAT_FAMILY_MISMATCH',
      detail: `perfil de salida desconocido: ${selection.outputCompatibilityProfileId}`,
    });
  } else if (!profile) {
    const selectedDigest = selection.outputCompatibilityProfileDigest ?? 'sin digest histórico';
    reasons.push({
      code: 'PROFILE_DIGEST_MISMATCH',
      detail: `perfil guardado ${selection.outputCompatibilityProfileId}@${selection.outputCompatibilityProfileRevisionId} (${selectedDigest}) no coincide con la versión vigente ${currentProfile.ref.revisionId} (${currentProfile.digest})`,
    });
  }

  if (profile && !adapter) {
    reasons.push({
      code: 'FORMAT_FAMILY_MISMATCH',
      detail: 'no hay adapter para la familia del perfil seleccionado',
    });
  } else if (
    adapter && (
      adapter.postprocessorAdapterId !== selection.postprocessorAdapterId ||
      adapter.adapterVersion !== selection.postprocessorAdapterVersion ||
      adapter.implementationDigest !== selection.postprocessorImplementationDigest
    )
  ) {
    reasons.push({
      code: 'PROFILE_DIGEST_MISMATCH',
      detail: `el adapter guardado (${selection.postprocessorAdapterId}@${selection.postprocessorAdapterVersion}) no coincide con el implementado (${adapter.postprocessorAdapterId}@${adapter.adapterVersion})`,
    });
  }

  const adapterExact = adapter &&
    adapter.postprocessorAdapterId === selection.postprocessorAdapterId &&
    adapter.adapterVersion === selection.postprocessorAdapterVersion &&
    adapter.implementationDigest === selection.postprocessorImplementationDigest
      ? adapter
      : undefined;

  // Catalog-level evidence remains part of configuration readiness and does
  // not need a synthetic job. The active CutPlan preflight below adds the
  // operation-specific compiler blockers for cutting.
  if (operation === 'cutting' && adapterExact && profile && reasons.length === 0) {
    for (const dimension of adapterExact.requiredDimensions) {
      if (profile.dimensions[dimension] === undefined) {
        reasons.push({
          code: 'FIELD_FORMAT_EVIDENCE_REQUIRED',
          dimension,
          detail: `dimension '${dimension}' of profile ${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId} has no field/repo evidence`,
        });
      }
    }
  }

  // Machining keeps its existing implementation-level blocker without
  // pretending this says anything about a cutting plan. Cutting readiness is
  // exclusively evaluated by evaluateSelectedCuttingOutputReadiness below.
  if (operation === 'machining' && adapterExact && reasons.length === 0) {
    reasons.push(...adapterExact.canSerialize({
      jobId: 'settings-readiness',
      provenance: { projectId: 'settings-readiness', generatedAt: '1970-01-01T00:00:00.000Z' },
      drilling: {
        schema: 'muebles.drilling-data.v1',
        projectId: 'settings-readiness',
        projectName: 'settings-readiness',
        generatedAt: '1970-01-01T00:00:00.000Z',
        totalPiecesCount: 0,
        totalHolesCount: 0,
        patterns: [],
      },
    } as never, profile!).reasons);
  }

  return {
    status: 'CONFIGURED',
    operation,
    selection,
    machineLabel: machine
      ? `${machine.identity.manufacturerFamily} ${machine.identity.model}`
      : `${selection.machineProfileId}@${selection.machineProfileRevisionId}`,
    profileLabel: profile
      ? `${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`
      : `${selection.outputCompatibilityProfileId}@${selection.outputCompatibilityProfileRevisionId}`,
    adapterLabel: adapterExact
      ? `${adapterExact.postprocessorAdapterId} · ${adapterExact.adapterVersion}`
      : `${selection.postprocessorAdapterId} · ${selection.postprocessorAdapterVersion}`,
    supportStatus: profile?.supportStatus ?? 'NOT_TESTED',
    readiness: { ready: reasons.length === 0, reasons },
  };
}

/** Readiness for cutting is evaluated against the exact active CutPlan. */
export function evaluateSelectedCuttingOutputReadiness(
  cutPlan: CutPlan,
  selection: MachineOutputSelection | undefined,
): ResolvedManufacturingOutputTarget {
  const resolved = resolveManufacturingOutputTarget(selection, 'cutting');
  if (resolved.status !== 'CONFIGURED' || !resolved.readiness.ready || !selection) {
    return resolved;
  }
  const profile = exactProfileForSelection(selection);
  const adapter = profile ? adapterForFamily(profile.formatFamily) : undefined;
  if (!profile || !adapter) return resolved;
  const readiness = adapter.canSerialize({
    jobId: cutPlan.id,
    provenance: {
      projectId: cutPlan.projectId,
      generatedAt: cutPlan.generatedAt,
      cutPlanId: cutPlan.id,
      cutPlanVersion: cutPlan.version,
    },
    cutPlan,
  } as never, profile);
  return { ...resolved, readiness };
}

import { generateMachineArtifact, type MachineArtifactBundle } from './machineArtifacts';
import {
  cutFileToken,
  cutPlanForMaterialGroup,
  groupCutPlanSheetsByMaterial,
  uniqueCutFileName,
} from '../ptxCutPlanExport';
import { sha256Hex } from './digest';

/**
 * #781 r4 — conservative industrial file name for the CADmatic 4 lane:
 * ASCII-only, no spaces/accents, ≤ 20 chars, deterministic and
 * collision-safe (48-bit hash of the exact CutPlan identity — id AND
 * version, so a regenerated plan never keeps a stale filename; birthday
 * bound stays negligible for realistic plan volumes). Unified artifacts get
 * `G<hex12>.ptx`; by-material adds a 1-based group index. The descriptive
 * provenance (project name, plan identity) stays in the artifact manifest —
 * the industrial file name is a lane label, not the label of the work.
 */
async function industrialArtifactFileName(
  cutPlanId: string,
  cutPlanVersion: number,
  extension: string,
  groupIndex?: number,
): Promise<string> {
  const token = (
    await sha256Hex(`granete:ptx-artifact:${cutPlanId}:v${cutPlanVersion}`)
  )
    .slice(0, 12)
    .toUpperCase();
  return groupIndex === undefined
    ? `G${token}.${extension}`
    : `G${token}-${groupIndex}.${extension}`;
}

export type CuttingOutputMode = 'unified' | 'by-material';

/** #793 — productive frozen label authority carried into the resolved job. */
export interface SelectedCuttingOutputLabelOptions {
  /**
   * Neutral frozen per-piece manufacturing projection of the release the
   * plan was generated from (`manufacturingLabelProjectionFromDemand`).
   * Required for r5 (missing ⇒ BLOCK); ignored by revisions without label
   * semantics (their byte identities are frozen).
   */
  readonly manufacturingLabels?: ManufacturingLabelProjection;
}

/**
 * Normal-production cutting generation through the EXACT selected target
 * (#591). 'unified' produces exactly ONE artifact; 'by-material' produces one
 * artifact per material group (same grouping key as the generic per-material
 * PTX export). When the target is blocked it throws with the typed reasons —
 * it never falls back to another profile and never bulk-generates candidates.
 * NO_OUTPUT_CONFIGURED also throws: the legacy unconfigured flow is decided by
 * the caller, not silently here.
 *
 * #793: when the caller supplies the frozen manufacturing label projection
 * (release flow with a verified demand), the resolved job carries it plus its
 * mapped partLabels — the r5 route consumes them and fails closed otherwise.
 */
export async function generateSelectedCuttingOutput(
  cutPlan: CutPlan,
  selection: MachineOutputSelection,
  mode: CuttingOutputMode = 'unified',
  options?: SelectedCuttingOutputLabelOptions,
): Promise<readonly MachineArtifactBundle[]> {
  const resolved = evaluateSelectedCuttingOutputReadiness(cutPlan, selection);
  if (resolved.status !== 'CONFIGURED') {
    throw new ValidationError('no hay salida de máquina configurada para corte', {
      status: 'NO_OUTPUT_CONFIGURED',
    });
  }
  // Catalog-level gate (identity/dimension blockers) always applies — a
  // stale or unknown tuple throws its typed reasons here, never falls back
  // and never dereferences a profile the exact selection cannot resolve.
  const catalogResolved = resolveManufacturingOutputTarget(selection, 'cutting');
  if (catalogResolved.status !== 'CONFIGURED' || !catalogResolved.readiness.ready) {
    const reasons =
      catalogResolved.status === 'CONFIGURED' ? catalogResolved.readiness.reasons : [];
    throw new ValidationError(
      machineOutputBlockerMessageEs(
        reasons.length > 0
          ? reasons
          : [{ code: 'FORMAT_FAMILY_MISMATCH', detail: 'salida de máquina no configurada' }],
      ),
      { status: 'BLOCKED', reasons },
    );
  }
  // Without the label option the bare job-level readiness is the final gate
  // (r5 blocks here on its label authority). With the option, the labeled
  // job below re-runs the EXACT gate that will govern serialization.
  if (options?.manufacturingLabels === undefined && !resolved.readiness.ready) {
    throw new ValidationError(machineOutputBlockerMessageEs(resolved.readiness.reasons), {
      status: 'BLOCKED',
      reasons: resolved.readiness.reasons,
    });
  }
  const profile = exactProfileForSelection(selection)!;
  const adapter = adapterForFamily(profile.formatFamily)!;
  const kind = profile.formatFamily === 'ptx' ? ('ptx' as const) : ('saw' as const);
  const extension = String(profile.dimensions.fileExtension ?? 'pending');
  // #781 r4 / #793 r5: the CADmatic 4 industrial lanes use the conservative
  // short ASCII industrial file name; every other revision keeps the human
  // name.
  const useIndustrialNaming =
    profile.ref.outputCompatibilityProfileId === 'ptx-cadmatic-4' &&
    (profile.ref.revisionId === 'r4' || profile.ref.revisionId === 'r5');

  // #793 — map the frozen neutral projection to the PTX label data ONCE (the
  // mapper is the only sanctioned producer; its fail-closed gates surface
  // here as actionable errors before any artifact exists).
  const partLabels: readonly PtxPartLabelData[] | undefined = options?.manufacturingLabels
    ? await ptxPartLabelsFromManufacturingProjection(options.manufacturingLabels)
    : undefined;
  const manufacturingLabels = options?.manufacturingLabels;

  /** Projects the label authority onto one plan's placed pieces (by-material groups carry their subset). */
  const labelsForPlan = (
    plan: CutPlan,
  ): { manufacturingLabels?: ManufacturingLabelProjection; partLabels?: readonly PtxPartLabelData[] } => {
    if (manufacturingLabels === undefined || partLabels === undefined) return {};
    const placedCodes = new Set(plan.sheets.flatMap((sheet) => sheet.pieces.map((piece) => piece.labelRef)));
    if (placedCodes.size === 0) return {};
    const pieces = manufacturingLabels.pieces.filter((piece) =>
      placedCodes.has(piece.manufacturingPartCode),
    );
    const labels = partLabels.filter((label) => placedCodes.has(label.manufacturingPartCode));
    if (pieces.length === 0 || labels.length === 0) {
      // A group the projection does not cover at all is a hard mismatch —
      // never an unlabeled r5 artifact.
      throw new ValidationError(
        'la proyección de etiquetas congelada no cubre las piezas de este plan; regenerá el plan desde la liberación de la proyección',
        { status: 'BLOCKED' },
      );
    }
    return {
      manufacturingLabels: { ...manufacturingLabels, pieces },
      partLabels: labels,
    };
  };

  const buildBundle = (
    plan: CutPlan,
    jobId: string,
    fileName: string,
    delivery: MachineArtifactBundle['manifest']['delivery'],
  ): Promise<MachineArtifactBundle> => {
    const labels = labelsForPlan(plan);
    return generateMachineArtifact({
      job: {
        jobId,
        provenance: {
          projectId: cutPlan.projectId,
          generatedAt: cutPlan.generatedAt,
          cutPlanId: cutPlan.id,
          cutPlanVersion: cutPlan.version,
          // #739 — a plan generated from the frozen release demand carries
          // its exact liberation pins and manufacturing fingerprint into the
          // artifact manifest (never reported as missing provenance).
          ...(cutPlan.releaseBase
            ? {
                productionReleaseId: cutPlan.releaseBase.releaseId,
                designRevisionId: cutPlan.releaseBase.designRevisionId,
                bomFingerprint: cutPlan.releaseBase.manufacturingFingerprint,
              }
            : {}),
        },
        cutPlan: plan,
        presentation: {
          projectName: cutPlan.projectName ?? cutPlan.projectId,
          projectCode: cutPlan.projectId,
        },
        ...(labels.manufacturingLabels !== undefined
          ? { manufacturingLabels: labels.manufacturingLabels }
          : {}),
        ...(labels.partLabels !== undefined ? { partLabels: labels.partLabels } : {}),
      },
      adapter: adapter as typeof PTX_POSTPROCESSOR_ADAPTER,
      profile,
      kind,
      schemaVersion: String(profile.dimensions.headerVersion ?? 'pending-evidence'),
      fileName,
      delivery,
      machineProfile: {
        ref: KNOWN_MACHINE_PROFILES.find(
          (m) =>
            m.ref.machineProfileId === selection.machineProfileId &&
            m.ref.machineProfileRevisionId === selection.machineProfileRevisionId,
        )!.ref,
        supported: [],
      },
    });
  };

  // #793 — the bare-plan readiness above cannot see the label authority, so
  // the r5 job-level gate re-runs here on the EXACT labeled job that will be
  // serialized (deterministic: generateMachineArtifact reaches the same
  // verdict).
  if (manufacturingLabels !== undefined && profile.formatFamily === 'ptx') {
    const readiness = adapter.canSerialize(
      {
        jobId: cutPlan.id,
        provenance: {
          projectId: cutPlan.projectId,
          generatedAt: cutPlan.generatedAt,
          cutPlanId: cutPlan.id,
          cutPlanVersion: cutPlan.version,
        },
        cutPlan,
        ...labelsForPlan(cutPlan),
      } as never,
      profile,
    );
    if (!readiness.ready) {
      throw new ValidationError(machineOutputBlockerMessageEs(readiness.reasons), {
        status: 'BLOCKED',
        reasons: readiness.reasons,
      });
    }
  }

  if (mode === 'by-material') {
    const groups = groupCutPlanSheetsByMaterial(cutPlan);
    if (groups.length > 0) {
      const bundles: MachineArtifactBundle[] = [];
      // Human file names ('corte-mdf-blanco-18mm.ptx'): readable material
      // name first, technical code only as fallback; sanitization collisions
      // get a deterministic '-2' suffix instead of overwriting each other.
      // r4 (#781) switches to the short industrial name with a 1-based group
      // index (unique by construction, so no collision guard is needed).
      const usedFileNames = new Set<string>();
      let industrialGroupIndex = 0;
      for (const group of groups) {
        industrialGroupIndex += 1;
        const fileName = useIndustrialNaming
          ? await industrialArtifactFileName(cutPlan.id, cutPlan.version, extension, industrialGroupIndex)
          : uniqueCutFileName(
              cutFileToken(group.materialName || group.materialCode),
              extension,
              usedFileNames,
            );
        bundles.push(
          await buildBundle(
            cutPlanForMaterialGroup(cutPlan, group),
            `${cutPlan.id}--${group.materialCode}`,
            fileName,
            {
              mode: 'by-material',
              material: { code: group.materialCode, name: group.materialName },
            },
          ),
        );
      }
      return bundles;
    }
    // No sheets to group — degenerate plan still exports as one artifact.
  }

  return [
    await buildBundle(
      cutPlan,
      cutPlan.id,
      useIndustrialNaming
        ? await industrialArtifactFileName(cutPlan.id, cutPlan.version, extension)
        : `corte-${cutFileToken(cutPlan.projectName || cutPlan.projectId)}.${extension}`,
      { mode: 'unified' },
    ),
  ];
}

export { machineOutputBlockerMessageEs } from '@granete/domain';
