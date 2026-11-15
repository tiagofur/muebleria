/**
 * Pasos del asistente «Nueva familia de cajón» (#1633 s2b). Un paso se puede
 * abrir cuando todos los anteriores están completos; el estado viaja por
 * icono + texto (nunca sólo color) y `aria-current="step"` marca el actual.
 */

import type { ReactNode } from 'react';
import { Check, Circle } from 'lucide-react';
import { FAMILY_WIZARD_STEPS, type FamilyWizardStep } from './familyWizardModel';

export function FamilyWizardSteps({
  current,
  reachable,
  complete,
  onSelect,
}: {
  readonly current: FamilyWizardStep;
  /** reachable[i]: el paso i se puede abrir (los anteriores están completos). */
  readonly reachable: readonly boolean[];
  /** complete[i]: el paso i no tiene problemas. */
  readonly complete: readonly boolean[];
  readonly onSelect: (step: FamilyWizardStep) => void;
}): ReactNode {
  return (
    <nav aria-label="Pasos de la familia de cajón" className="family-wizard__steps">
      <ol>
        {FAMILY_WIZARD_STEPS.map((label, i) => {
          const isCurrent = i === current;
          const done = complete[i] && i < current;
          const state = isCurrent ? 'actual' : done ? 'completo' : 'pendiente';
          return (
            <li key={label} className={`family-wizard__step family-wizard__step--${isCurrent ? 'current' : done ? 'done' : 'pending'}`}>
              <button
                type="button"
                className="family-wizard__step-btn"
                aria-current={isCurrent ? 'step' : undefined}
                disabled={!reachable[i]}
                title={reachable[i] ? undefined : 'Completá los pasos anteriores para abrir este.'}
                onClick={() => onSelect(i as FamilyWizardStep)}
                data-testid={`family-wizard-step-${i}`}
              >
                <span className="family-wizard__marker" aria-hidden>
                  {done ? <Check size={14} strokeWidth={2} /> : <Circle size={14} strokeWidth={1.75} />}
                </span>
                <span className="family-wizard__step-label">
                  {i + 1}. {label}
                </span>
                <span className="visually-hidden"> ({state})</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
