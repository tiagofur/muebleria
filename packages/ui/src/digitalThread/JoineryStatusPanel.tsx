/**
 * J1-B joinery diagnostics (#875 read-only slice): renders the canonical
 * per-relationship joinery states produced by the authoring resolve API
 * (#874). Everything shown comes from the backend — this panel never
 * computes contacts, stations or holes, and offers no fabrication writes.
 */

import { CircleAlert, CheckCircle2, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import type { FingerprintJoineryStatus } from '@granete/domain';

export const JOINERY_STAGE_LABELS_ES: Record<string, string> = {
  RELATIONSHIP_UNSUPPORTED: 'Relación no soportada',
  CONTACT_INVALID: 'Contacto inválido',
  STATION_INVALID: 'Distribución de fijaciones inválida',
  TECHNICAL_PROFILE_REQUIRED: 'Perfil técnico requerido',
  MACHINING_INVALID: 'Mecanizado inválido',
  MACHINING_READY: 'Listo para mecanizar',
};

export const JOINERY_PRODUCTION_LABELS_ES = {
  blocked: 'Producción bloqueada',
  ready: 'Producción habilitada',
} as const;

export interface JoineryRelationshipDiagnostics {
  readonly relationshipId: string;
  readonly kind: string;
  readonly stageLabel: string;
  readonly contacts: readonly { readonly contactId: string; readonly valid: boolean }[];
  readonly stationsPlanned: boolean;
  readonly stationSummary: string;
  readonly operationsCount: number;
  readonly profileRequired: boolean;
  readonly productionReady: boolean;
  readonly blockers: readonly string[];
}

/**
 * Pure display projection over backend joinery states plus the wire
 * operation counts; exported for tests and future consumers (#875).
 */
export function joineryDiagnosticsModel(
  statuses: readonly FingerprintJoineryStatus[],
  relationshipOperationCounts: ReadonlyMap<string, number>,
): readonly JoineryRelationshipDiagnostics[] {
  return statuses.map((status) => ({
    relationshipId: status.relationshipId,
    kind: status.kind,
    stageLabel: JOINERY_STAGE_LABELS_ES[status.stage] ?? status.stage,
    contacts: status.contacts.map((contact) => ({
      contactId: contact.contactId, valid: contact.status === 'VALID',
    })),
    stationsPlanned: status.stations.status === 'PLANNED',
    stationSummary: status.stations.status === 'PLANNED'
      ? status.stations.stationCounts.map((count) => `${count.stationCount}`).join(' · ')
      : '—',
    operationsCount: relationshipOperationCounts.get(status.relationshipId) ?? 0,
    profileRequired: status.stage === 'TECHNICAL_PROFILE_REQUIRED',
    productionReady: status.stage === 'MACHINING_READY',
    blockers: status.blockers,
  }));
}

export interface JoineryStatusPanelProps {
  readonly joineryStatuses: readonly FingerprintJoineryStatus[] | null;
  readonly relationshipOperationCounts?: ReadonlyMap<string, number>;
  readonly loading?: boolean;
  readonly error?: boolean;
  readonly onRetry?: () => void;
}

export function JoineryStatusPanel({
  joineryStatuses, relationshipOperationCounts, loading = false, error = false, onRetry,
}: JoineryStatusPanelProps): ReactNode {
  const diagnostics = joineryStatuses === null
    ? null
    : joineryDiagnosticsModel(joineryStatuses, relationshipOperationCounts ?? new Map());
  return (
    <section className="pd-card pr-panel" data-testid="joinery-status-panel" aria-labelledby="joinery-status-title">
      <div className="pd-card__header">
        <div className="pd-card__title">
          <CircleAlert size={18} />
          <h3 id="joinery-status-title">Construcción y uniones</h3>
        </div>
        {loading ? (
          <span className="status-badge status-badge--open" data-testid="joinery-loading">Resolviendo…</span>
        ) : null}
      </div>

      {error ? (
        <div className="pd-alert pd-alert--error" role="alert" data-testid="joinery-error">
          No se pudo resolver el estado constructivo desde el servidor.
          {onRetry ? (
            <button type="button" className="btn btn-sm btn-secondary" onClick={onRetry}>
              Reintentar
            </button>
          ) : null}
        </div>
      ) : loading ? (
        <p className="pd-empty-hint">Resolviendo contactos y fijaciones con el motor canónico…</p>
      ) : diagnostics === null ? (
        <p className="pd-empty-hint">Seleccioná un mueble para ver su construcción y uniones.</p>
      ) : diagnostics.length === 0 ? (
        <p className="pd-empty-hint" data-testid="joinery-empty">
          Este mueble no declara uniones constructivas registradas.
        </p>
      ) : (
        <ul className="pr-issue-list" data-testid="joinery-relationships">
          {diagnostics.map((diagnostic) => (
            <li key={diagnostic.relationshipId} className="pr-issue-list__item" data-testid={`joinery-${diagnostic.relationshipId}`}>
              <div className="pd-card__title">
                {diagnostic.productionReady
                  ? <CheckCircle2 size={14} />
                  : <TriangleAlert size={14} />}
                <strong>{diagnostic.relationshipId}</strong>
                <span className="pd-code-pill">{diagnostic.kind}</span>
              </div>
              <div>
                {diagnostic.stageLabel}
                {diagnostic.contacts.length > 0 ? ' · Contactos: ' : ''}
                {diagnostic.contacts.map((contact, index) => (
                  <span key={contact.contactId}>
                    {index > 0 ? ', ' : ''}
                    {contact.valid
                      ? `${shortContactLabel(contact.contactId)}: válido`
                      : `${shortContactLabel(contact.contactId)}: inválido`}
                  </span>
                ))}
              </div>
              <div>
                Estaciones: {diagnostic.stationSummary}
                {' · '}Operaciones: {diagnostic.operationsCount}
                {diagnostic.profileRequired ? ' (pendientes de perfil técnico)' : ''}
              </div>
              <div>
                Perfil técnico: {diagnostic.profileRequired ? 'requerido' : 'no requerido'}
                {' · '}
                {diagnostic.productionReady
                  ? JOINERY_PRODUCTION_LABELS_ES.ready
                  : JOINERY_PRODUCTION_LABELS_ES.blocked}
              </div>
              {diagnostic.blockers.length > 0 ? (
                <div className="pr-issue-list__code" title="Bloqueadores canónicos">
                  {diagnostic.blockers.join(', ')}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Human suffix of a canonical contactId (`relationshipId:participantId`). */
export function shortContactLabel(contactId: string): string {
  const separator = contactId.lastIndexOf(':');
  return separator === -1 ? contactId : contactId.slice(separator + 1);
}
