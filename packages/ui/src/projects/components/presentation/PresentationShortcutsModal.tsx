/**
 * Keyboard shortcuts help overlay for ProjectPresentationMode.
 */

import type { ReactNode } from 'react';
import { Keyboard, X } from 'lucide-react';

export interface PresentationShortcutsModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function PresentationShortcutsModal({
  open,
  onClose,
}: PresentationShortcutsModalProps): ReactNode {
  if (!open) return null;

  return (
    <div
      className="project-presentation__shortcuts-overlay"
      role="dialog"
      aria-label="Atajos de teclado"
      data-testid="presentation-shortcuts-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="project-presentation__shortcuts-card">
        <div className="project-presentation__shortcuts-header">
          <Keyboard size={18} strokeWidth={1.5} aria-hidden />
          <span>Atajos de teclado</span>
          <button
            type="button"
            className="btn btn--ghost project-presentation__shortcuts-close"
            onClick={onClose}
            aria-label="Cerrar ayuda"
          >
            <X size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
        <ul className="project-presentation__shortcuts-list">
          <li>
            <kbd>→</kbd> <kbd>←</kbd> Navegar diapositivas
          </li>
          <li>
            <kbd>?</kbd> Mostrar / ocultar esta ayuda
          </li>
          <li>
            <kbd>Esc</kbd> Salir de la presentación
          </li>
          <li>Deslizá izquierda / derecha para cambiar diapositiva</li>
        </ul>
      </div>
    </div>
  );
}
