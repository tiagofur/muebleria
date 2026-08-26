/**
 * Pure view selectors for the quality panel (OC-060..OC-062). The shell
 * hands the project + quality job; React renders the already-resolved
 * open issues, rework costing and per-unit QC gates.
 */

import {
  evaluateUnitQcGate,
  openQualityIssues,
  QC_CHECK_LABELS_ES,
  reworkCostSummary,
  type ModuleUnitExecution,
  type Project,
  type QcCheckCode,
  type QualityIssue,
  type UnitQcGateResult,
} from '@granete/domain';

export interface QualityUnitGateView {
  readonly unitId: string;
  readonly unitIndex: number;
  readonly status: ModuleUnitExecution['status'];
  readonly gate: UnitQcGateResult;
  readonly hasRecord: boolean;
  readonly overridden: boolean;
}

export interface QualityPanelView {
  readonly projectId: string;
  readonly openIssues: readonly QualityIssue[];
  readonly resolvedIssues: readonly QualityIssue[];
  readonly reworkCost: { readonly materialCost: number; readonly laborMinutes: number };
  readonly unitGates: readonly QualityUnitGateView[];
  readonly qcChecklist: readonly { readonly code: QcCheckCode; readonly label: string }[];
  /** partInstanceId → partCode (labels humanos, nunca ids crudos). */
  readonly partLabelByInstance: Readonly<Record<string, string>>;
  /** Piezas de la obra como opciones seleccionables (OC-061 rework). */
  readonly partOptions: readonly { readonly id: string; readonly label: string }[];
}

/**
 * Resolved quality view for one project. Unit gates cover the units sitting
 * at module_qc (about to be packaged) and packaged (already through the gate).
 */
export function qualityPanelView(project: Project): QualityPanelView {
  const quality = project.quality;
  const open = openQualityIssues(quality);
  const resolved = (quality?.issues ?? []).filter(
    (issue) => issue.status !== 'open',
  );
  const units = project.moduleUnits ?? [];
  const unitGates: QualityUnitGateView[] = units
    .filter((u) => u.status === 'module_qc' || u.status === 'packaged')
    .map((unit) => ({
      unitId: unit.id,
      unitIndex: unit.unitIndex,
      status: unit.status,
      gate: evaluateUnitQcGate(unit, quality),
      hasRecord: (quality?.unitQc ?? []).some((r) => r.unitId === unit.id),
      overridden: (quality?.unitQc ?? []).some(
        (r) => r.unitId === unit.id && Boolean(r.override),
      ),
    }));
  const partLabelByInstance: Record<string, string> = {};
  const partOptions: { id: string; label: string }[] = [];
  for (const part of project.partInstances ?? []) {
    partLabelByInstance[part.id] = part.partCode;
    partOptions.push({
      id: part.id,
      label: `${part.partCode} · U${part.unitIndex}${part.description ? ` · ${part.description}` : ''}`,
    });
  }
  return {
    projectId: project.id,
    openIssues: open,
    resolvedIssues: resolved,
    reworkCost: reworkCostSummary(quality),
    unitGates,
    qcChecklist: (Object.keys(QC_CHECK_LABELS_ES) as readonly QcCheckCode[]).map((code) => ({
      code,
      label: QC_CHECK_LABELS_ES[code],
    })),
    partLabelByInstance,
    partOptions,
  };
}
