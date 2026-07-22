/**
 * Templates management modal (#110). Extracted from ProjectsScreen.tsx (F058a).
 */

import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { ProjectTemplate } from '@muebles/domain';
import { Modal } from '../../common';

export function ProjectTemplatesManagementModal({
  open,
  templates,
  onClose,
  onDeleteTemplate,
}: {
  readonly open: boolean;
  readonly templates: readonly ProjectTemplate[];
  readonly onClose: () => void;
  readonly onDeleteTemplate: (templateId: string) => void;
}): ReactNode {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Plantillas de proyecto"
      size="md"
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      <ul
        className="template-picker-list"
        data-testid="template-management-list"
      >
        {templates.map((t) => (
          <li key={t.id} className="template-management-row">
            <span className="template-management-row__name">{t.name}</span>
            <span className="template-management-row__meta">
              {t.items.length} mueble{t.items.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              className="btn btn--small btn--danger"
              onClick={() => onDeleteTemplate(t.id)}
              data-testid={`delete-template-${t.id}`}
            >
              <Trash2 size={14} strokeWidth={1.5} aria-hidden />
              Borrar
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
