/**
 * Fabrication flow projection (#768).
 *
 * READ-ONLY view for the compact "Preparación para fabricar" stepper the
 * operational surfaces (Ingeniería / Producción) render. It is NOT a
 * lifecycle: every step is derived EXCLUSIVELY from existing authorities —
 * `releaseAuthorityOf` (a canonical release only exists from an accepted
 * quote and an approved design revision, server-enforced at creation), the
 * durable per-release Engineering state (#740), material evidence correlated
 * with the exact release (#738), and materialized physical executions
 * (#577/#741). No writer consumes this projection; the server keeps
 * enforcing every command regardless of what it shows.
 *
 * `Project.status` is deliberately NOT an input: the legacy commercial
 * stamp never demonstrates a fabrication step (draft obras with a canonical
 * release show the real flow; `produced` stamps prove nothing here).
 */

import type { Project } from './types';
import {
  materialEvidenceCorrelatesWithRelease,
} from './processStage';
import { releaseAuthorityOf } from './releaseAuthority';

/** Steps of the compact preparation flow, in demo vocabulary. */
export type FabricationFlowStepId =
  | 'design'
  | 'release'
  | 'engineering'
  | 'materials'
  | 'production';

/**
 * `done` = demonstrated by evidence; `current` = the step the obra is on
 * now (first non-done step); `pending` = nothing to show yet; `unconfirmed`
 * = the surface could not read the authority that would demonstrate it
 * (honest "Pendiente de confirmar", never inferred).
 */
export type FabricationStepStatus = 'done' | 'current' | 'pending' | 'unconfirmed';

export interface FabricationFlowStep {
  readonly id: FabricationFlowStepId;
  readonly status: FabricationStepStatus;
  /** Spanish label of the step (includes its demonstrated state). */
  readonly label: string;
  /**
   * Demonstrated state of the step in the existing product vocabulary
   * (e.g. "En proceso", "Completa"); null when the label already carries it.
   */
  readonly stateLabel: string | null;
  /** Secondary detail (dates, actors, release pins) — never the main copy. */
  readonly detail: string | null;
}

/**
 * The single next step the operator can act on. `null` when no safe next
 * action exists (ready-for-production, already producing, or the state is
 * unconfirmed). The SURFACE decides what the action does (command in
 * Ingeniería, navigation elsewhere) — this projection never invents one.
 */
export type FabricationNextAction =
  | 'start-engineering'
  | 'complete-engineering'
  | 'prepare-materials'
  | null;

export interface FabricationFlow {
  readonly steps: readonly FabricationFlowStep[];
  readonly nextAction: FabricationNextAction;
  /** Spanish label of the next action (`null` with the action). */
  readonly nextActionLabel: string | null;
}

/** Honest result when the obra has no release authority to project. */
export type FabricationFlowResult =
  | { readonly kind: 'no-release' }
  | { readonly kind: 'flow'; readonly flow: FabricationFlow };

/**
 * What the surface resolved about the durable per-release Engineering state
 * (#740). `phase` is demonstrated evidence; the rest fail closed — the step
 * renders the honest "Pendiente de confirmar" and offers NO action.
 */
export type FabricationEngineeringEvidence =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unconfirmed' }
  | {
      readonly kind: 'phase';
      readonly phase: 'pending' | 'in_progress' | 'completed';
    };

export const FABRICATION_ENGINEERING_STATE_LABELS_ES: Readonly<
  Record<'pending' | 'in_progress' | 'completed', string>
> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  completed: 'Completa',
};

export const FABRICATION_UNCONFIRMED_LABEL_ES = 'Pendiente de confirmar';
export const FABRICATION_LOADING_LABEL_ES = 'Verificando…';

/**
 * Whether materialized physical executions show real floor work (same
 * evidence class `releaseWorkContinuityOf` uses, #741 PR 1): any completed /
 * in-progress / rework operation on a part, or a unit past `awaiting_parts`.
 * Never derived from `Project.status`.
 */
export function hasMaterializedPhysicalWork(
  project: Pick<Project, 'partInstances' | 'moduleUnits'>,
): boolean {
  for (const part of project.partInstances ?? []) {
    for (const op of part.requiredOperations ?? []) {
      if (op.status === 'completed' || op.status === 'in_progress' || op.status === 'rework') {
        return true;
      }
    }
  }
  for (const unit of project.moduleUnits ?? []) {
    if (unit.status && unit.status !== 'awaiting_parts') return true;
  }
  return false;
}

/**
 * Project the compact preparation flow of a CANONICAL obra. Obras without a
 * release authority (pre-DT legacy / local) resolve `no-release`: the
 * surfaces keep their existing presentation instead of inventing a flow the
 * Digital Thread cannot demonstrate.
 *
 * `unknownEngineeringLabel` lets Ingeniería keep the honest #738 fallback
 * vocabulary (e.g. "Sin verificar" for an uncorrelated legacy log) while the
 * durable state resolves; elsewhere the unconfirmed label stands.
 */
export function fabricationFlowOf(
  project: Project,
  engineering: FabricationEngineeringEvidence = { kind: 'unknown' },
  options: { readonly unknownEngineeringLabel?: string } = {},
): FabricationFlowResult {
  const authority = releaseAuthorityOf(project);
  if (!authority || authority.source !== 'canonical') {
    return { kind: 'no-release' };
  }

  // A canonical release IS the evidence that the design was approved and
  // liberated for manufacturing (server-enforced at creation).
  const releaseDetail =
    authority.releaseNumber !== undefined || authority.designRevisionNumber !== undefined
      ? `${authority.releaseNumber !== undefined ? `Liberación #${authority.releaseNumber}` : 'Liberada'}` +
        (authority.designRevisionNumber !== undefined ? ` · Diseño R${authority.designRevisionNumber}` : '')
      : null;

  const materialsDerived = materialEvidenceCorrelatesWithRelease(
    project.materialPlanning?.requirements,
    authority,
  );
  const materialsAuthorized = materialsDerived && Boolean(project.materialsRelease);
  const physicalWork = hasMaterializedPhysicalWork(project);

  // Engineering step — only the durable per-release state demonstrates it.
  let engineeringStatus: FabricationStepStatus;
  let engineeringStateLabel: string;
  let engineeringDetail: string | null = null;
  if (engineering.kind === 'phase') {
    engineeringStatus = engineering.phase === 'completed' ? 'done' : 'current';
    engineeringStateLabel = FABRICATION_ENGINEERING_STATE_LABELS_ES[engineering.phase];
  } else if (engineering.kind === 'loading') {
    engineeringStatus = 'unconfirmed';
    engineeringStateLabel =
      options.unknownEngineeringLabel ?? FABRICATION_ENGINEERING_STATE_LABELS_ES.pending;
    engineeringDetail = FABRICATION_LOADING_LABEL_ES;
  } else if (engineering.kind === 'unconfirmed') {
    engineeringStatus = 'unconfirmed';
    engineeringStateLabel =
      options.unknownEngineeringLabel ?? FABRICATION_ENGINEERING_STATE_LABELS_ES.pending;
    engineeringDetail = FABRICATION_UNCONFIRMED_LABEL_ES;
  } else {
    engineeringStatus = 'unconfirmed';
    engineeringStateLabel =
      options.unknownEngineeringLabel ?? FABRICATION_UNCONFIRMED_LABEL_ES;
  }
  const engineeringDone = engineeringStatus === 'done';

  // Materials step — the FACT of authorization stands on its own exact-release
  // evidence (correlated frozen requirements + audited stamp), independent of
  // Engineering completion; requirements without the stamp are the pending
  // derivation once Engineering is complete.
  const materialsLabel = materialsAuthorized
    ? 'Materiales autorizados'
    : materialsDerived && engineeringDone
      ? 'Materiales pendientes'
      : 'Materiales';
  const materialsStatus: FabricationStepStatus = materialsAuthorized
    ? 'done'
    : engineeringDone && materialsDerived
      ? 'current'
      : 'pending';

  // Production step — READINESS mirrors the #740 physical gate: engineering
  // completed AND materials authorized. Authorized materials alone (with
  // Engineering still pending/in progress/unconfirmed) keep Production
  // pending — the server would reject the first physical command. Real
  // physical work is a FACT that stands on its own evidence, never on
  // `Project.status` nor on the gate. Never marked done here (full
  // completion is commercial close, out of this projection).
  const productionReady = engineeringDone && materialsAuthorized;
  const productionStatus: FabricationStepStatus =
    physicalWork || productionReady ? 'current' : 'pending';
  const productionLabel = physicalWork
    ? 'En producción'
    : productionReady
      ? 'Listo para producción'
      : 'Producción';

  const steps: readonly FabricationFlowStep[] = [
    { id: 'design', status: 'done', label: 'Diseño aprobado', stateLabel: null, detail: null },
    {
      id: 'release',
      status: 'done',
      label: 'Liberado a Ingeniería',
      stateLabel: null,
      detail: releaseDetail,
    },
    {
      id: 'engineering',
      status: engineeringStatus,
      label: 'Ingeniería',
      stateLabel: engineeringStateLabel,
      detail: engineeringDetail,
    },
    { id: 'materials', status: materialsStatus, label: materialsLabel, stateLabel: null, detail: null },
    {
      id: 'production',
      status: productionStatus,
      label: productionLabel,
      stateLabel: null,
      detail: null,
    },
  ];

  // Exactly one current step: the first non-done one. Unconfirmed steps do
  // not carry actions (fail closed).
  const firstOpen = steps.find((step) => step.status !== 'done');
  const currentStep = firstOpen && (firstOpen.status === 'current' || firstOpen.status === 'unconfirmed')
    ? firstOpen
    : null;

  let nextAction: FabricationNextAction = null;
  let nextActionLabel: string | null = null;
  if (currentStep?.status === 'current') {
    if (currentStep.id === 'engineering' && engineering.kind === 'phase') {
      if (engineering.phase === 'pending') {
        nextAction = 'start-engineering';
        nextActionLabel = 'Iniciar Ingeniería';
      } else if (engineering.phase === 'in_progress') {
        nextAction = 'complete-engineering';
        nextActionLabel = 'Completar Ingeniería';
      }
    } else if (currentStep.id === 'materials') {
      nextAction = 'prepare-materials';
      nextActionLabel = 'Autorizar materiales';
    }
  }

  return {
    kind: 'flow',
    flow: { steps, nextAction, nextActionLabel },
  };
}
