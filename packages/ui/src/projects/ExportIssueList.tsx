/**
 * Actionable export validation list (module / part / field) — presentation only.
 */

import type { ReactNode } from 'react';
import type { ExportIssue } from '@muebles/domain';

export interface ExportIssueListProps {
  readonly issues: readonly ExportIssue[];
  readonly title?: string;
}

function issueKey(issue: ExportIssue, index: number): string {
  return [
    issue.projectItemId ?? '',
    issue.moduleCode ?? '',
    issue.partId ?? issue.partCode ?? '',
    issue.field,
    String(index),
  ].join('|');
}

function formatIssueMeta(issue: ExportIssue): string {
  const parts: string[] = [];
  if (issue.moduleCode) parts.push(`módulo ${issue.moduleCode}`);
  if (issue.partCode) parts.push(`pieza ${issue.partCode}`);
  else if (issue.partId) parts.push(`pieza ${issue.partId}`);
  if (issue.field) parts.push(`campo ${issue.field}`);
  if (issue.optionGroupCode) parts.push(`opción ${issue.optionGroupCode}`);
  return parts.join(' · ');
}

export function ExportIssueList({
  issues,
  title = 'No se puede exportar. Corregí estos problemas:',
}: ExportIssueListProps): ReactNode {
  if (issues.length === 0) return null;

  return (
    <div
      className="export-issues"
      role="alert"
      aria-live="assertive"
      aria-label="Errores de export"
    >
      <p className="export-issues__title">{title}</p>
      <ul className="export-issues__list">
        {issues.map((issue, index) => {
          const meta = formatIssueMeta(issue);
          return (
            <li key={issueKey(issue, index)} className="export-issues__item">
              <span className="export-issues__message">{issue.message}</span>
              {meta ? (
                <span className="export-issues__meta">{meta}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
