/**
 * Confirm reopen project modal (F036). Extracted from ProjectsScreen.tsx (F058a).
 */

import type { ReactNode } from 'react';
import { Modal } from '../../common';

export function ProjectConfirmReopenModal({
  open,
  projectName,
  onCancel,
  onConfirm,
}: {
  readonly open: boolean;
  readonly projectName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): ReactNode {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Reabrir cotización"
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onConfirm}
            data-testid="project-reopen-confirm"
          >
            Reabrir
          </button>
        </>
      }
    >
      <p className="project-confirm-modal__text">
        ¿Reabrir <strong>{projectName || 'esta cotización'}</strong> a
        borrador? Se borra el snapshot de precios congelados y vuelve a
        recalcular con el catálogo actual.
      </p>
    </Modal>
  );
}
