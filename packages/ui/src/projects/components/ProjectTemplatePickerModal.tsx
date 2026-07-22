/**
 * Project template picker modal (#110 / H15). Extracted from ProjectsScreen.tsx
 * (F058a).
 *
 * Two-step flow: first pick a template from the list, then fill in name +
 * customer. Owns the in-session draft state (selected template / name /
 * customer / error). Parent passes the available templates + customers and
 * receives the validated (templateId, draft) on confirm.
 */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { LayoutTemplate } from 'lucide-react';
import type { Customer, ProjectTemplate, WorkshopSettings } from '@muebles/domain';
import { Modal } from '../../common';
import {
  emptyProjectDraft,
  type ProjectDraft,
} from '../projectHelpers';

export interface ProjectTemplatePickerConfirmPayload {
  readonly templateId: string;
  readonly draft: ProjectDraft;
}

export interface ProjectTemplatePickerModalProps {
  readonly open: boolean;
  readonly templates: readonly ProjectTemplate[];
  readonly customers: readonly Customer[];
  /** Workshop defaults used to seed the draft payload (F031). */
  readonly workshopSettings: WorkshopSettings | null;
  readonly onClose: () => void;
  /** Receives the validated templateId + ProjectDraft. Parent routes to
   * onCreateFromTemplate and closes the modal. */
  readonly onConfirm: (payload: ProjectTemplatePickerConfirmPayload) => void;
}

export function ProjectTemplatePickerModal({
  open,
  templates,
  customers,
  workshopSettings,
  onClose,
  onConfirm,
}: ProjectTemplatePickerModalProps): ReactNode {
  const [fromTemplateDraft, setFromTemplateDraft] =
    useState<ProjectTemplate | null>(null);
  const [fromTemplateName, setFromTemplateName] = useState('');
  const [fromTemplateCustomer, setFromTemplateCustomer] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset internal state only on the closed → open transition so an in-flight
  // session is never clobbered by a parent re-render.
  const prevOpen = useRef(open);
  useEffect(() => {
    if (!prevOpen.current && open) {
      setFromTemplateDraft(null);
      setFromTemplateName('');
      setFromTemplateCustomer('');
      setError(null);
    }
    prevOpen.current = open;
  }, [open]);

  const pickTemplate = (template: ProjectTemplate) => {
    setFromTemplateDraft(template);
    setFromTemplateName(`${template.name}`);
    setFromTemplateCustomer('');
  };

  function confirmFromTemplate(e: FormEvent) {
    e.preventDefault();
    if (!fromTemplateDraft) return;
    const name = fromTemplateName.trim();
    if (!name) {
      setError('Elegí un nombre para la cotización.');
      return;
    }
    const customerId = fromTemplateCustomer.trim();
    if (!customerId) {
      setError('Elegí un cliente.');
      return;
    }
    // Reuse ProjectDraft shape so the shell handles currency/margin/labor via
    // the same path as createProject. Name + customerId are the template picks.
    const draft: ProjectDraft = {
      ...emptyProjectDraft(workshopSettings),
      name,
      customerId,
      currency: fromTemplateDraft.currency,
      marginFactor: String(fromTemplateDraft.marginFactor),
      laborFixedCost: String(fromTemplateDraft.laborFixedCost),
      notes: fromTemplateDraft.notes ?? '',
      status: 'draft',
    };
    setError(null);
    onConfirm({ templateId: fromTemplateDraft.id, draft });
    setFromTemplateDraft(null);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setFromTemplateDraft(null);
        onClose();
      }}
      title="Crear cotización desde plantilla"
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFromTemplateDraft(null);
              onClose();
            }}
          >
            Cancelar
          </button>
          {fromTemplateDraft ? (
            <button
              type="submit"
              form="from-template-form"
              className="btn btn--primary"
            >
              Crear cotización
            </button>
          ) : null}
        </>
      }
    >
      {!fromTemplateDraft ? (
        <ul
          className="template-picker-list"
          data-testid="template-picker-list"
        >
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="template-picker-item"
                onClick={() => pickTemplate(t)}
                data-testid={`template-pick-${t.id}`}
              >
                <LayoutTemplate size={18} strokeWidth={1.5} aria-hidden />
                <span className="template-picker-item__name">{t.name}</span>
                <span className="template-picker-item__meta">
                  {t.items.length} mueble{t.items.length === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form id="from-template-form" onSubmit={confirmFromTemplate}>
          <p className="project-editor__hint" style={{ marginBottom: 'var(--space-3)' }}>
            Plantilla: <strong>{fromTemplateDraft.name}</strong> ·{' '}
            {fromTemplateDraft.items.length} mueble
            {fromTemplateDraft.items.length === 1 ? '' : 's'}
          </p>
          <div className="catalog-form__field">
            <label htmlFor="from-template-name">Nombre de la cotización</label>
            <input
              id="from-template-name"
              value={fromTemplateName}
              onChange={(e) => setFromTemplateName(e.target.value)}
              required
              data-testid="from-template-name"
            />
          </div>
          <div className="catalog-form__field">
            <label htmlFor="from-template-customer">Cliente</label>
            <select
              id="from-template-customer"
              value={fromTemplateCustomer}
              onChange={(e) => setFromTemplateCustomer(e.target.value)}
              required
              data-testid="from-template-customer"
            >
              <option value="">Elegí un cliente…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {error ? (
            <p className="project-editor__error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
