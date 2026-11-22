/**
 * #1650 — wires «Enviar cotización» into the project detail. Only
 * authenticated sessions whose role may record quote_sent get it; the query
 * key is scoped by the session (late responses never cross tenants). The PDF
 * comes from the SAME builder as the download, so the emailed attachment is
 * byte-identical to the downloaded file.
 */
import { useMemo, type ReactNode } from 'react';
import { roleCanAppendProjectEvent } from '@granete/domain';
import type { QuoteRevisionDetail } from '@granete/storage';
import { QuoteSendPanel, type QuoteSendPdfResult } from '@granete/ui';
import { sessionScopeKey, type SessionScope } from '../shared/query/sessionScope';

type PdfBuildResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly fileName: string }
  | { readonly ok: false; readonly issues: ReadonlyArray<{ readonly message: string }> };

export interface QuoteSendRendererInput {
  readonly session: 'guest' | 'auth' | null;
  readonly authToken: string | null;
  readonly sessionScope: SessionScope | null;
  readonly actorRoles: readonly string[];
  readonly baseUrl: string;
  /** Exact revisions of the selected project (authoritative server read). */
  readonly revisions: ReadonlyArray<QuoteRevisionDetail> | undefined;
  readonly buildPdf: (
    revisions: ReadonlyArray<QuoteRevisionDetail>,
    quoteRevisionId: string,
    variant: 'detailed' | 'summary',
  ) => Promise<PdfBuildResult>;
}

export function canSendQuotes(roles: readonly string[]): boolean {
  return roles.some((role) => roleCanAppendProjectEvent(role, 'quote_sent'));
}

export function useQuoteSendRenderer(input: QuoteSendRendererInput): ((projectId: string) => ReactNode) | undefined {
  const { session, authToken, sessionScope, actorRoles, baseUrl, revisions, buildPdf } = input;
  const enabled = session === 'auth' && Boolean(authToken) && sessionScope !== null && canSendQuotes(actorRoles);
  return useMemo(() => {
    if (!enabled || !authToken || !sessionScope) return undefined;
    const root = sessionScopeKey(sessionScope);
    return (projectId: string) => {
      const projectRevisions = (revisions ?? []).filter((revision) => revision.projectId === projectId);
      const toPanelPdf = async (quoteRevisionId: string, variant: 'detailed' | 'summary'): Promise<QuoteSendPdfResult> => {
        const result = await buildPdf(projectRevisions, quoteRevisionId, variant);
        if (result.ok) return { ok: true, bytes: result.bytes, fileName: result.fileName };
        return { ok: false, message: result.issues[0]?.message ?? 'No se pudo generar el PDF de la cotización.' };
      };
      return (
        <QuoteSendPanel
          key={`quote-send-${projectId}`}
          baseUrl={baseUrl}
          token={authToken}
          projectId={projectId}
          queryKey={['quote-deliveries', ...root, projectId]}
          revisions={projectRevisions.map((revision) => ({
            id: revision.id,
            revisionNumber: revision.revisionNumber,
            status: revision.status,
            exportable:
              revision.commercialSnapshot != null &&
              revision.commercialSnapshot.lines.length > 0 &&
              revision.commercialAmountsWithheld !== true,
          }))}
          buildPdf={toPanelPdf}
        />
      );
    };
  }, [enabled, authToken, sessionScope, baseUrl, revisions, buildPdf]);
}
