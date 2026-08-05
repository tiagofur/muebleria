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
import type { Component, OptionGroup, MaterialBoard, PlacementDims } from '@muebles/domain';
import { previewPartForComponent } from '@muebles/domain';
import {
  EntityEditorLayout,
  useDebouncedValue,
  useEntityEditorState,
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
import { ComponentDetailView } from './editor/ComponentDetailView';
import { ComponentEditorForm } from './editor/ComponentEditorForm';
import { ComponentListView } from './editor/ComponentListView';
import { materialColorMap, materialTextureMap } from '../preview3d';
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
  const { selectedId: expandedId, setSelectedId } =
    useRoutableEntitySelection({
      openEntityId: openComponentId,
      onSelectionChange,
      knownIds: componentIds,
    });

  const draftKey = `component-draft:${openComponentEditId ?? 'idle'}`;
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
  } = useEntityEditorState<ComponentDraft, ComponentEditorTab>({
    draftKey,
    emptyDraft: emptyComponentDraft,
    defaultTab: 'general',
    onEditorClose: (restoreId) => {
      if (onRequestEdit) {
        onRequestEdit(null as any);
      } else if (onSelectionChange) {
        onSelectionChange(restoreId);
      }
    },
    currentSelectionId: expandedId,
  });

  const materialColors = useMemo(
    () => materialColorMap(materials),
    [materials],
  );
  const materialTextures = useMemo(
    () => materialTextureMap(materials),
    [materials],
  );

  // Reference container (the "mueble" the piece belongs to). Defaults match a
  // standard cabinet; the carpenter edits these so position formulas (X/Y/Z)
  // resolve against the right PW/PH/PD. T always tracks the draft thickness.
  const [containerDims, setContainerDims] = useState<PlacementDims>({
    PW: 600,
    PH: 720,
    PD: 560,
    T: 18,
  });
  const [showInContext, setShowInContext] = useState(true);

  // Keep T in sync with the draft thickness so preview formulas using T stay true.
  useEffect(() => {
    setContainerDims((prev) =>
      prev.T === draft.thicknessMm
        ? prev
        : { ...prev, T: draft.thicknessMm || prev.T },
    );
  }, [draft.thicknessMm]);

  // Resolve the preview part via the domain helper (no math in React): it applies
  // the placement heuristic + evaluates length/width/x/y/z formulas against the
  // container dims. Replaces the old buggy inline builder that forced x/y/z = 0
  // and collapsed rotateX === null to 0, dropping the placement heuristic.
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
      previewPartForComponent(
        {
          placement: draft.placement,
          lengthMm: draft.lengthMm,
          widthMm: draft.widthMm,
          thicknessMm: draft.thicknessMm,
          lengthFormula: draft.lengthFormula,
          widthFormula: draft.widthFormula,
          xFormula: draft.xFormula,
          yFormula: draft.yFormula,
          zFormula: draft.zFormula,
          rotateX: draft.rotateX,
          rotateY: draft.rotateY,
          rotateZ: draft.rotateZ,
          optionRole: draft.optionRoles.split(',')[0]?.trim() || 'INTERIOR',
          description: draft.name || 'Componente de Prueba',
          materialId: firstMaterialId,
        },
        containerDims,
      ),
    ];
  }, [draft, optionGroups, containerDims]);

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
    if (openComponentEditId == null || openComponentEditId === '') {
      setModalOpen(false);
      setEditingId(null);
      return;
    }
    if (openComponentEditId === 'new') {
      const fresh = emptyComponentDraft();
      setDraft(fresh);
      setInitialDraft(fresh);
      setEditingId(null);
      setEditorTab('general');
      setError(null);
      setModalOpen(true);
      return;
    }
    const component = components.find((c) => c.id === openComponentEditId);
    if (!component) return;
    const fresh = componentToDraft(component);
    setDraft(fresh);
    setInitialDraft(fresh);
    setEditingId(component.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openComponentEditId, components]);

  const rows = useMemo(
    () =>
      filterCatalogItems(normalizedComponents, {
        status,
        query: debouncedSearch,
      }),
    [normalizedComponents, status, debouncedSearch],
  );

  // F059: isDraftDirty, forceCloseEditor, closeModal come from useEntityEditorState.

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
      const offenders: string[] = [];
      if (draft.lengthMm <= 0) offenders.push('el largo');
      if (draft.widthMm <= 0) offenders.push('el ancho');
      if (draft.thicknessMm <= 0) offenders.push('el espesor');
      setError(
        `Revisá las dimensiones: ${offenders.join(', ')} debe(n) ser mayor a 0.`,
      );
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

  // Fase 5 UI: always full-page workspace editor (same pattern as modules).
  const inlineEditMode = modalOpen;

  const selectedComponent = expandedId
    ? (normalizedComponents.find((c) => c.id === expandedId) ?? null)
    : null;

  return (
    <EntityEditorLayout
      dataTestId="components-screen"
      editorPageTestId="component-editor-page"
      editorBackTestId="component-editor-back"
      discardConfirmTestId="component-editor-discard-confirm"
      modalTestId="component-modal"
      entityTitle="componente"
      createTitle="Nuevo componente"
      editTitle="Editar componente"
      draftCode={draft.code}
      formId={formId}
      modalOpen={modalOpen}
      confirmDiscard={confirmDiscard}
      editingId={editingId}
      inlineEditMode={inlineEditMode}
      isSelected={!!selectedComponent}
      closeModal={closeModal}
      setConfirmDiscard={setConfirmDiscard}
      forceCloseEditor={forceCloseEditor}
      headerActions={
        <>
          <button
            type="button"
            className="btn"
            onClick={closeModal}
            data-testid="component-editor-cancel"
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
        <ComponentListView
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
        selectedComponent
          ? () => (
              <ComponentDetailView
                component={selectedComponent}
                onBack={() => setSelectedId(null)}
                onEdit={handleEdit}
                onToggleActive={canMutate ? handleToggleActive : undefined}
                canMutate={canMutate}
              />
            )
          : undefined
      }
      renderEditorForm={() => (
        <ComponentEditorForm
          formId={formId}
          error={error}
          onSubmit={onSubmit}
          editorTab={editorTab}
          setEditorTab={setEditorTab}
          draft={draft}
          setDraft={setDraft}
          editingId={editingId}
          optionGroups={optionGroups}
          previewParts={previewParts}
          materialColors={materialColors}
          materialTextures={materialTextures}
          containerDims={containerDims}
          onContainerDimsChange={setContainerDims}
          showInContext={showInContext}
          onShowInContextChange={setShowInContext}
        />
      )}
    />
  );
}
