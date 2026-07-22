/**
 * Save project as template modal (#110). Extracted from ProjectsScreen.tsx (F058a).
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from '../../common';

export function ProjectSaveAsTemplateModal({
  open,
  initialName,
  onClose,
  onConfirm,
}: {
  readonly open: boolean;
  readonly initialName: string;
  readonly onClose: () => void;
  readonly onConfirm: (name: string) => void;
}): ReactNode {
  const [name, setName] = useState(initialName);

  // Sync when modal opens so the initial name matches the current project.
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onConfirm(name);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Guardar como plantilla"
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" form="save-as-template-form" className="btn btn--primary">
            Guardar plantilla
          </button>
        </>
      }
    >
      <form id="save-as-template-form" onSubmit={handleSubmit}>
        <div className="catalog-form__field">
          <label htmlFor="save-as-template-name">Nombre de la plantilla</label>
          <input
            id="save-as-template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            data-testid="save-as-template-name"
          />
        </div>
        <p className="project-editor__hint">
          La plantilla guardará los muebles, opciones, defaults de medida y
          plano de disposición. No incluye cliente ni estado.
        </p>
      </form>
    </Modal>
  );
}
