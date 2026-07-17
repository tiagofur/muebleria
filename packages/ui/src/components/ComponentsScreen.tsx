/**
 * Components ABM — reusable engineering pieces for module composition.
 */

import {
  useId,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { Component, OptionGroup } from '@muebles/domain';
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
import './components.css';

export type { ComponentDraft };
export {
  COMPONENT_PLACEMENTS,
  PLACEMENT_LABEL,
} from './componentDraft';

export interface ComponentsScreenProps {
  readonly components: readonly Component[];
  readonly optionGroups: readonly OptionGroup[];
  readonly onCreate: (draft: ComponentDraft) => void;
  readonly onUpdate: (id: string, draft: ComponentDraft) => void;
  readonly onToggleActive: (id: string) => void;
  readonly canMutate: boolean;
  readonly openComponentId?: string | null;
  readonly onSelectionChange?: (id: string | null) => void;
}

export function ComponentsScreen({
  components,
  optionGroups,
  onCreate,
  onUpdate,
  onToggleActive,
  canMutate = true,
  openComponentId = null,
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
  const [editorTab, setEditorTab] = useState<ComponentEditorTab>('general');
  const [error, setError] = useState<string | null>(null);

  const previewParts = useMemo(() => {
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
        materialId: 'preview-material',
      },
    ];
  }, [draft]);

  const normalizedComponents = useMemo(() => {
    return components.map((c) => ({
      ...c,
      active: c.active !== false,
    }));
  }, [components]);

  const rows = useMemo(
    () =>
      filterCatalogItems(normalizedComponents, {
        status,
        query: debouncedSearch,
      }),
    [normalizedComponents, status, debouncedSearch],
  );

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setDraft(emptyComponentDraft());
    setEditorTab('general');
    setError(null);
  };

  const handleCreateNew = () => {
    setDraft(emptyComponentDraft());
    setEditingId(null);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
  };

  const handleEdit = (item: Component) => {
    setDraft(componentToDraft(item));
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
    closeModal();
  };

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
        />
      </Modal>
    </div>
  );
}
