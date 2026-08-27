/**
 * Structures ABM — card-detalle + full-page editor (Fase 5 UI).
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  Agregado,
  Component,
  DimensionPreset,
  EdgeBand,
  Hardware,
  MaterialBoard,
  OptionGroup,
  Structure,
} from '@granete/domain';
import {
  EntityEditorLayout,
  Modal,
  seedEditorDraftFromBaseline,
  useDebouncedValue,
  useEntityEditorState,
  useRoutableEntitySelection,
} from '../common';
import {
  filterCatalogItems,
  type CatalogStatusFilter,
  validateUniqueCode,
} from '../catalogs';
import { ModuleComponentAdderModal } from '../modules/components/ModuleComponentAdderModal';
import { Structure3DModal } from './components/Structure3DModal';
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
  readonly catalogAgregados?: readonly Agregado[];
  readonly catalogMaterials?: readonly MaterialBoard[];
  readonly catalogEdges?: readonly EdgeBand[];
  readonly catalogHardware?: readonly Hardware[];
  readonly onCreate: (draft: StructureDraft) => void;
  readonly onUpdate: (id: string, draft: StructureDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeactivate: (id: string) => void;
  readonly onReactivate: (id: string) => void;
  /** URL handoff: `/structures/:id` opens card-detalle. */
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
  /** Resolve media path for 3D texture loading. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function StructuresScreen({
  structures,
  optionGroups,
  catalogComponents = [],
  catalogAgregados = [],
  catalogMaterials = [],
  catalogEdges = [],
  catalogHardware = [],
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
  resolveImageUrl = (u) => u,
}: StructuresScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [status, setStatus] = useState<CatalogStatusFilter>('active');

  const structureIds = useMemo(() => structures.map((s) => s.id), [structures]);
  const {
    selectedId: expandedId,
    setSelectedId,
  } = useRoutableEntitySelection({
    openEntityId: openStructureId,
    onSelectionChange,
    knownIds: structureIds,
  });

  const draftKey = `structure-draft:${openStructureEditId ?? 'idle'}`;
  // F059: shared entity editor state extracted to useEntityEditorState.
  const {
    modalOpen,
    setModalOpen,
    editingId,
    setEditingId,
    draft,
    setDraft,
    initialDraft,
    setInitialDraft,
    confirmDiscard,
    editorTab,
    error,
    isDraftDirty,
    setEditorTab,
    setError,
    setConfirmDiscard,
    forceCloseEditor,
    closeModal,
    clearDraft,
  } = useEntityEditorState<StructureDraft, StructureEditorTab>({
    draftKey,
    emptyDraft: emptyStructureDraft,
    defaultTab: 'general',
    onEditorClose: (restoreId) => {
      if (restoreId && restoreId !== 'new') {
        if (onSelectionChange) {
          onSelectionChange(restoreId);
        } else if (onRequestEdit) {
          onRequestEdit(null as any);
        }
      } else if (onRequestEdit) {
        onRequestEdit(null as any);
      } else if (onSelectionChange) {
        onSelectionChange(null);
      }
    },
    currentSelectionId: expandedId,
  });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [viewerStructure, setViewerStructure] = useState<Structure | null>(null);
  const [show3DModal, setShow3DModal] = useState(false);
  const [previewPresetId, setPreviewPresetId] = useState('');
  const [addComponentOpen, setAddComponentOpen] = useState(false);
  const [componentSearch, setComponentSearch] = useState('');
  const debouncedCompSearch = useDebouncedValue(componentSearch);
  const [newCompId, setNewCompId] = useState('');
  const [newCompQty, setNewCompQty] = useState(1);

  const catalogInput = useMemo(
    () => ({
      modules: [],
      structures,
      components: catalogComponents,
      materials: catalogMaterials,
      edges: catalogEdges,
      hardware: catalogHardware,
      optionGroups,
      // Thread agregados so resolveBom → resolveComposedModule can expand
      // structure.agregados into board parts in the 3D preview.
      agregados: catalogAgregados,
    }),
    [
      structures,
      catalogComponents,
      catalogMaterials,
      catalogEdges,
      catalogHardware,
      optionGroups,
      catalogAgregados,
    ],
  );

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
  /** Seed only when edit id changes — not on `structures` identity churn (C1). */
  const seededStructureEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (openStructureEditId == null || openStructureEditId === '') {
      setModalOpen(false);
      setEditingId(null);
      seededStructureEditIdRef.current = null;
      return;
    }
    if (openStructureEditId === 'new') {
      if (seededStructureEditIdRef.current === 'new') return;
      // Keep session-restored draft on F5/remount (R3-C1).
      seedEditorDraftFromBaseline(
        draftKey,
        emptyStructureDraft(),
        setDraft,
        setInitialDraft,
      );
      setEditingId(null);
      setEditorTab('general');
      setError(null);
      setModalOpen(true);
      seededStructureEditIdRef.current = 'new';
      return;
    }
    if (seededStructureEditIdRef.current === openStructureEditId) return;
    const structure = structures.find((s) => s.id === openStructureEditId);
    if (!structure) return;
    seedEditorDraftFromBaseline(
      draftKey,
      structureToDraft(structure),
      setDraft,
      setInitialDraft,
    );
    setEditingId(structure.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
    seededStructureEditIdRef.current = openStructureEditId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // F059: isDraftDirty, forceCloseEditor, closeModal come from useEntityEditorState.

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

    if (draft.components.length === 0) {
      setError(
        'La estructura necesita al menos un componente (por ejemplo laterales o base). Abrí la pestaña Componentes.',
      );
      setEditorTab('components');
      return;
    }

    if (draft.presets) {
      for (const pr of draft.presets) {
        if (pr.width <= 0 || pr.height <= 0 || pr.depth <= 0) {
          setError(
            'Las dimensiones de los presets deben ser mayores a 0. Revisá la pestaña Presets.',
          );
          setEditorTab('presets');
          return;
        }
      }
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

  // Fase 5 UI: always full-page workspace editor (same pattern as modules).
  const inlineEditMode = modalOpen;

  const selectedStructure = expandedId
    ? (normalizedStructures.find((s) => s.id === expandedId) ?? null)
    : null;

  return (
    <EntityEditorLayout
      dataTestId="structures-screen"
      editorPageTestId="structure-editor-page"
      editorBackTestId="structure-editor-back"
      discardConfirmTestId="structure-editor-discard-confirm"
      modalTestId="structure-modal"
      entityTitle="estructura"
      createTitle="Nueva estructura"
      editTitle="Editar estructura"
      draftCode={draft.code}
      formId={formId}
      modalOpen={modalOpen}
      confirmDiscard={confirmDiscard}
      editingId={editingId}
      inlineEditMode={inlineEditMode}
      isSelected={!!selectedStructure}
      closeModal={closeModal}
      setConfirmDiscard={setConfirmDiscard}
      forceCloseEditor={forceCloseEditor}
      headerActions={
        <>
          <button
            type="button"
            className="btn"
            onClick={closeModal}
            data-testid="structure-editor-cancel"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            form={formId}
            data-testid="save-btn"
          >
            Guardar
          </button>
        </>
      }
      renderListView={() => (
        <StructureListView
          rows={rows}
          search={search}
          setSearch={setSearch}
          status={status}
          setStatus={setStatus}
          canMutate={canMutate}
          onCreate={handleCreateNew}
          onOpenDetail={(item) => setSelectedId(item.id)}
        />
      )}
      renderDetailView={
        selectedStructure
          ? () => (
              <StructureDetailView
                structure={selectedStructure}
                catalogComponents={catalogComponents}
                onBack={() => setSelectedId(null)}
                onEdit={handleEdit}
                onView3D={(s) => {
                  setViewerStructure(s);
                  setShow3DModal(true);
                }}
                onDeactivate={canMutate ? onDeactivate : undefined}
                onReactivate={canMutate ? onReactivate : undefined}
                onDelete={
                  canMutate
                    ? (id) => setDeleteConfirmId(id)
                    : undefined
                }
                canMutate={canMutate}
              />
            )
          : undefined
      }
      renderEditorForm={() => (
        <StructureEditorForm
          formId={formId}
          error={error}
          onSubmit={onSubmit}
          editorTab={editorTab}
          setEditorTab={setEditorTab}
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          catalogComponents={catalogComponents}
          catalogAgregados={catalogAgregados}
          catalogInput={catalogInput}
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
      )}
      extraModals={
        <>
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
            optionGroups={optionGroups}
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
            dataTestId="delete-confirm-modal"
          >
            <div>
              <p>
                ¿Estás seguro de que deseas eliminar esta estructura? Esta acción
                no se puede deshacer.
              </p>
              <div className="modal__footer">
                <button
                  type="button"
                  className="btn"
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

          <Structure3DModal
            open={show3DModal}
            structure={viewerStructure}
            catalog={catalogInput}
            resolveMediaUrl={resolveImageUrl}
            onClose={() => {
              setShow3DModal(false);
              setViewerStructure(null);
            }}
          />
        </>
      }
    />
  );
}
