/**
 * Components ABM — reusable engineering pieces for module composition.
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
import type { Component, OptionGroup, MaterialBoard, PlacementDims } from '@granete/domain';
import {
  evaluatePartFormula,
  hasAmbiguousOptionRoles,
  previewPartForComponent,
} from '@granete/domain';
import {
  EntityEditorLayout,
  draftSessionKey,
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
import {
  componentToDraft,
  emptyComponentDraft,
  isComponentDraft,
  placementLabel,
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
  const [placementFilter, setPlacementFilter] = useState<string>('all');
  /** Last edit-id we seeded into the draft — prevents wipe on `components` identity churn. */
  const seededEditIdRef = useRef<string | null>(null);

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

  const draftKey = draftSessionKey('component', openComponentEditId ?? 'idle');
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
    draftValidator: isComponentDraft,
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
   * Seed draft only when `openComponentEditId` changes (or when a real id
   * first becomes available). Do NOT re-seed on unrelated `components`
   * identity changes — that wipes in-progress edits / session draft (C1).
   */
  useEffect(() => {
    if (openComponentEditId == null || openComponentEditId === '') {
      setModalOpen(false);
      setEditingId(null);
      seededEditIdRef.current = null;
      return;
    }
    if (openComponentEditId === 'new') {
      if (seededEditIdRef.current === 'new') return;
      // Do not wipe session-restored draft on F5/remount (R3-C1).
      seedEditorDraftFromBaseline(
        draftKey,
        emptyComponentDraft(),
        setDraft,
        setInitialDraft,
        isComponentDraft,
      );
      setEditingId(null);
      setEditorTab('general');
      setError(null);
      setModalOpen(true);
      seededEditIdRef.current = 'new';
      return;
    }
    if (seededEditIdRef.current === openComponentEditId) return;
    const component = components.find((c) => c.id === openComponentEditId);
    if (!component) return; // wait until entity is available, then seed once
    // Entity baseline for dirty compare; keep session draft if present (R3-C1).
    seedEditorDraftFromBaseline(
      draftKey,
      componentToDraft(component),
      setDraft,
      setInitialDraft,
      isComponentDraft,
    );
    setEditingId(component.id);
    setEditorTab('general');
    setError(null);
    setModalOpen(true);
    seededEditIdRef.current = openComponentEditId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openComponentEditId, components]);

  const rows = useMemo(() => {
    let filtered = filterCatalogItems(normalizedComponents, {
      status,
      query: debouncedSearch,
      matchItem: (item, q) => {
        const hay =
          `${item.code} ${item.name} ${placementLabel(item.placement)}`.toLocaleLowerCase(
            'es-UY',
          );
        return hay.includes(q);
      },
    });
    if (placementFilter !== 'all') {
      filtered = filtered.filter((c) => c.placement === placementFilter);
    }
    return filtered;
  }, [normalizedComponents, status, debouncedSearch, placementFilter]);

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
    // Base dims required only when no formula replaces them (C8). Thickness always required.
    const lengthOk = draft.lengthFormula.trim() ? true : draft.lengthMm > 0;
    const widthOk = draft.widthFormula.trim() ? true : draft.widthMm > 0;
    const thicknessOk = draft.thicknessMm > 0;
    if (!lengthOk || !widthOk || !thicknessOk) {
      const offenders: string[] = [];
      if (!lengthOk) offenders.push('el largo');
      if (!widthOk) offenders.push('el ancho');
      if (!thicknessOk) offenders.push('el espesor');
      setError(
        `Revisá las dimensiones: ${offenders.join(', ')} debe(n) ser mayor a 0.`,
      );
      setEditorTab('geometry');
      return;
    }

    // Validate non-empty formulas against sample container dims (C3).
    const sampleDims = {
      W: containerDims.PW,
      H: containerDims.PH,
      D: containerDims.PD,
      PW: containerDims.PW,
      PH: containerDims.PH,
      PD: containerDims.PD,
      T: draft.thicknessMm > 0 ? draft.thicknessMm : 18,
      i: 0,
    };
    const formulaChecks: readonly {
      readonly label: string;
      readonly formula: string;
      readonly field: 'length' | 'width' | 'x' | 'y' | 'z';
    }[] = [
      { label: 'largo', formula: draft.lengthFormula, field: 'length' },
      { label: 'ancho', formula: draft.widthFormula, field: 'width' },
      { label: 'posición X', formula: draft.xFormula, field: 'x' },
      { label: 'posición Y', formula: draft.yFormula, field: 'y' },
      { label: 'posición Z', formula: draft.zFormula, field: 'z' },
    ];
    for (const check of formulaChecks) {
      if (!check.formula.trim()) continue;
      try {
        evaluatePartFormula(check.formula, sampleDims, {
          structureCode: draft.code.trim() || 'component',
          partDescription: draft.name.trim() || 'component',
          field: check.field,
        });
      } catch {
        setError(`La fórmula de ${check.label} no es válida.`);
        setEditorTab('geometry');
        return;
      }
    }

    if (!draft.optionRoles.trim()) {
      setError(
        'Falta al menos un rol de opción. Abrí la pestaña Opciones y elegí un grupo.',
      );
      setEditorTab('options');
      return;
    }
    // #403 / MT-2: una pieza de tablero sigue una única selección de material.
    // Un segundo rol se vería configurable pero nunca controlaría la pieza.
    if (hasAmbiguousOptionRoles(draft.optionRoles.split(','))) {
      setError(
        'Elegí un único rol de opción: el motor usa sólo el primero y un rol extra quedaría sin efecto.',
      );
      setEditorTab('options');
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
          placementFilter={placementFilter}
          setPlacementFilter={setPlacementFilter}
          canMutate={canMutate}
          onCreate={handleCreateNew}
          onOpenDetail={(item) => setSelectedId(item.id)}
          optionGroups={optionGroups}
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
                optionGroups={optionGroups}
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
