/**
 * ConfirmDialog — confirmation for destructive/irreversible actions
 * (design.md §4.3). Replaces native `window.confirm` so the pattern keeps
 * the app's modal vocabulary, focus trap and styling.
 */

import { Modal } from './Modal';
import './confirmDialog.css';

export type ConfirmDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Dialog title, e.g. «Eliminar material». */
  readonly title: string;
  /** What happens on confirm — specific, plain Spanish, no jargon. */
  readonly message: string;
  /** Confirm callback. */
  readonly onConfirm: () => void;
  /** `danger` (destructive, red confirm) or `primary`. Defaults to danger. */
  readonly tone?: 'danger' | 'primary';
  /** Confirm label; defaults to «Confirmar». */
  readonly confirmLabel?: string;
  readonly dataTestId?: string;
};

export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  onConfirm,
  tone = 'danger',
  confirmLabel = 'Confirmar',
  dataTestId,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dataTestId={dataTestId}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            data-testid={dataTestId ? `${dataTestId}-confirm` : undefined}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-dialog__message">{message}</p>
    </Modal>
  );
}
