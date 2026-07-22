/**
 * Project create/edit metadata modal (F022 / #15). Extracted from
 * ProjectsScreen.tsx (F058a).
 *
 * Owns the in-session draft state (draft / newCustomerMode / error) so the
 * parent only tracks `open` + `editingId` + computes the `initialDraft`.
 * The modal resets its internal state every time it transitions from closed
 * to open, matching the previous "reset on open" semantics of the screen.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Customer } from '@muebles/domain';
import { CatalogPicker } from '../../catalogs/CatalogPicker';
import { Modal } from '../../common';
import {
  customersForProjectPicker,
  projectStatusLabel,
  statusOptionsForRole,
  validateProjectDraft,
  type ProjectDraft,
} from '../projectHelpers';

export interface ProjectMetaModalProps {
  readonly open: boolean;
  /** Project id being edited; null = create flow (drives the modal title). */
  readonly editingId: string | null;
  /** Draft used to seed the form on open. Parent computes this from
   * workshopSettings (create) or projectToDraft (edit). */
  readonly initialDraft: ProjectDraft;
  readonly onClose: () => void;
  /** Receives the validated, normalized payload. Parent routes to
   * onCreate / onUpdate based on editingId, then closes the modal. */
  readonly onSubmit: (payload: ProjectDraft) => void;
  readonly customers: readonly Customer[];
  /** F034: admin can pick portfolio owner on create/edit. */
  readonly canAssignOwner: boolean;
  readonly assignableOwners: readonly {
    readonly id: string;
    readonly name: string;
    readonly role?: string;
  }[];
  /** F039: hide margin/cost fields. */
  readonly showCosts: boolean;
  /** Status <option> set depends on role caps (F035 / F036). */
  readonly canMutate: boolean;
  readonly canReopen: boolean;
  readonly canMarkProduced: boolean;
}

export function ProjectMetaModal({
  open,
  editingId,
  initialDraft,
  onClose,
  onSubmit,
  customers,
  canAssignOwner,
  assignableOwners,
  showCosts,
  canMutate,
  canReopen,
  canMarkProduced,
}: ProjectMetaModalProps): ReactNode {
  const formId = useId();
  const [draft, setDraft] = useState<ProjectDraft>(initialDraft);
  /** When true, meta form uses free-text name to create a customer on submit. */
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset internal state only on the closed → open transition so the user's
  // in-progress edits are never clobbered by a parent re-render.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (!prevOpen.current && open) {
      setDraft(initialDraft);
      setNewCustomerMode(false);
      setError(null);
    }
    prevOpen.current = open;
  }, [open, initialDraft]);

  const pickerCustomers = customersForProjectPicker(
    customers,
    draft.customerId,
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: ProjectDraft = newCustomerMode
      ? {
          ...draft,
          customerId: '',
          customerName: (draft.customerName ?? '').trim(),
        }
      : {
          ...draft,
          customerId: draft.customerId.trim(),
          customerName: '',
        };
    const err = validateProjectDraft(payload);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onSubmit(payload);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId ? 'Editar cotización' : 'Nueva cotización'}
      size="md"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" form={formId}>
            Guardar
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form catalog-form--wide project-meta-form"
        onSubmit={handleSubmit}
      >
        {error ? <p className="catalog-form__error">{error}</p> : null}
        <div className="project-editor__grid">
          <div className="catalog-form__field">
            <label htmlFor="prj-name">Nombre</label>
            <input
              id="prj-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              required
              autoComplete="off"
            />
          </div>
          <div className="catalog-form__field">
            {newCustomerMode ? (
              <>
                <label htmlFor="prj-client">Cliente</label>
                <input
                  id="prj-client"
                  value={draft.customerName ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      customerId: '',
                      customerName: e.target.value,
                    })
                  }
                  placeholder="Nombre del nuevo cliente"
                  autoComplete="organization"
                />
              </>
            ) : (
              <CatalogPicker
                id="prj-client"
                label="Cliente"
                placeholder="Seleccionar cliente…"
                searchPlaceholder="Buscar cliente…"
                value={draft.customerId}
                onChange={(customerId) =>
                  setDraft({
                    ...draft,
                    customerId,
                    customerName: '',
                  })
                }
                items={pickerCustomers.map((c) => ({
                  id: c.id,
                  code: '',
                  name: c.name,
                  active: c.active,
                  subtitle: c.email || undefined,
                }))}
                data-testid="project-customer-picker"
              />
            )}
            <div className="catalog-form__field catalog-form__row-check">
              <input
                id="prj-new-client"
                type="checkbox"
                checked={newCustomerMode}
                onChange={(e) => {
                  const next = e.target.checked;
                  setNewCustomerMode(next);
                  setDraft({
                    ...draft,
                    customerId: next ? '' : draft.customerId,
                    customerName: next ? (draft.customerName ?? '') : '',
                  });
                }}
              />
              <label htmlFor="prj-new-client">Nuevo cliente</label>
            </div>
          </div>
          <div className="catalog-form__field">
            <label htmlFor="prj-currency">Moneda</label>
            <input
              id="prj-currency"
              value={draft.currency}
              onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              required
            />
          </div>
          {showCosts ? (
            <>
              <div className="catalog-form__field">
                <label htmlFor="prj-margin">Factor de margen</label>
                <input
                  id="prj-margin"
                  type="number"
                  min={0.01}
                  step="any"
                  value={draft.marginFactor}
                  onChange={(e) =>
                    setDraft({ ...draft, marginFactor: e.target.value })
                  }
                  required
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor="prj-labor">Mano de obra fija</label>
                <input
                  id="prj-labor"
                  type="number"
                  min={0}
                  step="any"
                  value={draft.laborFixedCost}
                  onChange={(e) =>
                    setDraft({ ...draft, laborFixedCost: e.target.value })
                  }
                  required
                />
              </div>
            </>
          ) : null}
          <div className="catalog-form__field">
            <label htmlFor="prj-status">Estado</label>
            <select
              id="prj-status"
              value={draft.status}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  status: e.target.value as ProjectDraft['status'],
                })
              }
            >
              {statusOptionsForRole({
                current: draft.status,
                canMutate,
                canReopen,
                canMarkProduced,
              }).map((s) => (
                <option key={s} value={s}>
                  {projectStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {canAssignOwner && assignableOwners.length > 0 ? (
          <div
            className="catalog-form__field"
            style={{ marginTop: 'var(--space-3)' }}
          >
            <label htmlFor="prj-owner">Responsable</label>
            <select
              id="prj-owner"
              value={draft.ownerUserId}
              onChange={(e) =>
                setDraft({ ...draft, ownerUserId: e.target.value })
              }
              data-testid="project-owner-select"
            >
              {assignableOwners.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.role ? ` (${u.role})` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="catalog-form__field" style={{ marginTop: 'var(--space-3)' }}>
          <label htmlFor="prj-notes">Notas</label>
          <input
            id="prj-notes"
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
      </form>
    </Modal>
  );
}
