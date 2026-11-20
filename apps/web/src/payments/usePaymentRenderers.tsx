/**
 * #1649 — wires the server-backed payment surfaces into the shell: «Cobros»
 * in the project detail, «Por cobrar» in the sales dashboard and the customer
 * account. Only authenticated sessions with commercial authority get them;
 * every query key is scoped by the session (late responses never cross
 * tenants). The receipt PDF is drawn from the exact server payment.
 */
import { useCallback, useMemo, type ReactNode } from 'react';
import { roleCanAppendProjectEvent } from '@granete/domain';
import { paymentReceiptPdfExport } from '@granete/excel';
import type { ProjectPayment, ProjectPaymentSummary } from '@granete/storage';
import { ProjectPaymentsPanel, ReceivablesPanel } from '@granete/ui';
import { downloadOptimizerXlsx } from '../exportOptimizer';
import { sessionScopeKey, type SessionScope } from '../shared/query/sessionScope';

export interface PaymentRenderersInput {
  readonly session: 'guest' | 'auth' | null;
  readonly authToken: string | null;
  readonly sessionScope: SessionScope | null;
  readonly actorRoles: readonly string[];
  readonly baseUrl: string;
  readonly workshopName?: string;
  readonly projects: readonly { readonly id: string; readonly name: string; readonly currency: string; readonly customerId: string }[];
  readonly customerName: (customerId: string) => string | undefined;
  readonly onOpenProject: (projectId: string) => void;
}

export interface PaymentRenderers {
  readonly renderPaymentsPanel?: (projectId: string) => ReactNode;
  readonly receivablesPanel?: ReactNode;
  readonly renderCustomerAccount?: (customerId: string) => ReactNode;
}

export function paymentQueryKeys(scope: SessionScope) {
  const root = sessionScopeKey(scope);
  return {
    project: (projectId: string) => ['project-payments', ...root, projectId] as const,
    receivables: ['project-receivables', ...root] as const,
  };
}

export function canSeePayments(roles: readonly string[]): boolean {
  return roles.some((role) => roleCanAppendProjectEvent(role, 'deposit_received'));
}

export function usePaymentRenderers(input: PaymentRenderersInput): PaymentRenderers {
  const {
    session,
    authToken,
    sessionScope,
    actorRoles,
    baseUrl,
    workshopName,
    projects,
    customerName,
    onOpenProject,
  } = input;
  const enabled = session === 'auth' && Boolean(authToken) && sessionScope !== null && canSeePayments(actorRoles);
  const keys = useMemo(() => (sessionScope ? paymentQueryKeys(sessionScope) : null), [sessionScope]);

  const downloadReceipt = useCallback(
    async (projectId: string, payment: ProjectPayment, summary: ProjectPaymentSummary) => {
      const project = projects.find((p) => p.id === projectId);
      const bytes = await paymentReceiptPdfExport({
        workshopName: workshopName || 'Granete',
        projectName: project?.name ?? projectId,
        customerName: project ? customerName(project.customerId) : undefined,
        payment: {
          id: payment.id,
          kind: payment.kind,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.paymentMethod,
          reference: payment.reference,
          receivedAt: payment.receivedAt,
          recordedAt: payment.recordedAt,
          void: payment.void ? { reason: payment.void.reason, voidedAt: payment.void.voidedAt } : undefined,
        },
        balance:
          summary.balance !== undefined && summary.acceptedQuote
            ? { amount: summary.balance, currency: summary.currency, quoteLabel: `Q${summary.acceptedQuote.revisionNumber}` }
            : undefined,
      });
      downloadOptimizerXlsx(bytes, `recibo-${payment.id.slice(0, 8)}.pdf`);
    },
    [projects, workshopName, customerName],
  );

  return useMemo<PaymentRenderers>(() => {
    if (!enabled || !keys || !authToken) return {};
    return {
      renderPaymentsPanel: (projectId: string) => {
        const project = projects.find((p) => p.id === projectId);
        return (
          <ProjectPaymentsPanel
            key={`payments-${projectId}`}
            baseUrl={baseUrl}
            token={authToken}
            projectId={projectId}
            projectCurrency={project?.currency ?? 'MXN'}
            queryKey={keys.project(projectId)}
            canRecord
            onDownloadReceipt={(payment, summary) => downloadReceipt(projectId, payment, summary)}
          />
        );
      },
      receivablesPanel: (
        <ReceivablesPanel baseUrl={baseUrl} token={authToken} queryKey={keys.receivables} onOpenProject={onOpenProject} />
      ),
      renderCustomerAccount: (customerId: string) => (
        <ReceivablesPanel
          baseUrl={baseUrl}
          token={authToken}
          queryKey={keys.receivables}
          customerId={customerId}
          onOpenProject={onOpenProject}
        />
      ),
    };
  }, [enabled, keys, authToken, baseUrl, projects, downloadReceipt, onOpenProject]);
}
