/**
 * Inicio home wiring for the batch commercial summaries (#642).
 *
 * Pure adapter extracted from the ShellView render: translates the session
 * mode plus the hook dataset state into the Dashboard presentation props.
 * Keeping it pure lets the wiring contract (what the home cards can
 * actually receive) be tested without mounting the whole shell.
 */

import type { ProjectCommercialSummary } from '@granete/storage';
import type { CommercialSummariesStatus } from '@granete/ui';
import type { SessionMode } from './session';
import type { ProjectsCommercialSummaries } from './projectsCommercialSummaries';

export interface HomeCommercialSummariesProps {
  readonly commercialSummaries: ReadonlyMap<string, ProjectCommercialSummary> | undefined;
  readonly commercialSummariesStatus: CommercialSummariesStatus;
  readonly commercialSummariesStale: string | undefined;
  readonly onRetryCommercialSummaries: (() => void) | undefined;
}

export function homeCommercialSummariesProps(
  session: SessionMode,
  dataset: ProjectsCommercialSummaries,
): HomeCommercialSummariesProps {
  // A non-auth session is a definitive local mode: the batch never fires
  // (no token), so there is no remote commercial dataset to wait for. Map it
  // to the explicit `unavailable` state — never to an endless "Cargando…",
  // and never offering a retry that cannot legitimately query. An auth (or
  // support) session WILL query as soon as the token exists, so its
  // idle/loading stays a real pending request.
  if (session !== 'auth') {
    return {
      commercialSummaries: undefined,
      commercialSummariesStatus: 'unavailable',
      commercialSummariesStale: undefined,
      onRetryCommercialSummaries: undefined,
    };
  }
  return {
    commercialSummaries:
      dataset.kind === 'ready' ? dataset.summaries : undefined,
    commercialSummariesStatus:
      dataset.kind === 'ready'
        ? 'ready'
        : dataset.kind === 'error'
          ? 'error'
          : 'loading',
    commercialSummariesStale:
      dataset.kind === 'ready' ? dataset.staleMessage : undefined,
    onRetryCommercialSummaries:
      dataset.kind === 'ready' || dataset.kind === 'error'
        ? dataset.retry
        : undefined,
  };
}

