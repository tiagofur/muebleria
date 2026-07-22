/**
 * Confirm delete project modal. Extracted from ProjectsScreen.tsx (F058a).
 */

import type { ReactNode } from 'react';
import { Modal } from '../../common';

export function ProjectConfirmDeleteModal({
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
      title="Eliminar cotización"
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm}>
            Eliminar
          </button>
        </>
      }
    >
      <p className="project-confirm-modal__text">
        ¿Seguro que querés eliminar{' '}
        <strong>{projectName || 'esta cotización'}</strong>? Esta acción no se
        puede deshacer.
      </p>
    </Modal>
  );
}
