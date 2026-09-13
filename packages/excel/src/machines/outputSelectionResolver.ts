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
  MachineOutputSelection,
  ManufacturingOperation,
  OutputCompatibilityProfile,
  ResolvedManufacturingOutputTarget,
} from '@granete/domain';
import {
  CLIENT_A_BHX050_PROFILE,
  CLIENT_A_HPP250_PROFILE,
  MPR_WOODWOP_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  PTX_CADMATIC_4_R3_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  PTX_GENERIC_PROFILE,
  SAW_HOMAG_PROFILE,
  type ClientMachineProfileData,
} from './profiles';
import { PTX_POSTPROCESSOR_ADAPTER } from './ptxAdapter';
import { SAW_POSTPROCESSOR_ADAPTER } from './sawAdapter';
import { WOODWOP_MPR_POSTPROCESSOR_ADAPTER } from './woodWopMprAdapter';

export const KNOWN_MACHINE_PROFILES: readonly ClientMachineProfileData[] = [
  CLIENT_A_HPP250_PROFILE,
  CLIENT_A_BHX050_PROFILE,
];

export const KNOWN_OUTPUT_PROFILES: readonly OutputCompatibilityProfile[] = [
  PTX_GENERIC_PROFILE,
  PTX_CADMATIC_3_PROFILE,
  // r3 (#661, evidenced positive-trim subset) is the CURRENT selectable
  // revision of the CADmatic 4 profile. r1/r2 keep existing as immutable
  // historical constants, and selections pinned to them surface an
  // actionable stale-revision blocker — never an automatic retarget.
  PTX_CADMATIC_4_R3_PROFILE,
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
import { ValidationError } from '@granete/domain';

export type CuttingOutputMode = 'unified' | 'by-material';

/**
 * Normal-production cutting generation through the EXACT selected target
 * (#591). 'unified' produces exactly ONE artifact; 'by-material' produces one
 * artifact per material group (same grouping key as the generic per-material
 * PTX export). When the target is blocked it throws with the typed reasons —
 * it never falls back to another profile and never bulk-generates candidates.
 * NO_OUTPUT_CONFIGURED also throws: the legacy unconfigured flow is decided by
 * the caller, not silently here.
 */
export async function generateSelectedCuttingOutput(
  cutPlan: CutPlan,
  selection: MachineOutputSelection,
  mode: CuttingOutputMode = 'unified',
): Promise<readonly MachineArtifactBundle[]> {
  const resolved = evaluateSelectedCuttingOutputReadiness(cutPlan, selection);
  if (resolved.status !== 'CONFIGURED') {
    throw new ValidationError('no hay salida de máquina configurada para corte', {
      status: 'NO_OUTPUT_CONFIGURED',
    });
  }
  if (!resolved.readiness.ready) {
    throw new ValidationError(machineOutputBlockerMessageEs(resolved.readiness.reasons), {
      status: 'BLOCKED',
      reasons: resolved.readiness.reasons,
    });
  }
  const profile = exactProfileForSelection(selection)!;
  const adapter = adapterForFamily(profile.formatFamily)!;
  const kind = profile.formatFamily === 'ptx' ? ('ptx' as const) : ('saw' as const);
  const extension = String(profile.dimensions.fileExtension ?? 'pending');

  const buildBundle = (
    plan: CutPlan,
    jobId: string,
    fileName: string,
    delivery: MachineArtifactBundle['manifest']['delivery'],
  ): Promise<MachineArtifactBundle> =>
    generateMachineArtifact({
      job: {
        jobId,
        provenance: {
          projectId: cutPlan.projectId,
          generatedAt: cutPlan.generatedAt,
          cutPlanId: cutPlan.id,
          cutPlanVersion: cutPlan.version,
        },
        cutPlan: plan,
        presentation: {
          projectName: cutPlan.projectName ?? cutPlan.projectId,
          projectCode: cutPlan.projectId,
        },
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

  if (mode === 'by-material') {
    const groups = groupCutPlanSheetsByMaterial(cutPlan);
    if (groups.length > 0) {
      const bundles: MachineArtifactBundle[] = [];
      // Human file names ('corte-mdf-blanco-18mm.ptx'): readable material
      // name first, technical code only as fallback; sanitization collisions
      // get a deterministic '-2' suffix instead of overwriting each other.
      const usedFileNames = new Set<string>();
      for (const group of groups) {
        const fileName = uniqueCutFileName(
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
      `corte-${cutFileToken(cutPlan.projectName || cutPlan.projectId)}.${extension}`,
      { mode: 'unified' },
    ),
  ];
}

export { machineOutputBlockerMessageEs } from '@granete/domain';
