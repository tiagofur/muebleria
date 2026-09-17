/**
 * FabricationFlowSteps — compact "Preparación para fabricar" stepper (#768).
 *
 * Renders the READ-ONLY domain projection (`fabricationFlowOf`) so a factory
 * owner sees in seconds where the obra is, what is done, what is missing and
 * the single next step. Vertical list by design: no horizontal 5-step bar
 * that forces sideways scroll on plant phones (390 px first).
 *
 * The component owns NO lifecycle and NO action semantics: the surface
 * provides the action (command in Ingeniería, navigation elsewhere) derived
 * from the projection's `nextAction`; without a safe action the next step
 * renders as plain text. State never travels by color alone — icon shape +
 * text label carry it, `aria-current="step"` marks the current step.
 */

import type { ReactNode } from 'react';
import { Check, Circle, CircleDashed } from 'lucide-react';
import type {
  FabricationFlow,
  FabricationFlowStep,
  FabricationFlowStepId,
} from '@granete/domain';
import './fabricationFlowSteps.css';

/** Surface-provided action for the flow's `nextAction` (command or navigation). */
export type FabricationFlowActionProp = {
  readonly label: string;
  readonly onActivate: () => void;
  readonly busy?: boolean;
  readonly title?: string;
  readonly testId?: string;
};

export type FabricationFlowStepsProps = {
  readonly flow: FabricationFlow;
  /**
   * Action for `flow.nextAction`. When the flow has a next action but the
   * surface provides none (no permission / no safe surface yet), the next
   * step renders as text only — never a dead or invented button.
   */
  readonly action?: FabricationFlowActionProp | null;
  /** Optional per-step extra content (e.g. the completion audit fact). */
  readonly renderDetail?: (stepId: FabricationFlowStepId) => ReactNode;
  /**
   * Optional testids for the demonstrated-state span (e.g. surfaces that
   * own an existing status contract such as `eng-entry-status`).
   */
  readonly stateTestIds?: Readonly<Partial<Record<FabricationFlowStepId, string>>>;
  readonly testIdPrefix?: string;
};

function StepMarker({ step }: { readonly step: FabricationFlowStep }): ReactNode {
  if (step.status === 'done') {
    return <Check size={16} strokeWidth={2} aria-hidden />;
  }
  if (step.status === 'unconfirmed') {
    return <CircleDashed size={16} strokeWidth={1.75} aria-hidden />;
  }
  return <Circle size={16} strokeWidth={1.75} aria-hidden />;
}

export function FabricationFlowSteps({
  flow,
  action = null,
  renderDetail,
  stateTestIds,
  testIdPrefix = 'fab',
}: FabricationFlowStepsProps): ReactNode {
  return (
    <section
      className="fab-flow"
      aria-label="Preparación para fabricar"
      data-testid={`${testIdPrefix}-fab-flow`}
    >
      <p className="fab-flow__title">Preparación para fabricar</p>
      <ol className="fab-flow__steps">
        {flow.steps.map((step) => (
          <li
            key={step.id}
            className={`fab-flow__step fab-flow__step--${step.status}`}
            data-state={step.status}
            data-testid={`${testIdPrefix}-fab-step-${step.id}`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className="fab-flow__marker" aria-hidden>
              <StepMarker step={step} />
            </span>
            <span className="fab-flow__body">
              <span className="fab-flow__label">
                {step.label}
                {step.stateLabel ? (
                  <span
                    className="fab-flow__state"
                    data-testid={stateTestIds?.[step.id]}
                  >
                    {step.stateLabel}
                  </span>
                ) : null}
              </span>
              {step.detail ? (
                <span className="fab-flow__detail">{step.detail}</span>
              ) : null}
              {renderDetail?.(step.id)}
            </span>
          </li>
        ))}
      </ol>
      {flow.nextAction ? (
        <div className="fab-flow__next">
          <span className="fab-flow__next-label">Siguiente paso</span>
          {action ? (
            <button
              type="button"
              className="btn btn--primary btn--small fab-flow__next-action"
              onClick={action.onActivate}
              disabled={action.busy}
              data-testid={action.testId ?? `${testIdPrefix}-fab-next-action`}
              title={action.title}
            >
              {action.label}
            </button>
          ) : (
            <span
              className="fab-flow__next-text"
              data-testid={`${testIdPrefix}-fab-next-text`}
            >
              {flow.nextActionLabel}
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
