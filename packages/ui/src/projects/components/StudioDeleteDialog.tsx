/**
 * Diálogo de alcance de eliminación del studio de Proyectar.
 *
 * Eliminar desde el editor 3D es ambiguo por diseño: el plano y la lista de
 * muebles de la obra son fuentes distintas (North Star §13: los ítems no
 * colocados están claramente separados del espacio físico). El diálogo hace
 * explícita la intención antes de destruir: ¿sólo del plano o también de la
 * cotización? Los blockers/explicaciones enseñan la consecuencia de cada
 * alcance (docs/design.md: confirmaciones que explican cómo resolverse).
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../common';

export type StudioDeleteScope = 'plan' | 'project';

export type StudioDeleteTarget = {
  readonly itemId: string;
  readonly code: string;
  readonly name: string;
  /** Copias de la línea en la cotización (quantity): todas se quitan juntas. */
  readonly quantity: number;
  /** Colocaciones en otros ambientes además del activo (scope proyecto las quita). */
  readonly otherSpacesPlacements: number;
};

export type StudioDeleteDialogProps = {
  readonly open: boolean;
  readonly targets: readonly StudioDeleteTarget[];
  /** Alguna instancia seleccionada está colocada en el plano (scope 3D aplica). */
  readonly hasPlacedSelection: boolean;
  /** La obra permite quitar ítems de la cotización (onRemoveItem disponible). */
  readonly canRemoveFromProject: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (scope: StudioDeleteScope) => void;
};

export function StudioDeleteDialog({
  open,
  targets,
  hasPlacedSelection,
  canRemoveFromProject,
  onCancel,
  onConfirm,
}: StudioDeleteDialogProps): ReactNode {
  const defaultScope: StudioDeleteScope = hasPlacedSelection ? 'plan' : 'project';
  const [scope, setScope] = useState<StudioDeleteScope>(defaultScope);

  // Al (re)abrir el diálogo vuelve al alcance default del contexto actual.
  useEffect(() => {
    if (open) setScope(defaultScope);
  }, [open, defaultScope]);

  if (targets.length === 0) return null;

  const label =
    targets.length === 1
      ? targets[0]!.code === '—'
        ? targets[0]!.name
        : `${targets[0]!.code} · ${targets[0]!.name}`
      : `${targets.length} muebles`;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={targets.length === 1 ? 'Eliminar mueble' : 'Eliminar muebles'}
      size="sm"
      dataTestId="studio-delete-dialog"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={onCancel}
            data-testid="studio-delete-cancel"
          >
            Cancelar
          </button>
          <button
            type="button"
            className={
              scope === 'project' ? 'btn btn--danger' : 'btn btn--primary'
            }
            disabled={scope === 'project' && !canRemoveFromProject}
            onClick={() => onConfirm(scope)}
            data-testid="studio-delete-confirm"
          >
            {scope === 'project' ? 'Eliminar del proyecto' : 'Quitar del plano'}
          </button>
        </>
      }
    >
      <p className="studio-delete-dialog__lead">
        ¿Qué querés eliminar de <strong>{label}</strong>?
      </p>
      <div className="studio-delete-dialog__options" role="radiogroup" aria-label="Alcance de la eliminación">
        {hasPlacedSelection ? (
          <label className="studio-delete-dialog__option" data-testid="studio-delete-option-plan">
            <input
              type="radio"
              name="studio-delete-scope"
              checked={scope === 'plan'}
              onChange={() => setScope('plan')}
            />
            <span>
              <strong>Sólo del plano 3D</strong>
              <small>
                Los muebles quedan en la lista de muebles de la obra, sin colocar.
                Podés volver a colocarlos cuando quieras.
              </small>
            </span>
          </label>
        ) : null}
        <label
          className={
            canRemoveFromProject
              ? 'studio-delete-dialog__option'
              : 'studio-delete-dialog__option studio-delete-dialog__option--blocked'
          }
          data-testid="studio-delete-option-project"
        >
          <input
            type="radio"
            name="studio-delete-scope"
            checked={scope === 'project'}
            disabled={!canRemoveFromProject}
            onChange={() => setScope('project')}
          />
          <span>
            <strong>Del proyecto (lista de muebles)</strong>
            <small>
              {canRemoveFromProject
                ? 'Se quita la línea de la cotización con todas sus copias y se actualizan precio y BOM de la obra.'
                : 'La obra no permite quitar muebles de la cotización en este estado.'}
            </small>
          </span>
        </label>
      </div>
      {scope === 'project' && canRemoveFromProject ? (
        <ul className="studio-delete-dialog__targets" data-testid="studio-delete-targets">
          {targets.map((t) => (
            <li key={t.itemId}>
              <span>
                {t.code === '—' ? t.name : `${t.code} · ${t.name}`}
                {t.quantity > 1 ? ` (×${t.quantity})` : ''}
              </span>
              {t.otherSpacesPlacements > 0 ? (
                <small>
                  {' '}
                  también colocado en {t.otherSpacesPlacements}{' '}
                  ambiente{t.otherSpacesPlacements === 1 ? '' : 's'} más
                </small>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
