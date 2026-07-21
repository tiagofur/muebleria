/**
 * Structures ABM — list + LG editor modal (components-only body).
 */

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  Component,
  DimensionPreset,
  OptionGroup,
  Structure,
} from '@muebles/domain';
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
import { ModuleComponentAdderModal } from '../modules/components/ModuleComponentAdderModal';
import { StructureDetailView } from './components/StructureDetailView';
import { StructureEditorForm } from './components/StructureEditorForm';
import { StructureListView } from './components/StructureListView';
import {
  emptyStructureDraft,
  structureToDraft,
  type StructureDraft,
  type StructureEditorTab,
} from './structureDraft';
import './structures.css';

export type { StructureDraft };

export interface StructuresScreenProps {
  readonly structures: readonly Structure[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalogComponents?: readonly Component[];
  readonly onCreate: (draft: StructureDraft) => void;
  readonly onUpdate: (id: string, draft: StructureDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  /** URL handoff: `/structures/:id` expands that row. */
  readonly openStructureId?: string | null;
  /**
   * Open editor for this id (URL `/structures/:id/edit`, Fase 3 UI 3b).
   * Sentinel `'new'` = create-new editor. null / undefined = not in edit mode.
   */
  readonly openStructureEditId?: string | null;
  /**
   * Navigate to the editor route. Pass `'new'` for the create-new editor.
   */
  readonly onRequestEdit?: (structureId: string) => void;
  readonly onSelectionChange?: (id: string | null) => void;
  /** Role matrix: can current user mutate structures? */
  readonly canMutate?: boolean;
}

export function StructuresScreen({
  structures,
  optionGroups: _optionGroups,
  catalogComponents = [],
  onCreate,
  onUpdate,
  onDelete,
  onDeactivate,
  onReactivate,
  openStructureId = null,
  openStructureEditId = null,
  onRequestEdit,
  onSelectionChange,
  canMutate = true,
}: StructuresScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');

  const structureIds = useMemo(() => structures.map((s) => s.id), [structures]);
  const {
    selectedId: expandedId,
    setSelectedId,
    toggleSelectedId,
  } = useRoutableEntitySelection({
    openEntityId: openStructureId,
    onSelectionChange,
    knownIds: structureIds,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StructureDraft>(emptyStructureDraft);
  /**
   * Snapshot of the draft taken when the editor opened (Fase 3 UI 3b).
   * Used to detect dirty draft and warn before discarding on close.
   */
  const [initialDraft, setInitialDraft] = useState<StructureDraft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editorTab, setEditorTab] = useState<StructureEditorTab>('general');
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [previewPresetId, setPreviewPresetId] = useState('');
  const [addComponentOpen, setAddComponentOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const debouncedCompSearch = useDebouncedValue(componentSearch);
  const [newCompId, setNewCompId] = useState('');
  const [newCompQty, setNewCompQty] = useState(1);

  const filteredComponents = useMemo(() => {
    const q = debouncedCompSearch.trim().toLocaleLowerCase('es-UY');
    if (!q) return catalogComponents.filter((c) => c.active);
    return catalogComponents.filter(
      (c) =>
        c.active &&
        (`${c.code} ${c.name}`.toLocaleLowerCase('es-UY').includes(q) ||
          c.optionRoles.some((r) => r.toLocaleLowerCase('es-UY').includes(q))),
    );
  }, [catalogComponents, debouncedCompSearch]);

  useEffect(() => {
    if (draft.presets.length > 0) {
      if (!draft.presets.some((p) => p.id === previewPresetId)) {
        setPreviewPresetId(draft.presets[0]!.id);
      }
    } else {
      setPreviewPresetId('');
    }
  }, [draft.presets, previewPresetId]);

  /**
   * Sync edit mode from shell URL (`/structures/:id/edit` — Fase 3 UI 3b).
   * - `'new'` sentinel: open create-new editor.
   * - Real id: open edit on that structure.
   * - null / '': editor closed.
   */
  useEffect(() => {
    if (openStructureEditId == null || openStructureEditId === '') return;
    if (openStructureEditId === 'new') {
      const fresh = emptyStructureDraft();
      setEditingId(null);
      setDraft(fresh);
      setInitialDraft(fresh);
      setEditorTab('general');
      setError(null);
      setModalOpen(true);
      return;
    }
    const structure = structures.find((s) => s.id === openStructureEditId);
    if (!structure) return;
    const fresh = structureToDraft(structure);
    setEditingId(structure.id);
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  }, [openStructureEditId, structures]);

  const addPreset = () => {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDraft((prev) => ({
      ...prev,
      presets: [
        ...prev.presets,
        {
          id,
          name: '',
          width: prev.widthMm || 500,
          height: prev.heightMm || 720,
          depth: prev.depthMm || 560,
        },
      ],
    }));
  };

  const removePreset = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      presets: prev.presets.filter((p) => p.id !== id),
    }));
  };

  const updatePreset = (id: string, patch: Partial<DimensionPreset>) => {
    setDraft((prev) => ({
      ...prev,
      presets: prev.presets.map((p) =>
        p.id === id ? ({ ...p, ...patch } as DimensionPreset) : p,
      ),
    }));
  };

  const normalizedStructures = useMemo(() => {
    return structures.map((s) => ({
      ...s,
      active: s.active !== false,
    }));
  }, [structures]);

  const rows = useMemo(
    () =>
      filterCatalogItems(normalizedStructures, {
        status,
        query: debouncedSearch,
      }),
    [normalizedStructures, status, debouncedSearch],
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
    setDraft(emptyStructureDraft());
    setInitialDraft(null);
    setEditorTab('general');
    setError(null);
    setConfirmDiscard(false);
    if (openStructureEditId && onSelectionChange) {
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
   * the shell navigates to `/structures/new/edit`. Otherwise (legacy / tests)
   * open the modal directly.
   */
  const handleCreateNew = () => {
    if (onRequestEdit) {
      onRequestEdit('new');
      return;
    }
    const fresh = emptyStructureDraft();
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditingId(null);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  /**
   * Open the editor (edit existing). When `onRequestEdit` is wired (Fase 3 UI),
   * the shell navigates to `/structures/:id/edit`. Otherwise open the modal.
   */
  const handleEdit = (item: Structure) => {
    if (onRequestEdit) {
      onRequestEdit(item.id);
      return;
    }
    const fresh = structureToDraft(item);
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditingId(item.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const codeError = validateUniqueCode(
      draft.code,
      normalizedStructures,
      editingId ?? undefined,
    );
    if (codeError) {
      setError(codeError);
      return;
    }

    if (draft.presets) {
      for (const pr of draft.presets) {
        if (pr.width <= 0 || pr.height <= 0 || pr.depth <= 0) {
          setError('Las dimensiones de los presets deben ser mayores a 0.');
          return;
        }
      }
    }

    if (draft.components.length === 0) {
      setError(
        'La estructura necesita al menos un componente (por ejemplo laterales o base).',
      );
      return;
    }

    if (editingId) {
      onUpdate(editingId, draft);
    } else {
      onCreate(draft);
    }
    // Use forceCloseEditor: just saved, no dirty-discard warn.
    forceCloseEditor();
  };

  const handleDelete = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      if (expandedId === deleteConfirmId) {
        setSelectedId(null);
      }
      if (editingId === deleteConfirmId) {
        // The entity being edited is gone — close without warn.
        forceCloseEditor();
      } else {
        setDeleteConfirmId(null);
      }
    }
  };

  // Fase 3 UI 3b: inline editor mode overrides the modal when the shell wires
  // `onRequestEdit` and the URL is /structures/:id/edit. The form is rendered
  // inline (no Modal LG); the form keeps its built-in Cancelar/Guardar footer.
  const inlineEditMode =
    !!openStructureEditId && !!onRequestEdit && modalOpen;

  if (inlineEditMode) {
    return (
      <section
        className="catalog-page structure-editor-page"
        aria-label={editingId ? 'Editar Estructura' : 'Nueva Estructura'}
        data-testid="structure-editor-page"
      >
        <header className="workspace-chrome">
          <div className="workspace-chrome__lead">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={closeModal}
              aria-label="Volver a la lista"
              data-testid="structure-editor-back"
            >
              ← Lista
            </button>
            <div className="workspace-chrome__identity">
              <span className="workspace-chrome__code">
                {editingId ? draft.code || '—' : 'NUEVO'}
              </span>
              <p className="workspace-chrome__title">
                {editingId ? 'Editar Estructura' : 'Nueva Estructura'}
              </p>
            </div>
          </div>
        </header>

        <div className="structure-editor-page__main">
          <StructureEditorForm
            formId={formId}
            error={error}
            onSubmit={onSubmit}
            onCancel={closeModal}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
            draft={draft}
            setDraft={setDraft}
            editingId={editingId}
            catalogComponents={catalogComponents}
            onRequestAddComponent={() => {
              setAddComponentOpen(true);
              setComponentSearch('');
              setNewCompId('');
              setNewCompQty(1);
            }}
            previewPresetId={previewPresetId}
            onPreviewPresetChange={setPreviewPresetId}
            onAddPreset={addPreset}
            onRemovePreset={removePreset}
            onUpdatePreset={updatePreset}
          />
        </div>

        <ModuleComponentAdderModal
          open={addComponentOpen}
          onClose={() => setAddComponentOpen(false)}
          componentSearch={componentSearch}
          onSearchChange={setComponentSearch}
          filteredComponents={filteredComponents}
          newCompId={newCompId}
          onSelect={setNewCompId}
          newCompQty={newCompQty}
          onQtyChange={setNewCompQty}
          onConfirm={() => {
            if (!newCompId) return;
            setDraft((prev) => ({
              ...prev,
              components: [
                ...prev.components,
                {
                  componentId: newCompId,
                  quantity: newCompQty,
                },
              ],
            }));
            setAddComponentOpen(false);
          }}
        />

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
                data-testid="structure-editor-discard-confirm"
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

  // Fase 3 follow-up: card-detalle. When a row is expanded (selected), render
  // the dedicated read-only StructureDetailView instead of the card grid. The
  // detail view's Editar button reuses handleEdit (which navigates to /edit).
  const selectedStructure = expandedId
    ? (normalizedStructures.find((s) => s.id === expandedId) ?? null)
    : null;

  if (selectedStructure) {
    return (
      <div className="catalog-page" data-testid="structures-screen">
        <StructureDetailView
          structure={selectedStructure}
          catalogComponents={catalogComponents}
          onBack={() => setSelectedId(null)}
          onEdit={handleEdit}
          onDeactivate={canMutate ? onDeactivate : undefined}
          onReactivate={canMutate ? onReactivate : undefined}
          onDelete={
            canMutate
              ? (id) => setDeleteConfirmId(id)
              : undefined
          }
          canMutate={canMutate}
        />

        {/* Legacy editor modal (used when onRequestEdit is not wired, e.g.
            tests). When the shell wires onRequestEdit, the editor opens
            inline via the inlineEditMode branch above. */}
        <Modal
          open={modalOpen}
          title={editingId ? 'Editar Estructura' : 'Nueva Estructura'}
          onClose={closeModal}
          size="lg"
          data-testid="structure-modal"
        >
          <StructureEditorForm
            formId={formId}
            error={error}
            onSubmit={onSubmit}
            onCancel={closeModal}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
            draft={draft}
            setDraft={setDraft}
            editingId={editingId}
            catalogComponents={catalogComponents}
            onRequestAddComponent={() => {
              setAddComponentOpen(true);
              setComponentSearch('');
              setNewCompId('');
              setNewCompQty(1);
            }}
            previewPresetId={previewPresetId}
            onPreviewPresetChange={setPreviewPresetId}
            onAddPreset={addPreset}
            onRemovePreset={removePreset}
            onUpdatePreset={updatePreset}
          />
        </Modal>

        <ModuleComponentAdderModal
          open={addComponentOpen}
          onClose={() => setAddComponentOpen(false)}
          componentSearch={componentSearch}
          onSearchChange={setComponentSearch}
          filteredComponents={filteredComponents}
          newCompId={newCompId}
          onSelect={setNewCompId}
          newCompQty={newCompQty}
          onQtyChange={setNewCompQty}
          onConfirm={() => {
            if (!newCompId) return;
            setDraft((prev) => ({
              ...prev,
              components: [
                ...prev.components,
                {
                  componentId: newCompId,
                  quantity: newCompQty,
                },
              ],
            }));
            setAddComponentOpen(false);
          }}
        />

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
                data-testid="structure-editor-discard-confirm"
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

        <Modal
          open={!!deleteConfirmId}
          title="¿Eliminar estructura?"
          onClose={() => setDeleteConfirmId(null)}
          size="sm"
          data-testid="delete-confirm-modal"
        >
          <div className="p-4">
            <p className="mb-4">
              ¿Estás seguro de que deseas eliminar esta estructura? Esta acción
              no se puede deshacer.
            </p>
            <div className="modal__footer">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleDelete}
                data-testid="confirm-delete-btn"
              >
                Eliminar
              </button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  return (
    <div className="catalog-screen" data-testid="structures-screen">
      <StructureListView
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
        onDeactivate={onDeactivate}
        onReactivate={onReactivate}
        onRequestDelete={setDeleteConfirmId}
      />

      <Modal
        open={modalOpen}
        title={editingId ? 'Editar Estructura' : 'Nueva Estructura'}
        onClose={closeModal}
        size="lg"
        data-testid="structure-modal"
      >
        <StructureEditorForm
          formId={formId}
          error={error}
          onSubmit={onSubmit}
          onCancel={closeModal}
          editorTab={editorTab}
          setEditorTab={setEditorTab}
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          catalogComponents={catalogComponents}
          onRequestAddComponent={() => {
            setAddComponentOpen(true);
            setComponentSearch('');
            setNewCompId('');
            setNewCompQty(1);
          }}
          previewPresetId={previewPresetId}
          onPreviewPresetChange={setPreviewPresetId}
          onAddPreset={addPreset}
          onRemovePreset={removePreset}
          onUpdatePreset={updatePreset}
        />
      </Modal>

      <ModuleComponentAdderModal
        open={addComponentOpen}
        onClose={() => setAddComponentOpen(false)}
        componentSearch={componentSearch}
        onSearchChange={setComponentSearch}
        filteredComponents={filteredComponents}
        newCompId={newCompId}
        onSelect={setNewCompId}
        newCompQty={newCompQty}
        onQtyChange={setNewCompQty}
        onConfirm={() => {
          if (!newCompId) return;
          setDraft((prev) => ({
            ...prev,
            components: [
              ...prev.components,
              {
                componentId: newCompId,
                quantity: newCompQty,
              },
            ],
          }));
          setAddComponentOpen(false);
        }}
      />

      <Modal
        open={!!deleteConfirmId}
        title="¿Eliminar estructura?"
        onClose={() => setDeleteConfirmId(null)}
        size="sm"
        data-testid="delete-confirm-modal"
      >
        <div className="p-4">
          <p className="mb-4">
            ¿Estás seguro de que deseas eliminar esta estructura? Esta acción no
            se puede deshacer.
          </p>
          <div className="modal__footer">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={handleDelete}
              data-testid="confirm-delete-btn"
            >
              Eliminar
            </button>
          </div>
        </div>
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
              data-testid="structure-editor-discard-confirm"
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
