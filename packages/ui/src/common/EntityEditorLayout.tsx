/**
 * EntityEditorLayout — generic layout container for entity screens
 * (ModulesScreen, StructuresScreen, ComponentsScreen). F059.
 *
 * Absorbs repetitive structure across the 3 entity screens:
 * 1. Inline edit mode (`/edit` route handoff via header chrome + editor form)
 * 2. Card/Row Detail mode (when an item is expanded/selected)
 * 3. List mode (standard catalog/cards grid)
 * 4. Shared editor modal (LG) and confirm-discard modal (SM)
 * 5. Extra modal slots (categories, 3D viewer, component adder, etc.)
 */

import type { ReactNode } from 'react';
import { Modal, type ModalSize } from './Modal';

export interface EntityEditorLayoutProps {
  /** Page / container test id (e.g. "components-screen") */
  readonly dataTestId?: string;
  /** Test id for the inline editor page (e.g. "component-editor-page") */
  readonly editorPageTestId?: string;
  /** Test id for back button in inline editor (e.g. "component-editor-back") */
  readonly editorBackTestId?: string;
  /** Test id for discard button in confirm modal (e.g. "component-editor-discard-confirm") */
  readonly discardConfirmTestId?: string;
  /** Test id for main editor modal (e.g. "component-modal") */
  readonly modalTestId?: string;
  /** Size of the main editor modal (default: "lg") */
  readonly modalSize?: ModalSize;
  /** Singular title of the entity (e.g. "Componente", "Estructura", "Mueble") */
  readonly entityTitle?: string;
  /** Custom title for create mode (e.g. "Nuevo mueble" or "Nueva Estructura") */
  readonly createTitle?: string;
  /** Custom title for edit mode (e.g. "Editar mueble" or "Editar Estructura") */
  readonly editTitle?: string;
  /** Code of the current draft for header display in edit mode */
  readonly draftCode?: string;
  /** Form element HTML id (used to associate modal footer submit button) */
  readonly formId?: string;

  /** State flags from useEntityEditorState / screen */
  readonly modalOpen: boolean;
  readonly confirmDiscard: boolean;
  readonly editingId: string | null;
  readonly inlineEditMode: boolean;
  readonly isSelected: boolean;

  /** Handlers */
  readonly closeModal: () => void;
  readonly setConfirmDiscard: (open: boolean) => void;
  readonly forceCloseEditor: () => void;

  /** Extra header action buttons for inline edit mode (e.g. Cancelar/Guardar) */
  readonly headerActions?: ReactNode;
  /** Custom footer for the editor modal */
  readonly modalFooter?: ReactNode;

  /** Render slots */
  readonly renderListView: () => ReactNode;
  readonly renderDetailView?: () => ReactNode;
  readonly renderEditorForm: () => ReactNode;

  /** Extra modals or overlays (e.g. CategoryModals, ComponentAdderModal, 3DModal) */
  readonly extraModals?: ReactNode;
}

export function EntityEditorLayout({
  dataTestId,
  editorPageTestId,
  editorBackTestId,
  discardConfirmTestId,
  modalTestId,
  modalSize = 'lg',
  entityTitle = '',
  createTitle,
  editTitle,
  draftCode,
  formId,
  modalOpen,
  confirmDiscard,
  editingId,
  inlineEditMode,
  isSelected,
  closeModal,
  setConfirmDiscard,
  forceCloseEditor,
  headerActions,
  modalFooter,
  renderListView,
  renderDetailView,
  renderEditorForm,
  extraModals,
}: EntityEditorLayoutProps): ReactNode {
  const defaultCreateTitle = `Nuevo ${entityTitle}`.trim();
  const defaultEditTitle = `Editar ${entityTitle}`.trim();
  const editorModalTitle = editingId
    ? (editTitle ?? defaultEditTitle)
    : (createTitle ?? defaultCreateTitle);

  const discardModal = (
    <Modal
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      title="Descartar cambios"
      size="sm"
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => setConfirmDiscard(false)}
          >
            Seguir editando
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={forceCloseEditor}
            data-testid={discardConfirmTestId}
          >
            Descartar y salir
          </button>
        </>
      }
    >
      <p>
        Tenés cambios sin guardar. Si salís ahora vas a perderlos. ¿Seguro
        que querés descartar?
      </p>
    </Modal>
  );

  const defaultModalFooter = formId ? (
    <>
      <button type="button" className="btn" onClick={closeModal}>
        Cancelar
      </button>
      <button type="submit" className="btn btn--primary" form={formId}>
        Guardar
      </button>
    </>
  ) : undefined;

  const editorModal =
    modalOpen && !inlineEditMode ? (
      <Modal
        open={modalOpen}
        title={editorModalTitle}
        onClose={closeModal}
        size={modalSize}
        data-testid={modalTestId}
        footer={modalFooter ?? defaultModalFooter}
      >
        {renderEditorForm()}
      </Modal>
    ) : null;

  if (inlineEditMode) {
    return (
      <section
        className="catalog-page entity-editor-page"
        aria-label={editorModalTitle}
        data-testid={editorPageTestId}
      >
        <header className="workspace-chrome">
          <div className="workspace-chrome__lead">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={closeModal}
              aria-label="Volver a la lista"
              data-testid={editorBackTestId}
            >
              ← Lista
            </button>
            <div className="workspace-chrome__identity">
              <span className="workspace-chrome__code">
                {editingId ? draftCode || '—' : 'NUEVO'}
              </span>
              <p className="workspace-chrome__title">{editorModalTitle}</p>
            </div>
          </div>
          {headerActions && (
            <div className="workspace-chrome__actions">{headerActions}</div>
          )}
        </header>

        <div className="entity-editor-page__main">{renderEditorForm()}</div>

        {discardModal}
        {extraModals}
      </section>
    );
  }

  if (isSelected && renderDetailView) {
    return (
      <div className="catalog-page" data-testid={dataTestId}>
        {renderDetailView()}
        {editorModal}
        {discardModal}
        {extraModals}
      </div>
    );
  }

  return (
    <div className="catalog-screen" data-testid={dataTestId}>
      {renderListView()}
      {editorModal}
      {discardModal}
      {extraModals}
    </div>
  );
}
