/**
 * Module (mueble plantilla) ABM — cards + detail + Modal LG (F021).
 * Cost formulas live in the shell; this component only renders cost props.
 */

import {
  useId,
  type ReactNode,
} from 'react';
import type {
  Agregado,
  Component,
  Hardware,
  Module,
  ModuleCategory,
  OptionGroup,
  QuoteBreakdown,
  Structure,
  MaterialBoard,
  EdgeBand,
} from '@granete/domain';
import {
  EntityEditorLayout,
  Modal,
  PageLoading,
} from '../common';
import '../catalogs/catalogs.css';
import {
  moduleToDraft,
  type BoardPartDraft,
  type CategoryDraft,
  type ComponentInstanceDraft,
  type HardwareLineDraft,
  type ModuleDraft,
} from './moduleHelpers';
import { ModuleCategoryModals } from './components/ModuleCategoryModals';
import { ModuleComponentAdderModal } from './components/ModuleComponentAdderModal';
import { CostPreviewPanel } from './components/CostPreviewPanel';
import { ModuleDetailView } from './components/ModuleDetailView';
import { ModuleEditorForm } from './components/ModuleEditorForm';
import { ModuleListView } from './components/ModuleListView';
import { Module3DModal } from './components/Module3DModal';
import { useModulesScreenState } from './helpers/useModulesScreenState';
import './modules.css';

export type { ModuleDraft, BoardPartDraft, HardwareLineDraft, CategoryDraft, ComponentInstanceDraft };

export interface ModulesScreenProps {
  /** When true, show section loading (workspace/async gate). */
  readonly loading?: boolean;
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly hardware: readonly Hardware[];
  readonly catalogAgregados?: readonly Agregado[];
  readonly materials?: readonly MaterialBoard[];
  readonly edges?: readonly EdgeBand[];
  /** Hierarchical categories (MOD-09). Default empty. */
  readonly categories?: readonly ModuleCategory[];
  readonly onCreate: (draft: ModuleDraft) => void;
  readonly onUpdate: (id: string, draft: ModuleDraft) => void;
  readonly onDelete: (id: string) => void;
  readonly onCreateCategory?: (draft: CategoryDraft) => void;
  readonly onUpdateCategory?: (id: string, draft: CategoryDraft) => void;
  readonly onDeleteCategory?: (id: string) => void;
  /** Deep-copy module (MOD-05). Shell owns id/code generation. */
  readonly onDuplicate?: (id: string) => void;
  /**
   * Notifies parent when the module used for domain cost preview changes
   * (detail selection or edit modal). Null = none / create mode.
   */
  readonly onEditingChange?: (moduleId: string | null) => void;
  /** Domain QuoteBreakdown from shell (MOD-06). Null when blocked/unavailable. */
  readonly costPreview?: QuoteBreakdown | null;
  readonly previewBlocked?: boolean;
  readonly previewError?: string | null;
  readonly missingGroups?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  /**
   * Sale-price estimate per module id (domain-computed in shell).
   * `null` value = blocked / unavailable.
   */
  readonly moduleEstimates?: Readonly<Record<string, number | null>>;
  /**
   * Incrementing token to open the create-module modal from outside
   * (Dashboard quick action). 0 / undefined = no request.
   */
  readonly requestCreateKey?: number;
  /**
   * Open detail for this module id when set (URL `/modules/:id` or shell handoff).
   * null / '' = list view.
   */
  readonly openModuleId?: string | null;
  /**
   * Open editor for this module id when set (URL `/modules/:id/edit`, Fase 3 UI).
   * Sentinel `'new'` means create-new editor. null / undefined = not in edit mode.
   */
  readonly openModuleEditId?: string | null;
  /**
   * Navigate to the editor route. The shell handles the URL change.
   * Pass `'new'` for the create-new editor.
   */
  readonly onRequestEdit?: (moduleId: string) => void;
  /** Notifies parent when detail selection changes (for URL sync). */
  readonly onSelectionChange?: (moduleId: string | null) => void;
  /** Catalog structures for composed module picker. */
  readonly structures?: readonly Structure[];
  /** Catalog components for composed module adder. */
  readonly catalogComponents?: readonly Component[];
  /** F035: hide ABM when false (read-only templates). */
  readonly canMutate?: boolean;
  /**
   * Upload catalog image (F040). Returns relative media URL for draft.imageUrl.
   * Only used when canMutate is true.
   */
  readonly onUploadImage?: (file: File) => Promise<string>;
  /** Resolve media path for preview. */
  readonly resolveImageUrl?: (url: string | undefined) => string | undefined;
  /**
   * Static board slot (tests / legacy). Prefer `renderBoardEditor` so the
   * canvas follows the live draft (structure + components before save).
   */
  readonly boardEditorSlot?: ReactNode;
  /**
   * Board-first editor for the **current draft** Module. Called on each
   * Components-tab render with a live module + draft-only composition key
   * (so formula edits re-resolve without remounting on BoardEditor drags).
   */
  readonly renderBoardEditor?: (args: {
    readonly module: Module;
    readonly compositionKey: string;
  }) => ReactNode;
  /**
   * Overrides derived from the BoardEditor, keyed by componentId.
   * Merged into the module draft on save so board edits persist.
   */
  readonly boardOverrides?: Readonly<Record<string, unknown>>;
}

export function ModulesScreen({
  modules,
  optionGroups,
  hardware,
  categories = [],
  onCreate,
  onUpdate,
  onDelete,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onDuplicate,
  onEditingChange,
  costPreview = null,
  previewBlocked = false,
  previewError = null,
  missingGroups = [],
  groupLabels,
  moduleEstimates = {},
  requestCreateKey = 0,
  openModuleId = null,
  openModuleEditId = null,
  onRequestEdit,
  onSelectionChange,
  loading = false,
  structures = [],
  catalogComponents = [],
  catalogAgregados = [],
  materials = [],
  edges = [],
  canMutate = true,
  onUploadImage,
  resolveImageUrl = (u) => u,
  boardEditorSlot,
  renderBoardEditor,
  boardOverrides,
}: ModulesScreenProps): ReactNode {
  const formId = useId();
  const categoryFormId = useId();

  const state = useModulesScreenState({
    modules,
    optionGroups,
    hardware,
    categories,
    structures,
    catalogComponents,
    catalogAgregados,
    materials,
    edges,
    onCreate,
    onUpdate,
    onDelete,
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
    onEditingChange,
    requestCreateKey,
    openModuleId,
    openModuleEditId,
    onRequestEdit,
    onSelectionChange,
    boardEditorSlot,
    renderBoardEditor,
    boardOverrides,
  });

  if (loading) {
    return (
      <section className="catalog-page" aria-label="Muebles">
        <PageLoading label="Cargando muebles…" data-testid="modules-loading" />
      </section>
    );
  }

  const modalOpen = state.modalOpen;
  const inlineEditMode = modalOpen;

  return (
    <EntityEditorLayout
      dataTestId="modules-screen"
      editorPageTestId="module-editor-page"
      editorBackTestId="module-editor-back"
      discardConfirmTestId="module-editor-discard-confirm"
      modalTestId="module-modal"
      modalSize="lg"
      createTitle="Nuevo mueble"
      editTitle="Editar mueble"
      draftCode={state.draft.code}
      formId={formId}
      modalOpen={state.modalOpen}
      confirmDiscard={state.confirmDiscard}
      editingId={state.editingId}
      inlineEditMode={inlineEditMode}
      isSelected={!!state.selected}
      closeModal={state.closeModal}
      setConfirmDiscard={state.setConfirmDiscard}
      forceCloseEditor={state.forceCloseEditor}
      headerActions={
        <>
          <button
            type="button"
            className="btn"
            onClick={state.closeModal}
            data-testid="module-editor-cancel"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            form={formId}
            data-testid="module-editor-save"
          >
            Guardar
          </button>
        </>
      }
      renderListView={() => (
        <ModuleListView
          filtered={state.filtered}
          categories={categories}
          categoryFilter={state.categoryFilter}
          setCategoryFilter={state.setCategoryFilter}
          categoryFilterCounts={state.categoryFilterCounts}
          search={state.search}
          setSearch={state.setSearch}
          isTrulyEmpty={state.isTrulyEmpty}
          isFilterEmpty={state.isFilterEmpty}
          canMutate={canMutate}
          moduleEstimates={moduleEstimates}
          onManageCategories={state.openManageCategories}
          onStartCreate={state.startCreate}
          onOpenDetail={state.openDetail}
          onCreateCategory={onCreateCategory}
          resolveImageUrl={resolveImageUrl}
        />
      )}
      renderDetailView={
        state.selected
          ? () => (
              <ModuleDetailView
                module={state.selected!}
                categories={categories}
                catalogComponents={catalogComponents}
                hardwareById={state.hardwareById}
                structures={structures}
                costPreview={costPreview}
                previewBlocked={previewBlocked}
                previewError={previewError}
                missingGroups={missingGroups}
                groupLabels={groupLabels}
                moduleEstimates={moduleEstimates}
                onBack={state.backToList}
                onEdit={state.startEdit}
                onDuplicate={onDuplicate}
                onDelete={(id) => state.setConfirmDeleteId(id)}
                onView3D={(mod) => {
                  state.setViewerModule(mod);
                  state.setShow3DModal(true);
                }}
                resolveImageUrl={resolveImageUrl}
              />
            )
          : undefined
      }
      renderEditorForm={() => {
        const form = (
          <ModuleEditorForm
            formId={formId}
            error={state.error}
            onSubmit={state.handleSubmit}
            editorTab={state.editorTab}
            setEditorTab={state.setEditorTab}
            draft={state.draft}
            setDraft={state.setDraft}
            draftCascade={state.draftCascade}
            draftCascadeOpts={state.draftCascadeOpts}
            setDraftCascadeLevel={state.setDraftCascadeLevel}
            resolveImageUrl={resolveImageUrl}
            onUploadImage={onUploadImage}
            structures={structures}
            selectedStructure={state.selectedStructure ?? undefined}
            catalogComponents={catalogComponents}
            catalogAgregados={catalogAgregados}
            composedEnabled={state.composedEnabled}
            onRequestAddComponent={() => {
              state.setAddComponentOpen(true);
              state.setComponentSearch('');
              state.setNewCompId('');
              state.setNewCompQty(1);
            }}
            canMutate={canMutate}
            hardwareRoles={state.hardwareRoles}
            activeHardware={state.activeHardware}
            onAddHardware={state.addHardwareLine}
            onRemoveHardware={state.removeHardwareLine}
            onUpdateHardware={state.updateLine}
            onHardwareGridKeyDown={state.onHardwareGridKeyDown}
            editingId={state.editingId}
            costPreview={costPreview}
            previewBlocked={previewBlocked}
            previewError={previewError}
            missingGroups={missingGroups}
            groupLabels={groupLabels}
            boardEditorSlot={state.resolvedBoardEditorSlot}
            costAsideVisible={inlineEditMode}
          />
        );

        if (inlineEditMode) {
          return (
            <div className="module-editor-page__body">
              <div className="module-editor-page__main">{form}</div>
              <aside
                className="module-editor-page__aside"
                aria-label="Vista previa de costo"
                data-testid="module-editor-cost-aside"
              >
                <CostPreviewPanel
                  costPreview={costPreview}
                  previewBlocked={previewBlocked}
                  previewError={previewError}
                  missingGroups={missingGroups}
                  groupLabels={groupLabels}
                  allowEmptyHint
                />
              </aside>
            </div>
          );
        }

        return form;
      }}
      extraModals={
        <>
          <ModuleComponentAdderModal
            open={state.addComponentOpen}
            onClose={() => state.setAddComponentOpen(false)}
            componentSearch={state.componentSearch}
            onSearchChange={state.setComponentSearch}
            filteredComponents={state.filteredCatalogComponents}
            newCompId={state.newCompId}
            onSelect={state.setNewCompId}
            newCompQty={state.newCompQty}
            onQtyChange={state.setNewCompQty}
            onConfirm={() => {
              if (!state.newCompId) return;
              state.setDraft((prev) => ({
                ...prev,
                components: [
                  ...prev.components,
                  {
                    componentId: state.newCompId,
                    quantity: state.newCompQty,
                  },
                ],
              }));
              state.setAddComponentOpen(false);
            }}
          />

          <ModuleCategoryModals
            categories={categories}
            flatCategories={state.flatCategories}
            manageOpen={state.manageCategoriesOpen}
            onCloseManage={state.closeManageCategories}
            onOpenCreate={state.openCreateCategory}
            formOpen={state.categoryModalOpen}
            onCloseForm={state.closeCategoryModal}
            categoryFormId={categoryFormId}
            editingCategoryId={state.editingCategoryId}
            categoryDraft={state.categoryDraft}
            setCategoryDraft={state.setCategoryDraft}
            categoryError={state.categoryError}
            onSubmitForm={state.handleCategorySubmit}
            onEditCategory={state.openEditCategory}
            onRequestDeleteCategory={state.setConfirmDeleteCategoryId}
            onCreateCategory={onCreateCategory}
            onDeleteCategory={onDeleteCategory}
            deleteTarget={state.deleteCategoryTarget}
            confirmDeleteCategoryId={state.confirmDeleteCategoryId}
            onCancelDelete={() => state.setConfirmDeleteCategoryId(null)}
            onConfirmDelete={() => {
              if (state.confirmDeleteCategoryId) {
                state.handleDeleteCategory(state.confirmDeleteCategoryId);
              }
            }}
          />

          <Modal
            open={state.deleteTarget != null}
            onClose={() => state.setConfirmDeleteId(null)}
            title="Eliminar mueble"
            size="sm"
            footer={
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => state.setConfirmDeleteId(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => {
                    if (state.confirmDeleteId) state.handleDelete(state.confirmDeleteId);
                  }}
                >
                  Eliminar
                </button>
              </>
            }
          >
            <p className="project-confirm-modal__text">
              ¿Seguro que querés eliminar{' '}
              <strong>
                {state.deleteTarget
                  ? `${state.deleteTarget.code} — ${state.deleteTarget.name}`
                  : 'este mueble'}
              </strong>
              ? Esta acción no se puede deshacer.
            </p>
          </Modal>

          <Module3DModal
            open={state.show3DModal}
            module={state.viewerModule}
            catalog={state.module3dCatalog}
            resolveMediaUrl={resolveImageUrl}
            canMutate={canMutate}
            onUploadImage={onUploadImage}
            onApplyCatalogImage={
              canMutate
                ? (moduleId, imageUrl) => {
                    const mod = modules.find((m) => m.id === moduleId);
                    if (!mod) return;
                    onUpdate(moduleId, {
                      ...moduleToDraft(mod),
                      imageUrl,
                    });
                    state.setViewerModule({ ...mod, imageUrl });
                  }
                : undefined
            }
            onClose={() => {
              state.setShow3DModal(false);
              state.setViewerModule(null);
            }}
          />
        </>
      }
    />
  );
}
