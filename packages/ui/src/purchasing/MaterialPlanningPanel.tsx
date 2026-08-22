/**
 * MaterialPlanningPanel — evidence view of a project's material planning
 * (OC-050..OC-054): requirement coverage, reservations, shortage → OC and
 * the gated materials release with audited override. The shell resolves the
 * domain view (`MaterialPlanningCardView`); this component only renders and
 * dispatches actions.
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle, ClipboardCheck, PackageCheck, ShieldAlert } from 'lucide-react';
import {
  MATERIALS_RELEASE_CHECK_LABELS_ES,
  STOCK_KIND_LABELS_ES,
  stockUnitLabel,
} from '@muebles/domain';
import type { MaterialPlanningCardView } from './materialPlanningView';
import './purchasing.css';

export type MaterialPlanningHandlers = {
  readonly onDerive?: (projectId: string) => void | Promise<void>;
  readonly onReserve?: (projectId: string) => void | Promise<void>;
  readonly onCreateShortagePO?: (projectId: string) => void | Promise<void>;
  readonly onRelease?: (projectId: string, overrideReason?: string) => void | Promise<void>;
};

export type MaterialPlanningPanelProps = {
  readonly view: MaterialPlanningCardView;
  readonly handlers: MaterialPlanningHandlers;
  readonly unitByMaterial?: Readonly<Record<string, string>>;
  /** `${kind}:${materialId}` → human label from the catalog (never raw ids). */
  readonly labelsByMaterial?: Readonly<Record<string, string>>;
  readonly canManage?: boolean;
  readonly testId?: string;
};

function labelFor(
  kind: string,
  materialId: string,
  labels: Readonly<Record<string, string>>,
): string {
  const kindLabel = STOCK_KIND_LABELS_ES[kind as keyof typeof STOCK_KIND_LABELS_ES] ?? kind;
  const materialLabel = labels[`${kind}:${materialId}`] ?? materialId;
  return `${kindLabel} · ${materialLabel}`;
}

export function MaterialPlanningPanel({
  view,
  handlers,
  unitByMaterial = {},
  labelsByMaterial = {},
  canManage = true,
  testId,
}: MaterialPlanningPanelProps): ReactNode {
  const [overrideReason, setOverrideReason] = useState('');
  const hasPending = view.coverage.some((line) => line.pendingReserve > 0);
  const hasShortage = view.shortageLines.length > 0;

  if (view.released) {
    return (
      <div className="purch-plan" data-testid={testId ?? `purch-plan-${view.projectId}`}>
        <span className="status-badge status-badge--done">
          <PackageCheck size={12} strokeWidth={1.5} aria-hidden />
          Material liberado a producción
        </span>
      </div>
    );
  }

  return (
    <div className="purch-plan" data-testid={testId ?? `purch-plan-${view.projectId}`}>
      {!view.requirementsDerived ? (
        <div className="purch-plan__empty">
          <p className="purch-plan__hint">
            {view.canDerive
              ? 'Derivá los requerimientos del BOM liberado para ver reservas y faltantes.'
              : 'Esta obra no tiene liberación de producción: los requerimientos sólo se derivan del BOM liberado.'}
          </p>
          {canManage && view.canDerive && handlers.onDerive ? (
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => handlers.onDerive?.(view.projectId)}
              data-testid={`purch-plan-derive-${view.projectId}`}
            >
              <ClipboardCheck size={14} strokeWidth={1.5} aria-hidden />
              Derivar requerimientos
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <table className="purch-plan__table" aria-label="Cobertura de materiales por línea">
            <thead>
              <tr>
                <th scope="col">Material</th>
                <th scope="col">Requerido</th>
                <th scope="col">Reservado</th>
                <th scope="col">Disponible depósito</th>
                <th scope="col">OC en camino</th>
                <th scope="col">Falta comprar</th>
              </tr>
            </thead>
            <tbody>
              {view.coverage.map((line) => {
                const unit = unitByMaterial[`${line.kind}:${line.materialId}`] ?? 'u';
                return (
                  <tr key={`${line.kind}:${line.materialId}`}>
                    <td>{labelFor(line.kind, line.materialId, labelsByMaterial)}</td>
                    <td>
                      {line.required} {unit}
                    </td>
                    <td>
                      {line.reserved} {unit}
                      {line.pendingReserve > 0 ? (
                        <span className="purch-plan__pending"> · faltan {line.pendingReserve}</span>
                      ) : null}
                    </td>
                    <td>{line.available}</td>
                    <td>{line.incomingAllocated}</td>
                    <td>
                      {line.shortage > 0 ? (
                        <span className="status-badge status-badge--open">
                          <AlertTriangle size={12} strokeWidth={1.5} aria-hidden />
                          {line.shortage} {unit}
                        </span>
                      ) : (
                        <span className="status-badge status-badge--done">Cubierto</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {canManage ? (
            <div className="purch-plan__actions">
              {hasPending && handlers.onReserve ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => handlers.onReserve?.(view.projectId)}
                  data-testid={`purch-plan-reserve-${view.projectId}`}
                >
                  Reservar disponible
                </button>
              ) : null}
              {hasShortage && handlers.onCreateShortagePO ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--small"
                  onClick={() => handlers.onCreateShortagePO?.(view.projectId)}
                  data-testid={`purch-plan-po-${view.projectId}`}
                >
                  Crear OC del faltante ({view.shortageLines.length} líneas)
                </button>
              ) : null}
              {handlers.onRelease ? (
                <button
                  type="button"
                  className="btn btn--primary btn--small"
                  onClick={() => handlers.onRelease?.(view.projectId)}
                  data-testid={`purch-plan-release-${view.projectId}`}
                >
                  <PackageCheck size={14} strokeWidth={1.5} aria-hidden />
                  Liberar material
                </button>
              ) : null}
            </div>
          ) : null}

          {!view.releaseReady ? (
            <div className="purch-plan__gates" data-testid={`purch-plan-gates-${view.projectId}`}>
              <h5 className="purch-plan__gates-title">
                <ShieldAlert size={14} strokeWidth={1.5} aria-hidden />
                Evidencia de liberación incompleta
              </h5>
              <ul className="purch-plan__gate-list">
                {view.releaseChecks.map((check) => (
                  <li
                    key={check.code}
                    className={check.passed ? 'purch-plan__gate--ok' : 'purch-plan__gate--fail'}
                  >
                    <span className="purch-plan__gate-label">
                      {check.label ?? MATERIALS_RELEASE_CHECK_LABELS_ES[check.code]}
                    </span>
                    <span className="purch-plan__gate-details">{check.details}</span>
                  </li>
                ))}
              </ul>
              {canManage && handlers.onRelease ? (
                <div className="purch-plan__override">
                  <label
                    className="purch-plan__override-label"
                    htmlFor={`purch-plan-override-${view.projectId}`}
                  >
                    Motivo del override (queda auditado)
                  </label>
                  <div className="purch-plan__override-row">
                    <input
                      id={`purch-plan-override-${view.projectId}`}
                      type="text"
                      className="input"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Ej.: el cliente provee los herrajes"
                      data-testid={`purch-plan-override-input-${view.projectId}`}
                    />
                    <button
                      type="button"
                      className="btn btn--secondary btn--small"
                      disabled={!overrideReason.trim()}
                      onClick={() => {
                        handlers.onRelease?.(view.projectId, overrideReason.trim());
                        setOverrideReason('');
                      }}
                      data-testid={`purch-plan-override-release-${view.projectId}`}
                    >
                      Liberar con override
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Unit label helper exposed for the shell (resolves catalog units). */
export function planUnitLabel(
  kind: string,
  hardwareUnit?: string,
): string {
  if (kind === 'tableros' || kind === 'cintillas' || kind === 'herrajes') {
    return stockUnitLabel(kind, hardwareUnit);
  }
  return 'u';
}
