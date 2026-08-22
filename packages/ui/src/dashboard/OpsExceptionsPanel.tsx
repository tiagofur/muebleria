/**
 * OpsExceptionsPanel — exception-first list for the owner/manager home
 * (OC-090): what needs attention right now, each row opening the obra it
 * belongs to. Shell-derived from the domain (deriveOpsExceptions); this
 * component only renders and navigates. No decorative KPI cards.
 */

import type { ReactNode } from 'react';
import { ArrowRight, CircleAlert, TriangleAlert } from 'lucide-react';
import type { OpsException } from '@muebles/domain';
import './dashboard.css';

export interface OpsExceptionsPanelProps {
  readonly exceptions: readonly OpsException[];
  readonly onOpenProject: (projectId: string) => void;
  readonly testId?: string;
}

const SEVERITY_LABEL_ES: Readonly<Record<OpsException['severity'], string>> = {
  critical: 'Crítico',
  warning: 'Atención',
  info: 'Info',
};

function severityClass(severity: OpsException['severity']): string {
  if (severity === 'critical') return 'ops-exceptions__item--critical';
  if (severity === 'warning') return 'ops-exceptions__item--warning';
  return 'ops-exceptions__item--info';
}

export function OpsExceptionsPanel({
  exceptions,
  onOpenProject,
  testId = 'ops-exceptions-panel',
}: OpsExceptionsPanelProps): ReactNode {
  if (exceptions.length === 0) return null;
  const critical = exceptions.filter((e) => e.severity === 'critical').length;

  return (
    <section
      className="dashboard__section"
      aria-labelledby="ops-exceptions-title"
      data-testid={testId}
    >
      <div className="ops-exceptions__header">
        <h3 id="ops-exceptions-title" className="ops-exceptions__title">
          {critical > 0 ? (
            <TriangleAlert size={18} strokeWidth={1.5} aria-hidden />
          ) : (
            <CircleAlert size={18} strokeWidth={1.5} aria-hidden />
          )}
          Necesita atención — {exceptions.length} alerta{exceptions.length === 1 ? '' : 's'}
        </h3>
        <p className="ops-exceptions__hint">
          Cada alerta abre la obra correspondiente para resolverla.
        </p>
      </div>
      <ul className="ops-exceptions__list" data-testid={`${testId}-list`}>
        {exceptions.map((exception, index) => (
          <li
            key={`${exception.kind}-${exception.projectId}-${index}`}
            className={`ops-exceptions__item ${severityClass(exception.severity)}`}
            data-testid={`${testId}-item`}
          >
            <button
              type="button"
              className="ops-exceptions__button"
              onClick={() => onOpenProject(exception.projectId)}
              data-testid={`${testId}-open`}
            >
              <span className="ops-exceptions__severity" aria-label={SEVERITY_LABEL_ES[exception.severity]}>
                {SEVERITY_LABEL_ES[exception.severity]}
              </span>
              <span className="ops-exceptions__body">
                <span className="ops-exceptions__project">{exception.projectName}</span>
                <span className="ops-exceptions__message">{exception.message}</span>
                <span className="ops-exceptions__action">{exception.actionHint}</span>
              </span>
              <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
