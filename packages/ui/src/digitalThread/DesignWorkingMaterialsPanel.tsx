import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Layers, RefreshCw, TriangleAlert } from 'lucide-react';
import type { MaterialBoard } from '@granete/domain';
import {
  GraneteApiClient,
  GraneteApiError,
  newIdempotencyKey,
  type DesignWorkingItemMaterialProvenance,
  type DesignWorkingMaterialsReconciliation,
  type FurnitureInstance,
  type MaterialProvenanceStatus,
} from '@granete/storage';
import { Modal } from '../common';
import type { ProjectDesignsQueryKeys } from './ProjectDesignsScreen';
import './digitalThread.css';

/**
 * #658 — Reconciliar materiales pendientes del Design Working Copy.
 *
 * Presenta el read model server-side de material provenance (#638) y permite
 * confirmar, por unidad individual, el command canónico
 * `working-copy/material-choices:reconcile`. El servidor clasifica; esta
 * superficie sólo presenta verdad server-side e invoca el comando existente:
 *
 * - `quoted_missing_from_working` es el único candidato reparable;
 * - `authored` / `inherited_default` nunca se sobrescriben (se muestran como
 *   contexto de la unidad, sin acción);
 * - la fuente cotizada es la línea current del Project: se comunica como
 *   "material cotizado actual", nunca como revisión histórica aceptada;
 * - la reparación muta únicamente el Working Copy; publicar una DesignRevision
 *   sigue siendo una acción explícita separada.
 *
 * Late responses: cada intención captura un context receipt (session/tenant
 * scope vía query keys + projectId + designId, ver `contextReceipt`). Success,
 * error y 409 se descartan completos si el receipt vivo cambió — no aplican
 * setUnitState, modal ni invalidaciones del contexto nuevo.
 */

const PROVENANCE_LABELS: Record<MaterialProvenanceStatus, string> = {
  authored: 'Elegido en el diseño',
  quoted_missing_from_working: 'Cotizado, falta en el borrador',
  inherited_default: 'Heredado del diseño',
  missing_unresolved: 'Sin resolver',
};

const PROVENANCE_BADGE_CLASS: Record<MaterialProvenanceStatus, string> = {
  authored: 'status-badge--done',
  quoted_missing_from_working: 'status-badge--warning',
  inherited_default: 'status-badge--draft',
  missing_unresolved: 'status-badge--cancelled',
};

/** #641 — request truth: a failed request is never business absence. */
function describeRequestFailure(err: unknown): string {
  if (err instanceof GraneteApiError) {
    if (err.status === 401) {
      return 'Tu sesión no es válida o expiró. Volvé a iniciar sesión e intentá de nuevo.';
    }
    if (err.status === 403 || err.code === 'FORBIDDEN') {
      return 'No tenés permiso para consultar esta información.';
    }
  }
  return 'No se pudo contactar el servidor. Verificá tu conexión e intentá de nuevo.';
}

function describeRepairFailure(err: unknown): string {
  if (err instanceof GraneteApiError) {
    if (err.status === 401) {
      return 'Tu sesión no es válida o expiró. Volvé a iniciar sesión e intentá de nuevo.';
    }
    if (err.status === 403 || err.code === 'FORBIDDEN') {
      return 'No tenés permiso para editar el diseño de esta obra.';
    }
    if (err.status === 404) {
      return 'La unidad ya no forma parte del borrador de este diseño.';
    }
  }
  return 'No se pudo aplicar la reparación. Verificá tu conexión e intentá de nuevo.';
}

function isConflictError(err: unknown): boolean {
  return err instanceof GraneteApiError && (err.status === 409 || err.code === 'CONFLICT');
}

type UnitRepairState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirming' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'succeeded'; readonly filledCount: number }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * #658 review — context receipt of one reconciliation intention.
 *
 * Reuses the exact session/tenant identity the screen already bakes into its
 * query keys (`projectDesignsQueryKeys(sessionScopeKey, projectId)` → root
 * `['project-designs', ...scope, projectId]`): no JWT parsing, no parallel
 * session authority. Adding designId pins the exact working copy. A response
 * whose captured receipt no longer equals the live one is discarded — success,
 * error and 409 alike — before touching local state or invalidating queries.
 */
function contextReceipt(
  queryKeys: ProjectDesignsQueryKeys,
  projectId: string,
  designId: string,
): string {
  return JSON.stringify([...queryKeys.root, projectId, designId]);
}

export interface DesignWorkingMaterialsPanelProps {
  readonly api: GraneteApiClient;
  readonly token: string;
  readonly projectId: string;
  readonly designId: string;
  readonly canMutate: boolean;
  readonly queryKeys: ProjectDesignsQueryKeys;
  /** Catálogo del workspace para resolver material id → nombre (presentación). */
  readonly catalogMaterials?: readonly MaterialBoard[];
}

interface MaterialLabel {
  readonly name: string;
  readonly code: string | null;
}

function resolveMaterialLabel(
  materials: readonly MaterialBoard[] | undefined,
  materialId: string | null | undefined,
): MaterialLabel | null {
  if (!materialId) return null;
  const found = materials?.find((m) => m.id === materialId);
  if (!found) return null;
  return { name: found.name, code: found.code };
}

export function DesignWorkingMaterialsPanel({
  api,
  token,
  projectId,
  designId,
  canMutate,
  queryKeys,
  catalogMaterials,
}: DesignWorkingMaterialsPanelProps): React.ReactNode {
  const queryClient = useQueryClient();
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [unitStates, setUnitStates] = useState<Record<string, UnitRepairState>>({});
  const idempotencyKeys = useRef(new Map<string, string>());
  const inFlightUnits = useRef(new Set<string>());

  // #658 review: the active context receipt updates SYNCHRONOUSLY with
  // render/props — never via useEffect — so there is no window where the ref
  // still represents the previous session/project/design. A change discards
  // every local intention of the old surface (modal, unit states, idempotency
  // keys, single-flight guards); server-side commands already issued stay
  // untouched and their results are dropped on arrival.
  const receipt = contextReceipt(queryKeys, projectId, designId);
  const activeContextRef = useRef(receipt);
  if (activeContextRef.current !== receipt) {
    activeContextRef.current = receipt;
    idempotencyKeys.current.clear();
    inFlightUnits.current.clear();
    setIsReviewOpen(false);
    setUnitStates({});
  }

  const provenanceQuery = useQuery({
    queryKey: queryKeys.designMaterialProvenance(designId),
    queryFn: ({ signal }) => api.getDesignWorkingCopyMaterialProvenance(token, designId, signal),
  });
  const provenance = provenanceQuery.data ?? null;

  const candidates = useMemo(
    () => (provenance?.items ?? []).filter((item) => item.reconcilable),
    [provenance],
  );

  // Nombres de unidad: presentación server-side del Project (#389 display),
  // jamás identidad derivada de UUID.
  const instancesQuery = useQuery({
    queryKey: queryKeys.furnitureInstances,
    queryFn: ({ signal }) => api.listProjectFurnitureInstances(token, projectId, signal),
    enabled: candidates.length > 0,
  });
  const instancesByName = useMemo(() => {
    const map = new Map<string, FurnitureInstance>();
    for (const instance of instancesQuery.data ?? []) {
      map.set(instance.id, instance);
    }
    return map;
  }, [instancesQuery.data]);

  // El read-back tras una reparación reemplaza la proyección completa: los
  // estados de éxito confirmados de la proyección anterior ya no aplican.
  useEffect(() => {
    setUnitStates((current) => {
      let changed = false;
      const next: Record<string, UnitRepairState> = {};
      for (const [key, state] of Object.entries(current)) {
        if (state.kind === 'succeeded') {
          changed = true;
          next[key] = { kind: 'idle' };
        } else {
          next[key] = state;
        }
      }
      return changed ? next : current;
    });
  }, [provenance]);

  const setUnitState = (unitId: string, state: UnitRepairState) => {
    setUnitStates((current) => ({ ...current, [unitId]: state }));
  };

  const handleConfirm = (unitId: string) => {
    setUnitState(unitId, { kind: 'confirming' });
  };

  const handleCancel = (unitId: string) => {
    idempotencyKeys.current.delete(unitId);
    setUnitState(unitId, { kind: 'idle' });
  };

  const submitRepair = async (unitId: string) => {
    // Single-flight: un segundo click mientras la intención viaja nunca emite
    // un segundo comando.
    if (inFlightUnits.current.has(unitId)) return;
    inFlightUnits.current.add(unitId);

    // Context receipt + contexto exacto capturados al iniciar la intención:
    // sesión/tenant scope (vía query keys), projectId y designId. Toda
    // respuesta se compara contra el receipt vivo antes de aplicarse.
    const startContext = activeContextRef.current;
    const startDesignId = designId;
    const startQueryKeys = queryKeys;
    const startQueryClient = queryClient;
    const startProvenance = provenance;
    // La misma intención reutiliza la misma key; una intención nueva (tras
    // éxito, conflicto o cancelación) genera una nueva.
    let key = idempotencyKeys.current.get(unitId);
    if (!key) {
      key = newIdempotencyKey();
      idempotencyKeys.current.set(unitId, key);
    }
    // Token de concurrencia exacto de la proyección que el usuario revisó.
    const expectedUpdatedAt = startProvenance?.working_copy_updated_at ?? null;
    setUnitState(unitId, { kind: 'submitting' });

    let result: DesignWorkingMaterialsReconciliation;
    try {
      result = await api.reconcileDesignWorkingMaterials(
        token,
        startDesignId,
        { furniture_instance_id: unitId, expected_updated_at: expectedUpdatedAt },
        key,
      );
    } catch (err) {
      // Respuesta del contexto anterior: se descarta completa (éxito, error y
      // conflicto por igual). Ni setUnitState ni el guard single-flight del
      // contexto nuevo deben tocarse desde una intención vieja.
      if (activeContextRef.current !== startContext) return;
      inFlightUnits.current.delete(unitId);
      if (isConflictError(err)) {
        idempotencyKeys.current.delete(unitId);
        setUnitState(unitId, { kind: 'conflict' });
      } else {
        setUnitState(unitId, { kind: 'failed', message: describeRepairFailure(err) });
      }
      return;
    }
    if (activeContextRef.current !== startContext) return; // respuesta tardía de otro contexto
    inFlightUnits.current.delete(unitId);
    idempotencyKeys.current.delete(unitId);
    setUnitState(unitId, { kind: 'succeeded', filledCount: Object.keys(result.filled_choices).length });
    // Read-back sólo a través de las proyecciones canónicas del MISMO contexto:
    // nunca fabricamos el estado localmente antes de confirmación server-side.
    await startQueryClient.invalidateQueries({ queryKey: startQueryKeys.designMaterialProvenance(startDesignId) });
    await startQueryClient.invalidateQueries({ queryKey: startQueryKeys.designWorkingCopy(startDesignId) });
  };

  const handleReload = async () => {
    // Conflicto: recargar y revisar nuevamente — nunca sobrescritura ciega.
    setUnitStates({});
    idempotencyKeys.current.clear();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.designMaterialProvenance(designId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.designWorkingCopy(designId) }),
    ]);
  };

  const hasCandidates = candidates.length > 0;
  const provenanceFailed = provenanceQuery.isError && !hasCandidates;

  // Fuera del modal de revisión, un fallo de lectura es un error explícito
  // (nunca ausencia) y la ausencia de candidatos no renderiza nada.
  if (!isReviewOpen && provenanceQuery.isLoading && !provenance) {
    return (
      <p className="pd-materials-status" role="status" data-testid="materials-provenance-loading">
        Revisando materiales del borrador…
      </p>
    );
  }

  if (!isReviewOpen && provenanceFailed) {
    return (
      <div className="pd-materials-strip pd-materials-strip--error" role="alert" data-testid="materials-provenance-error">
        <div className="pd-materials-strip__info">
          <TriangleAlert size={18} strokeWidth={1.5} className="pd-materials-strip__icon" />
          <div>
            <strong>No se pudo revisar los materiales del borrador.</strong>{' '}
            <span>{describeRequestFailure(provenanceQuery.error)}</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn--small"
          data-testid="retry-materials-btn"
          onClick={() => void provenanceQuery.refetch()}
        >
          Reintentar
        </button>
      </div>
    );
  }

  // Sin candidatos y sin revisión abierta no hay nada que presentar. El modal
  // de revisión, en cambio, permanece montado tras el read-back para cerrar
  // honestamente con el estado vacío (o el error de la relectura).
  if (!isReviewOpen && !hasCandidates) return null;

  const unitLabel = (item: DesignWorkingItemMaterialProvenance, index: number): string => {
    const instance = instancesByName.get(item.furniture_instance_id);
    return instance?.display?.name?.trim() || `Unidad ${index + 1}`;
  };

  const materialText = (materialId: string | null | undefined): string => {
    const label = resolveMaterialLabel(catalogMaterials, materialId);
    return label ? label.name : 'Material no disponible en el catálogo';
  };

  return (
    <>
      {hasCandidates && (
        <div className="pd-materials-strip" data-testid="pending-materials-strip">
          <div className="pd-materials-strip__info">
            <Layers size={18} strokeWidth={1.5} className="pd-materials-strip__icon" />
            <div>
              <strong>Materiales pendientes:</strong>{' '}
              <span>
                {candidates.length} {candidates.length === 1 ? 'mueble tiene' : 'muebles tienen'} materiales
                cotizados que faltan en el borrador.
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn--small"
            data-testid="review-pending-materials-btn"
            onClick={() => setIsReviewOpen(true)}
          >
            Revisar materiales pendientes
          </button>
          {provenanceQuery.isError && (
            <span className="pd-materials-strip__stale" role="alert">
              No se pudo actualizar; se muestra la última versión conocida.
              <button
                type="button"
                className="btn btn--small"
                data-testid="retry-materials-btn"
                onClick={() => void provenanceQuery.refetch()}
              >
                Reintentar
              </button>
            </span>
          )}
        </div>
      )}

      {isReviewOpen && (
        <Modal
          open
          onClose={() => setIsReviewOpen(false)}
          title="Materiales pendientes del borrador"
          size="md"
          dataTestId="pending-materials-modal"
        >
          <div className="pd-materials-modal">
            <p className="pd-materials-modal__intro">
              Estas unidades tienen materiales cotizados en la obra que el borrador de diseño no define. Reparar
              copia esas elecciones al diseño en trabajo; no modifica las elecciones ya definidas ni las revisiones
              publicadas. Publicar una nueva revisión es una acción aparte.
            </p>

            {provenanceFailed ? (
              <div className="pd-alert pd-alert--error" role="alert" data-testid="materials-provenance-error">
                <p>No se pudo actualizar los materiales del borrador.</p>
                <p>{provenanceQuery.error ? describeRequestFailure(provenanceQuery.error) : ''}</p>
                <button
                  type="button"
                  className="btn btn--small"
                  data-testid="retry-materials-btn"
                  onClick={() => void provenanceQuery.refetch()}
                >
                  Reintentar
                </button>
              </div>
            ) : candidates.length === 0 ? (
              <p className="pd-empty-hint" data-testid="pending-materials-empty">
                No quedan materiales pendientes en el borrador.
              </p>
            ) : (
              <ul className="pd-pending-units">
                {candidates.map((item, index) => {
                  const unitId = item.furniture_instance_id;
                  const state = unitStates[unitId] ?? { kind: 'idle' };
                  const label = unitLabel(item, index);
                  const pendingRoles = item.roles.filter(
                    (role) => role.provenance === 'quoted_missing_from_working',
                  );
                  return (
                    <li key={unitId} className="pd-pending-unit" data-testid={`pending-unit-${unitId}`}>
                      <div className="pd-pending-unit__header">
                        <strong>{label}</strong>
                        <span className="pd-pending-unit__count">
                          {pendingRoles.length} {pendingRoles.length === 1 ? 'pendiente' : 'pendientes'}
                        </span>
                      </div>

                      <ul className="pd-pending-roles">
                        {item.roles.map((role) => (
                          <li key={role.role} className="pd-pending-role" data-testid={`pending-role-${unitId}-${role.role}`}>
                            <span className="pd-code-pill">{role.role}</span>
                            <span className={`status-badge ${PROVENANCE_BADGE_CLASS[role.provenance]}`}>
                              {PROVENANCE_LABELS[role.provenance]}
                            </span>
                            <span className="pd-pending-role__value">
                              {role.provenance === 'quoted_missing_from_working'
                                ? `Material cotizado actual: ${materialText(role.quoted_choice)}`
                                : role.provenance === 'authored'
                                  ? materialText(role.working_choice)
                                  : role.provenance === 'inherited_default'
                                    ? materialText(role.effective_choice)
                                    : 'Sin material definido'}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {state.kind === 'succeeded' ? (
                        <p className="pd-pending-unit__result" role="status" data-testid={`repair-success-${unitId}`}>
                          <CheckCircle2 size={14} strokeWidth={1.5} />
                          {state.filledCount > 0
                            ? `Reparación aplicada: ${state.filledCount} ${state.filledCount === 1 ? 'elección añadida' : 'elecciones añadidas'} al borrador.`
                            : 'Sin cambios pendientes para esta unidad.'}
                        </p>
                      ) : state.kind === 'conflict' ? (
                        <div className="pd-alert pd-alert--warning" role="alert" data-testid={`repair-conflict-${unitId}`}>
                          <span>
                            El diseño cambió mientras revisabas los materiales; la reparación no se aplicó.
                          </span>
                          <button
                            type="button"
                            className="btn btn--small"
                            data-testid="reload-materials-btn"
                            onClick={() => void handleReload()}
                          >
                            Recargar materiales
                          </button>
                        </div>
                      ) : state.kind === 'failed' ? (
                        <div className="pd-alert pd-alert--error" role="alert" data-testid={`repair-error-${unitId}`}>
                          <span>{state.message}</span>
                          <button
                            type="button"
                            className="btn btn--small"
                            data-testid={`retry-repair-${unitId}`}
                            onClick={() => void submitRepair(unitId)}
                          >
                            Reintentar
                          </button>
                          <button
                            type="button"
                            className="btn btn--small btn--ghost"
                            onClick={() => handleCancel(unitId)}
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : state.kind === 'confirming' || state.kind === 'submitting' ? (
                        <div className="pd-pending-unit__confirm" data-testid={`repair-confirm-${unitId}`}>
                          <p className="pd-pending-unit__confirm-title">
                            Se añadirá al borrador de {label}:
                          </p>
                          <ul>
                            {pendingRoles.map((role) => (
                              <li key={role.role}>
                                <span className="pd-code-pill">{role.role}</span> →{' '}
                                {materialText(role.quoted_choice)} (material cotizado actual)
                              </li>
                            ))}
                          </ul>
                          <p className="pd-pending-unit__confirm-hint">
                            Las elecciones ya definidas no se modifican.
                          </p>
                          <div className="pd-pending-unit__actions">
                            <button
                              type="button"
                              className="btn btn--small"
                              disabled={state.kind === 'submitting'}
                              onClick={() => handleCancel(unitId)}
                              autoFocus
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              className="btn btn--small btn--primary"
                              disabled={state.kind === 'submitting'}
                              data-testid={`confirm-repair-${unitId}`}
                              onClick={() => void submitRepair(unitId)}
                            >
                              {state.kind === 'submitting' ? (
                                <>
                                  <RefreshCw size={14} strokeWidth={1.5} className="spin" />
                                  Aplicando…
                                </>
                              ) : (
                                'Aplicar reparación'
                              )}
                            </button>
                          </div>
                        </div>
                      ) : canMutate ? (
                        <div className="pd-pending-unit__actions">
                          <button
                            type="button"
                            className="btn btn--small"
                            data-testid={`repair-unit-${unitId}`}
                            onClick={() => handleConfirm(unitId)}
                          >
                            Reparar
                          </button>
                        </div>
                      ) : (
                        <p className="pd-pending-unit__readonly">
                          Necesitás permisos de edición para reparar este mueble.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
