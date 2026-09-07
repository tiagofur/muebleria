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
  PTX_CADMATIC_4_PROFILE,
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
  PTX_CADMATIC_4_PROFILE,
  PTX_CADMATIC_5_PROFILE,
  SAW_HOMAG_PROFILE,
  MPR_WOODWOP_PROFILE,
];

/** Cutting-format families per shared catalog (parity fixture in contracts/). */
const OPERATION_FORMAT_FAMILIES: Record<ManufacturingOperation, readonly string[]> = {
  cutting: ['ptx', 'saw'],
  machining: ['mpr'],
};

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

/**
 * Resolves the configured target. Unknown/stale references surface as typed
 * blockers (they can happen when the catalog evolves after a selection was
 * saved); the resolver NEVER substitutes another profile.
 */
export function resolveManufacturingOutputTarget(
  selection: MachineOutputSelection | undefined,
  operation: ManufacturingOperation,
): ResolvedManufacturingOutputTarget {
  if (!selection || selection.operation !== operation) {
    return { status: 'NO_OUTPUT_CONFIGURED', operation };
  }

  const machine = KNOWN_MACHINE_PROFILES.find(
    (m) => m.ref.machineProfileId === selection.machineProfileId,
  );
  const profile = KNOWN_OUTPUT_PROFILES.find(
    (p) => p.ref.outputCompatibilityProfileId === selection.outputCompatibilityProfileId,
  );

  const reasons: AdapterBlockReason[] = [];
  if (!machine) {
    reasons.push({
      code: 'FORMAT_FAMILY_MISMATCH',
      detail: `máquina desconocida: ${selection.machineProfileId}`,
    });
  } else if (machine.ref.machineProfileRevisionId !== selection.machineProfileRevisionId) {
    reasons.push({
      code: 'PROFILE_DIGEST_MISMATCH',
      detail: `revisión de máquina ${selection.machineProfileId}@${selection.machineProfileRevisionId} ya no existe en el catálogo (${machine.ref.machineProfileRevisionId})`,
    });
  }
  if (!profile) {
    reasons.push({
      code: 'FORMAT_FAMILY_MISMATCH',
      detail: `perfil de salida desconocido: ${selection.outputCompatibilityProfileId}`,
    });
  } else if (profile.ref.revisionId !== selection.outputCompatibilityProfileRevisionId) {
    reasons.push({
      code: 'PROFILE_DIGEST_MISMATCH',
      detail: `revisión de perfil ${selection.outputCompatibilityProfileId}@${selection.outputCompatibilityProfileRevisionId} ya no existe en el catálogo (${profile.ref.revisionId})`,
    });
  }

  const family = profile?.formatFamily;
  const adapter = family ? adapterForFamily(family) : undefined;
  if (!adapter) {
    reasons.push({
      code: 'FORMAT_FAMILY_MISMATCH',
      detail: 'no hay adapter para la familia del perfil seleccionado',
    });
  } else if (
    adapter.postprocessorAdapterId !== selection.postprocessorAdapterId ||
    adapter.adapterVersion !== selection.postprocessorAdapterVersion ||
    adapter.implementationDigest !== selection.postprocessorImplementationDigest
  ) {
    reasons.push({
      code: 'PROFILE_DIGEST_MISMATCH',
      detail: `el adapter seleccionado (${selection.postprocessorAdapterId}@${selection.postprocessorAdapterVersion}) no coincide con el implementado (${adapter.postprocessorAdapterId}@${adapter.adapterVersion})`,
    });
  }

  // Adapter readiness (evidence + representability + implementation) — computed
  // against a neutral machining/cutting job shape when the family requires one.
  if (adapter && profile && machine && reasons.length === 0) {
    const placeholderJob =
      operation === 'cutting'
        ? { jobId: 'readiness-probe', provenance: emptyProvenance(), cutPlan: emptyCutPlan() }
        : { jobId: 'readiness-probe', provenance: emptyProvenance(), drilling: emptyDrilling() };
    reasons.push(...adapter.canSerialize(placeholderJob as never, profile).reasons);
  }

  return {
    status: 'CONFIGURED',
    operation,
    selection,
    machineLabel: machine ? `${machine.identity.manufacturerFamily} ${machine.identity.model}` : selection.machineProfileId,
    profileLabel: profile
      ? `${profile.ref.outputCompatibilityProfileId}@${profile.ref.revisionId}`
      : selection.outputCompatibilityProfileId,
    adapterLabel: adapter
      ? `${adapter.postprocessorAdapterId} · ${adapter.adapterVersion}`
      : selection.postprocessorAdapterId,
    supportStatus: profile?.supportStatus ?? 'NOT_TESTED',
    readiness: { ready: reasons.length === 0, reasons },
  };
}

function emptyProvenance() {
  return { projectId: 'readiness-probe', generatedAt: '1970-01-01T00:00:00.000Z' };
}

function emptyCutPlan() {
  // Minimal shape for readiness probing: canSerialize only inspects
  // dimensions/profiles (and machining operations), never plan contents.
  return {
    id: 'probe',
    projectId: 'readiness-probe',
    generatedAt: '1970-01-01T00:00:00.000Z',
    version: 1,
    isFrozen: true,
    config: {
      sawKerfMm: 4.4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 400,
      minRemnantLengthMm: 600,
      preferLongitudinalRips: true,
    },
    sheets: [],
    stats: {
      totalSheets: 0,
      totalPieces: 0,
      totalGrossAreaM2: 0,
      totalNetPiecesAreaM2: 0,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 0,
      globalWastePercent: 0,
      globalYieldPercent: 0,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

function emptyDrilling() {
  return {
    schema: 'muebles.drilling-data.v1' as const,
    projectId: 'readiness-probe',
    projectName: 'readiness-probe',
    generatedAt: '1970-01-01T00:00:00.000Z',
    totalPiecesCount: 0,
    totalHolesCount: 0,
    patterns: [],
  };
}

import type { CutPlan } from '@granete/domain';
import { generateMachineArtifact, type MachineArtifactBundle } from './machineArtifacts';
import {
  cutPlanForMaterialGroup,
  groupCutPlanSheetsByMaterial,
  sanitizeFileNameToken,
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
  const resolved = resolveManufacturingOutputTarget(selection, 'cutting');
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
  const profile = KNOWN_OUTPUT_PROFILES.find(
    (p) => p.ref.outputCompatibilityProfileId === selection.outputCompatibilityProfileId,
  )!;
  const adapter = adapterForFamily(profile.formatFamily)!;
  const kind = profile.formatFamily === 'ptx' ? ('ptx' as const) : ('saw' as const);
  const extension = profile.dimensions.fileExtension ?? 'pending';

  const buildBundle = (
    plan: CutPlan,
    jobId: string,
    fileName: string,
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
      machineProfile: {
        ref: KNOWN_MACHINE_PROFILES.find(
          (m) => m.ref.machineProfileId === selection.machineProfileId,
        )!.ref,
        supported: [],
      },
    });

  if (mode === 'by-material') {
    const groups = groupCutPlanSheetsByMaterial(cutPlan);
    if (groups.length > 0) {
      const bundles: MachineArtifactBundle[] = [];
      for (const group of groups) {
        const safeMat = sanitizeFileNameToken(
          group.materialCode !== 'DEFAULT' ? group.materialCode : group.materialName,
        );
        bundles.push(
          await buildBundle(
            cutPlanForMaterialGroup(cutPlan, group),
            `${cutPlan.id}--${safeMat}`,
            `corte-${cutPlan.projectId}-${safeMat}.${extension}`,
          ),
        );
      }
      return bundles;
    }
    // No sheets to group — degenerate plan still exports as one artifact.
  }

  return [
    await buildBundle(cutPlan, cutPlan.id, `corte-${cutPlan.projectId}.${extension}`),
  ];
}

export { machineOutputBlockerMessageEs } from '@granete/domain';
