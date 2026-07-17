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

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyStructureDraft());
    setEditorTab('general');
    setError(null);
  };

  const handleCreateNew = () => {
    setDraft(emptyStructureDraft());
    setEditingId(null);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const handleEdit = (item: Structure) => {
    setDraft(structureToDraft(item));
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
    closeModal();
  };

  const handleDelete = () => {
    if (deleteConfirmId) {
      onDelete(deleteConfirmId);
      if (expandedId === deleteConfirmId) {
        setSelectedId(null);
      }
      setDeleteConfirmId(null);
    }
  };

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
    </div>
  );
}
