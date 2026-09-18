/**
 * ProcessStrip — horizontal compact process indicator (#768).
 *
 * Renders the same READ-ONLY domain projection (`fabricationFlowOf`) as
 * `FabricationFlowSteps`, but in a horizontal strip layout that occupies
 * significantly less vertical space (~55-80px vs ~250-300px).
 *
 * Used in the EngineeringWorkspace header to keep workflow as context,
 * not protagonist — the user reaches technical information faster.
 *
 * The component owns NO lifecycle and NO action semantics: the surface
 * provides the action derived from the projection's `nextAction`.
 * State never travels by color alone — icon shape + text label carry it,
 * `aria-current="step"` marks the current step.
 */

import type { ReactNode } from 'react';
import { Check, Circle, CircleDashed } from 'lucide-react';
import type {
  FabricationFlow,
  FabricationFlowStep,
  FabricationFlowStepId,
} from '@granete/domain';
import './processStrip.css';

/** Surface-provided action for the flow's `nextAction`. */
export type ProcessStripActionProp = {
  readonly label: string;
  readonly onActivate: () => void;
  readonly busy?: boolean;
  readonly title?: string;
  readonly testId?: string;
};

export type ProcessStripProps = {
  readonly flow: FabricationFlow;
  /** Action for `flow.nextAction`. */
  readonly action?: ProcessStripActionProp | null;
  /** Optional testids for demonstrated-state spans. */
  readonly stateTestIds?: Readonly<Partial<Record<FabricationFlowStepId, string>>>;
  readonly testIdPrefix?: string;
};

function StepIcon({ step }: { readonly step: FabricationFlowStep }): ReactNode {
  if (step.status === 'done') {
    return <Check size={14} strokeWidth={2.5} aria-hidden />;
  }
  if (step.status === 'unconfirmed') {
    return <CircleDashed size={14} strokeWidth={1.75} aria-hidden />;
  }
  return <Circle size={14} strokeWidth={1.75} aria-hidden />;
}

/**
 * Inline state text for a step: `unconfirmed` carries the honest fail-closed
 * label (the domain projection renders the same vocabulary as its detail),
 * every other status surfaces the demonstrated-state vocabulary.
 */
function inlineStateText(step: FabricationFlowStep): string | null {
  if (step.status === 'unconfirmed') return 'Pendiente de confirmar';
  return step.stateLabel;
}

/** Short status label for inline display (avoids repeating full step label). */
function InlineStatusLabel({
  step,
  stateTestId,
}: {
  readonly step: FabricationFlowStep;
  readonly stateTestId?: string;
}): ReactNode | null {
  const text = inlineStateText(step);
  if (!text) return null;
  const muted = step.status === 'unconfirmed';
  return (
    <span className={muted ? 'ps__state ps__state--muted' : 'ps__state'} data-testid={stateTestId}>
      {text}
    </span>
  );
}

export function ProcessStrip({
  flow,
  action = null,
  stateTestIds,
  testIdPrefix = 'eng',
}: ProcessStripProps): ReactNode {
  return (
    <section
      className="ps"
      aria-label="Preparación para fabricar"
      data-testid={`${testIdPrefix}-fab-flow`}
    >
      <ol className="ps__steps" role="list">
        {flow.steps.map((step, i) => (
          <li
            key={step.id}
            className={`ps__step ps__step--${step.status}`}
            data-state={step.status}
            data-testid={`${testIdPrefix}-fab-step-${step.id}`}
            aria-current={step.status === 'current' ? 'step' : undefined}
          >
            <span className="ps__marker" aria-hidden>
              <StepIcon step={step} />
            </span>
            <span className="ps__label">{step.label}</span>
            <InlineStatusLabel step={step} stateTestId={stateTestIds?.[step.id]} />
            {/* Detail never repeats the state text (fail-closed unconfirmed
                emits both with the same vocabulary — #768 projection). */}
            {step.detail && step.detail !== inlineStateText(step) ? (
              <span className="ps__detail" title={step.detail}>{step.detail}</span>
            ) : null}
            {/* Connector line between steps (not after last) */}
            {i < flow.steps.length - 1 && (
              <span className="ps__connector" aria-hidden />
            )}
          </li>
        ))}
      </ol>

      {/* Inline action — right-aligned in the strip */}
      {flow.nextAction && (
        <div className="ps__action">
          {action ? (
            <button
              type="button"
              className="btn btn--primary btn--small ps__btn"
              onClick={action.onActivate}
              disabled={action.busy}
              data-testid={action.testId ?? `${testIdPrefix}-fab-next-action`}
              title={action.title}
            >
              {action.label}
            </button>
          ) : (
            <span
              className="ps__next-text"
              data-testid={`${testIdPrefix}-fab-next-text`}
            >
              {flow.nextActionLabel}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
