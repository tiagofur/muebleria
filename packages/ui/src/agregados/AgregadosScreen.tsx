/**
 * Agregados catalog screen — sub-assemblies management.
 * Full-page workspace editor (same pattern as ComponentsScreen / F059).
 */

import {
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type {
  Agregado,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  OptionGroup,
} from '@granete/domain';
import {
  EntityEditorLayout,
  seedEditorDraftFromBaseline,
  useDebouncedValue,
  useEntityEditorState,
  useRoutableEntitySelection,
} from '../common';
import type { Module3DCatalogInput } from '../modules/module3dPreview';
import {
  createEmptyAgregadoDraft,
  agregadoToDraft,
  draftToAgregado,
  type AgregadoDraft,
} from './agregadoDraft';
import { AgregadoListView } from './editor/AgregadoListView';
import { AgregadoDetailView } from './editor/AgregadoDetailView';
import { AgregadoEditorForm, type AgregadoEditorTab } from './editor/AgregadoEditorForm';
import { Agregado3DModal } from './editor/Agregado3DModal';
import './agregados.css';

export interface AgregadosScreenProps {
  readonly agregados: readonly Agregado[];
  readonly catalogComponents: readonly Component[];
  readonly catalogHardware: readonly Hardware[];
  readonly onCreate: (agregado: Agregado) => void;
  readonly onUpdate: (agregado: Agregado) => void;
  readonly onDelete?: (id: string) => void;
  readonly canMutate?: boolean;
  readonly openAgregadoId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
  /** Catalog slices required by the live 3D preview in the Piezas tab. When
   * omitted, the editor falls back to a single-column layout with no preview. */
  readonly optionGroups?: readonly OptionGroup[];
  readonly catalogMaterials?: readonly MaterialBoard[];
  readonly catalogEdges?: readonly EdgeBand[];
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
}

export function AgregadosScreen({
  agregados,
  catalogComponents,
  catalogHardware,
  onCreate,
  onUpdate,
  onDelete,
  canMutate = true,
  openAgregadoId = null,
  onSelectionChange,
  optionGroups,
  catalogMaterials,
  catalogEdges,
  resolveImageUrl,
}: AgregadosScreenProps): ReactNode {
  const formId = useId();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const seededEditIdRef = useRef<string | null>(null);

  const agregadoIds = useMemo(() => agregados.map((a) => a.id), [agregados]);

  const { selectedId: expandedId, setSelectedId } = useRoutableEntitySelection({
    openEntityId: openAgregadoId,
    onSelectionChange,
    knownIds: agregadoIds,
  });

  const draftKey = 'agregado-draft:editor';
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
    setEditorTab,
    setError,
    setConfirmDiscard,
    forceCloseEditor,
    closeModal,
  } = useEntityEditorState<AgregadoDraft, AgregadoEditorTab>({
    draftKey,
    emptyDraft: createEmptyAgregadoDraft,
    defaultTab: 'general',
    onEditorClose: (restoreId) => {
      onSelectionChange?.(restoreId);
    },
    currentSelectionId: expandedId,
  });

  const rows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return agregados;
    return agregados.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [agregados, debouncedSearch]);

  // Full catalog slice for the live 3D preview in the Piezas tab. Undefined
  // when the shell didn't provide finishes → editor degrades to 1 column.
  const catalogInput = useMemo<Module3DCatalogInput | undefined>(() => {
    if (!optionGroups || !catalogMaterials || !catalogEdges) return undefined;
    return {
      modules: [],
      structures: [],
      components: catalogComponents,
      materials: catalogMaterials,
      edges: catalogEdges,
      hardware: catalogHardware,
      optionGroups,
      agregados,
    };
  }, [
    optionGroups,
    catalogMaterials,
    catalogEdges,
    catalogComponents,
    catalogHardware,
    agregados,
  ]);

  const handleCreateNew = () => {
    const fresh = createEmptyAgregadoDraft();
    seedEditorDraftFromBaseline(draftKey, fresh, setDraft, setInitialDraft);
    setEditingId(null);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
    seededEditIdRef.current = 'new';
  };

  const handleEdit = (item: Agregado) => {
    const fresh = agregadoToDraft(item);
    seedEditorDraftFromBaseline(draftKey, fresh, setDraft, setInitialDraft);
    setEditingId(item.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
    seededEditIdRef.current = item.id;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!draft.code.trim()) {
      setError('El código es obligatorio.');
      setEditorTab('general');
      return;
    }
    if (!draft.name.trim()) {
      setError('El nombre es obligatorio.');
      setEditorTab('general');
      return;
    }
    // Code uniqueness check
    const codeConflict = agregados.find(
      (a) => a.code.toLowerCase() === draft.code.trim().toLowerCase() && a.id !== editingId,
    );
    if (codeConflict) {
      setError(`El código "${draft.code}" ya está en uso.`);
      setEditorTab('general');
      return;
    }

    if (editingId) {
      onUpdate(draftToAgregado(editingId, draft));
    } else {
      const newId = `agr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      onCreate(draftToAgregado(newId, draft));
    }
    forceCloseEditor();
  };

  const [view3dItem, setView3dItem] = useState<Agregado | null>(null);

  const inlineEditMode = modalOpen;

  const selectedAgregado = expandedId
    ? (agregados.find((a) => a.id === expandedId) ?? null)
    : null;

  return (
    <>
      <EntityEditorLayout
        dataTestId="agregados-screen"
        editorPageTestId="agregado-editor-page"
        editorBackTestId="agregado-editor-back"
        discardConfirmTestId="agregado-editor-discard-confirm"
        modalTestId="agregado-modal"
        entityTitle="agregado"
        createTitle="Nuevo Agregado"
        editTitle="Editar Agregado"
        draftCode={draft.code}
        formId={formId}
        modalOpen={modalOpen}
        confirmDiscard={confirmDiscard}
        editingId={editingId}
        inlineEditMode={inlineEditMode}
        isSelected={!!selectedAgregado}
        closeModal={closeModal}
        setConfirmDiscard={setConfirmDiscard}
        forceCloseEditor={forceCloseEditor}
        headerActions={
          <>
            <button
              type="button"
              className="btn"
              onClick={closeModal}
              data-testid="agregado-editor-cancel"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              form={formId}
              data-testid="agregado-save-btn"
            >
              Guardar
            </button>
          </>
        }
        renderListView={() => (
          <AgregadoListView
            rows={rows}
            search={search}
            setSearch={setSearch}
            canMutate={canMutate}
            onCreate={handleCreateNew}
            onOpenDetail={(item) => setSelectedId(item.id)}
          />
        )}
        renderDetailView={
          selectedAgregado
            ? () => (
                <AgregadoDetailView
                  agregado={selectedAgregado}
                  catalogComponents={catalogComponents}
                  catalogHardware={catalogHardware}
                  onBack={() => setSelectedId(null)}
                  onEdit={handleEdit}
                  onView3D={catalogInput ? (item) => setView3dItem(item) : undefined}
                  onDelete={canMutate && onDelete ? onDelete : undefined}
                  canMutate={canMutate}
                  optionGroups={optionGroups}
                />
              )
            : undefined
        }
        renderEditorForm={() => (
          <AgregadoEditorForm
            formId={formId}
            error={error}
            onSubmit={onSubmit}
            editorTab={editorTab as AgregadoEditorTab}
            setEditorTab={setEditorTab as Dispatch<SetStateAction<AgregadoEditorTab>>}
            draft={draft}
            setDraft={setDraft}
            editingId={editingId}
            catalogComponents={catalogComponents}
            catalogHardware={catalogHardware}
            catalogInput={catalogInput}
            resolveImageUrl={resolveImageUrl}
          />
        )}
      />

      {catalogInput ? (
        <Agregado3DModal
          open={Boolean(view3dItem)}
          agregado={view3dItem}
          catalog={catalogInput}
          onClose={() => setView3dItem(null)}
          resolveMediaUrl={resolveImageUrl}
        />
      ) : null}
    </>
  );
}
