/**
 * Components ABM — reusable engineering pieces for module composition.
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Component, OptionGroup, MaterialBoard } from '@muebles/domain';
import {
  Modal,
  useDebouncedValue,
  useRoutableEntitySelection,
} from '../common';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateUniqueCode,
} from '../catalogs';
import {
  componentToDraft,
  emptyComponentDraft,
  type ComponentDraft,
  type ComponentEditorTab,
} from './componentDraft';
import { ComponentEditorForm } from './editor/ComponentEditorForm';
import { ComponentListView } from './editor/ComponentListView';
import { materialColorMap } from '../preview3d';
import './components.css';

export type { ComponentDraft };
export {
  COMPONENT_PLACEMENTS,
  PLACEMENT_LABEL,
} from './componentDraft';

export interface ComponentsScreenProps {
  readonly components: readonly Component[];
  readonly optionGroups: readonly OptionGroup[];
  readonly materials?: readonly MaterialBoard[];
  readonly onCreate: (draft: ComponentDraft) => void;
  readonly onUpdate: (id: string, draft: ComponentDraft) => void;
  readonly onToggleActive: (id: string) => void;
  readonly canMutate: boolean;
  readonly openComponentId?: string | null;
  /**
   * Open editor for this id (URL `/components/:id/edit`, Fase 3 UI 3c).
   * Sentinel `'new'` = create-new editor. null / undefined = not in edit mode.
   */
  readonly openComponentEditId?: string | null;
  /**
   * Navigate to the editor route. Pass `'new'` for the create-new editor.
   */
  readonly onRequestEdit?: (componentId: string) => void;
  readonly onSelectionChange?: (id: string | null) => void;
}

export function ComponentsScreen({
  components,
  optionGroups,
  materials = [],
  onCreate,
  onUpdate,
  onToggleActive,
  canMutate = true,
  openComponentId = null,
  openComponentEditId = null,
  onRequestEdit,
  onSelectionChange,
}: ComponentsScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');

  const componentIds = useMemo(
    () => components.map((c) => c.id),
    [components],
  );
  const { selectedId: expandedId, toggleSelectedId } =
    useRoutableEntitySelection({
      openEntityId: openComponentId,
      onSelectionChange,
      knownIds: componentIds,
    });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComponentDraft>(emptyComponentDraft);
  /**
   * Snapshot of the draft taken when the editor opened (Fase 3 UI 3c).
   * Used to detect dirty draft and warn before discarding on close.
   */
  const [initialDraft, setInitialDraft] = useState<ComponentDraft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editorTab, setEditorTab] = useState<ComponentEditorTab>('general');
  const [error, setError] = useState<string | null>(null);

  const materialColors = useMemo(
    () => materialColorMap(materials),
    [materials],
  );

  const previewParts = useMemo(() => {
    const roles = draft.optionRoles
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let firstMaterialId = 'preview-material';

    for (const role of roles) {
      const group = optionGroups.find(
        (g) => g.code.toUpperCase() === role.toUpperCase() && g.kind === 'board',
      );
      if (group && group.optionIds.length > 0) {
        const matId = group.optionIds[0];
        if (matId) {
          firstMaterialId = matId;
          break;
        }
      }
    }

    return [
      {
        id: 'preview',
        widthMm: draft.widthMm || 300,
        lengthMm: draft.lengthMm || 500,
        thicknessMm: draft.thicknessMm || 18,
        x: 0,
        y: 0,
        z: 0,
        rotateX: draft.rotateX || 0,
        rotateY: draft.rotateY || 0,
        rotateZ: draft.rotateZ || 0,
        optionRole: draft.optionRoles.split(',')[0]?.trim() || 'INTERIOR',
        description: draft.name || 'Componente de Prueba',
        quantity: 1,
        grain: 0 as const,
        edges: [],
        materialId: firstMaterialId,
      },
    ];
  }, [draft, optionGroups]);

  const normalizedComponents = useMemo(() => {
    return components.map((c) => ({
      ...c,
      active: c.active !== false,
    }));
  }, [components]);

  /**
   * Sync edit mode from shell URL (`/components/:id/edit` — Fase 3 UI 3c).
   * - `'new'` sentinel: open create-new editor.
   * - Real id: open edit on that component.
   * - null / '': editor closed.
   */
  useEffect(() => {
    if (openComponentEditId == null || openComponentEditId === '') return;
    if (openComponentEditId === 'new') {
      const fresh = emptyComponentDraft();
      setEditingId(null);
      setDraft(fresh);
      setInitialDraft(fresh);
      setEditorTab('general');
      setError(null);
      setModalOpen(true);
      return;
    }
    const component = components.find((c) => c.id === openComponentEditId);
    if (!component) return;
    const fresh = componentToDraft(component);
    setEditingId(component.id);
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  }, [openComponentEditId, components]);

  const rows = useMemo(
    () =>
      filterCatalogItems(normalizedComponents, {
        status,
        query: debouncedSearch,
      }),
    [normalizedComponents, status, debouncedSearch],
  );

  /**
   * True when the user has changed the draft since opening the editor.
   */
  const isDraftDirty =
    initialDraft != null &&
    JSON.stringify(draft) !== JSON.stringify(initialDraft);

  /**
   * Hard close: clear all editor state, no warn. Called after a successful
   * save or after the user confirms discard.
   */
  const forceCloseEditor = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyComponentDraft());
    setInitialDraft(null);
    setEditorTab('general');
    setError(null);
    setConfirmDiscard(false);
    if (openComponentEditId && onSelectionChange) {
      onSelectionChange(expandedId);
    }
  };

  /**
   * Close the editor. When the draft is dirty, ask the user to confirm
   * discarding changes via the confirm-discard modal.
   */
  const closeModal = () => {
    if (isDraftDirty) {
      setConfirmDiscard(true);
      return;
    }
    forceCloseEditor();
  };

  /**
   * Open the editor (create-new). When `onRequestEdit` is wired (Fase 3 UI),
   * the shell navigates to `/components/new/edit`. Otherwise open the modal.
   */
  const handleCreateNew = () => {
    if (onRequestEdit) {
      onRequestEdit('new');
      return;
    }
    const fresh = emptyComponentDraft();
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditingId(null);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  /**
   * Open the editor (edit existing). When `onRequestEdit` is wired (Fase 3 UI),
   * the shell navigates to `/components/:id/edit`. Otherwise open the modal.
   */
  const handleEdit = (item: Component) => {
    if (onRequestEdit) {
      onRequestEdit(item.id);
      return;
    }
    const fresh = componentToDraft(item);
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditingId(item.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const handleToggleActive = (item: Component) => {
    onToggleActive(item.id);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const codeError = validateUniqueCode(
      draft.code,
      normalizedComponents,
      editingId ?? undefined,
    );
    if (codeError) {
      setError(codeError);
      return;
    }

    if (!draft.code.trim()) {
      setError('El código es obligatorio.');
      return;
    }
    if (!draft.name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (draft.lengthMm <= 0 || draft.widthMm <= 0 || draft.thicknessMm <= 0) {
      setError('Las dimensiones deben ser mayores a 0.');
      return;
    }
    if (!draft.optionRoles.trim()) {
      setError('Debe especificar al menos un Rol de Opción.');
      return;
    }

    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    // Just saved — close without dirty-discard warn.
    forceCloseEditor();
  };

  // Fase 3 UI 3c: inline editor mode overrides the modal when the shell wires
  // `onRequestEdit` and the URL is /components/:id/edit.
  const inlineEditMode =
    !!openComponentEditId && !!onRequestEdit && modalOpen;

  if (inlineEditMode) {
    return (
      <section
        className="catalog-page component-editor-page"
        aria-label={editingId ? 'Editar Componente' : 'Nuevo Componente'}
        data-testid="component-editor-page"
      >
        <header className="workspace-chrome">
          <div className="workspace-chrome__lead">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={closeModal}
              aria-label="Volver a la lista"
              data-testid="component-editor-back"
            >
              ← Lista
            </button>
            <div className="workspace-chrome__identity">
              <span className="workspace-chrome__code">
                {editingId ? draft.code || '—' : 'NUEVO'}
              </span>
              <p className="workspace-chrome__title">
                {editingId ? 'Editar Componente' : 'Nuevo Componente'}
              </p>
            </div>
          </div>
        </header>

        <div className="component-editor-page__main">
          <ComponentEditorForm
            formId={formId}
            error={error}
            onSubmit={onSubmit}
            onCancel={closeModal}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
            draft={draft}
            setDraft={setDraft}
            editingId={editingId}
            optionGroups={optionGroups}
            previewParts={previewParts}
            materialColors={materialColors}
          />
        </div>

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
                data-testid="component-editor-discard-confirm"
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
      </section>
    );
  }

  return (
    <div className="catalog-screen" data-testid="components-screen">
      <ComponentListView
        rows={rows}
        search={search}
        setSearch={setSearch}
        status={status}
        setStatus={setStatus}
        expandedId={expandedId}
        onToggleExpand={toggleSelectedId}
        canMutate={canMutate}
        onCreate={handleCreateNew}
        onEdit={handleEdit}
        onToggleActive={handleToggleActive}
      />

      <Modal
        open={modalOpen}
        title={editingId ? 'Editar Componente' : 'Nuevo Componente'}
        onClose={closeModal}
        size="lg"
        data-testid="component-modal"
      >
        <ComponentEditorForm
          formId={formId}
          error={error}
          onSubmit={onSubmit}
          onCancel={closeModal}
          editorTab={editorTab}
          setEditorTab={setEditorTab}
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          optionGroups={optionGroups}
          previewParts={previewParts}
          materialColors={materialColors}
        />
      </Modal>

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
              data-testid="component-editor-discard-confirm"
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
    </div>
  );
}
