/**
 * Project detail view (F058b) — extracted from ProjectsScreen.renderDetail.
 *
 * Renders the sticky workspace chrome (status + total + action buttons) and
 * the 2-column body (main with options/measure defaults/panels/items +
 * aside with totals + material summary).
 *
 * All state lives in the parent (ProjectsScreen) and is passed down as
 * controlled props: navigation handlers reset most of it and several pieces
 * (3D viewer, add-item) are consumed by sibling modals in the parent.
 */

import type { ReactNode } from 'react';
import type {
  Customer,
  EdgeBand,
  ExportIssue,
  FurnitureType,
  Hardware,
  MaterialBoard,
  Module,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  ProjectMaterialSummary,
  ProjectTemplate,
  QuoteBreakdown,
} from '@muebles/domain';
import {
  estimateBoardSheets,
  parseNestingImportCsv,
  nestingImportFromRows,
  isProjectClosed,
} from '@muebles/domain';
import {
  AlertCircle,
  ChevronLeft,
  Copy,
  LayoutTemplate,
  Pencil,
  Plus,
  Trash2,
  Box,
} from 'lucide-react';
import {
  DropdownMenu,
  type DropdownMenuSection,
  InlineLoading,
} from '../../common';
import { PricePreviewGate } from '../../optionGroups/PricePreviewGate';
import { ExportIssueList } from '../ExportIssueList';
import { KitchenPlanPanel } from './KitchenPlanPanel';
import { QuoteScenarioCompare } from './QuoteScenarioCompare';
import { InstallationChecklistPanel } from './InstallationChecklistPanel';
import { ProjectItemStructureRevisionIndicator } from './ProjectItemStructureRevisionIndicator';
import { StatusBadge } from './StatusBadge';
import {
  formatIsoDate,
  formatProjectMoney,
  groupsForModuleItem,
  optionLabelForId,
  optionsForGroup,
  resolveCustomerName,
  furnitureTypeLabel,
} from '../projectHelpers';

/** Catalogs bag used to resolve option groups → options for selects. */
export interface ProjectDetailCatalogs {
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
}

/** Item-level action handlers shared by the detail view. */
export interface ProjectDetailItemHandlers {
  readonly onUpdateItemQuantity: (item: ProjectItem, quantity: number) => void;
  readonly onUpdateItemMeasurePreset: (
    item: ProjectItem,
    measurePresetId: string,
  ) => void;
  readonly onUpdateItemChoice: (
    item: ProjectItem,
    groupCode: string,
    optionId: string,
  ) => void;
  readonly onRemoveItem: (projectId: string, itemId: string) => void;
}

/** Per-item inline-remove confirm state (controlled by parent). */
export interface ProjectDetailRemoveConfirm {
  readonly confirmRemoveItemId: string | null;
  readonly onRequestRemoveItem: (itemId: string) => void;
  readonly onCancelRemoveItem: () => void;
  readonly onConfirmRemoveItem: (projectId: string, itemId: string) => void;
}

/** 3D viewer trigger handlers (modal lives in parent). */
export interface ProjectDetail3DHandlers {
  readonly onOpenQuote3D: () => void;
  readonly onOpenItem3D: (item: ProjectItem, mod: Module) => void;
}

export interface ProjectDetailViewProps {
  // --- Project data ---
  readonly project: Project;
  /** Sale-price estimates per project id (domain-computed in shell). */
  readonly projectEstimates: Readonly<Record<string, number | null>>;

  // --- Catalog data ---
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalogs: ProjectDetailCatalogs;
  readonly customers: readonly Customer[];
  /** Owner id → label map for the responsable line. */
  readonly ownerLabels: Readonly<Record<string, string>>;

  // --- Breakdown / totals ---
  readonly breakdown?: QuoteBreakdown | null;
  readonly materialSummary?: ProjectMaterialSummary | null;
  readonly breakdownLoading?: boolean;
  readonly breakdownError?: string | null;
  readonly previewBlocked?: boolean;
  readonly missingGroups?: readonly string[];
  readonly groupLabels?: Readonly<Record<string, string>>;
  readonly showCosts: boolean;

  // --- Export menu (precomputed by parent) ---
  readonly exportMenu: {
    readonly sections: readonly DropdownMenuSection[];
    readonly onClose?: () => void;
  };
  readonly exportBlockMessage: ReactNode;
  readonly exportErrors: readonly ExportIssue[];
  readonly exportBusy: boolean;
  readonly exportBlocked: boolean;
  readonly productionExportDisabled: boolean;
  readonly productionExportOk: boolean;
  readonly onExport?: () => void | Promise<void>;

  // --- Item handlers + inline-remove confirm ---
  readonly itemHandlers: ProjectDetailItemHandlers;
  readonly removeConfirm: ProjectDetailRemoveConfirm;

  // --- Project-level choice / measure handlers ---
  readonly updateProjectLevelChoice: (
    groupCode: string,
    optionId: string,
  ) => void;
  /**
   * Shell callback that persists merged measure defaults (#109). When omitted,
   * the measure-defaults section is not rendered.
   */
  readonly onUpdateMeasureDefaults?: (
    projectId: string,
    defaults:
      | {
          readonly [type in FurnitureType]?: {
            readonly depth?: number;
            readonly height?: number;
          };
        }
      | undefined,
  ) => void;

  // --- 3D viewer ---
  readonly viewer3D: ProjectDetail3DHandlers;

  // --- Item error (detail-side quantity/measure errors) ---
  readonly itemError: string | null;
  readonly addItemModalOpen: boolean;

  // --- Add-item modal trigger ---
  readonly onOpenAddItemModal: () => void;

  // --- Navigation / chrome action handlers ---
  readonly onBackToList: () => void;
  readonly onOpenPresentation: () => void;
  readonly onEditMeta: (project: Project) => void;
  readonly onDuplicate?: (id: string) => void;
  readonly onSaveAsTemplate?: (projectId: string) => void;
  readonly onMarkProduced?: (projectId: string) => void;
  readonly onRequestReopen: () => void;
  readonly onRequestDelete: () => void;

  // --- Kitchen layout / scenarios / checklist / nesting callbacks ---
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@muebles/domain').ProjectKitchenLayout,
  ) => void;
  readonly onApplyScenarioB?: (
    projectId: string,
    role: string,
    choiceId: string,
  ) => void;
  readonly onDuplicateWithScenarioB?: (
    projectId: string,
    role: string,
    choiceId: string,
  ) => void;
  readonly onUpdateInstallationChecklist?: (
    projectId: string,
    items: readonly import('@muebles/domain').InstallationChecklistItem[],
  ) => void;
  readonly onImportNesting?: (
    projectId: string,
    nestingImport: NonNullable<Project['nestingImport']>,
  ) => void;
  readonly onUpdateProjectLevelChoices?: (
    projectId: string,
    choices: OptionChoices,
  ) => void;

  // --- Permission flags ---
  readonly canMutate: boolean;
  readonly canDelete: boolean;
  readonly canReopen: boolean;
  readonly canMarkProduced: boolean;
  readonly projectTemplates?: readonly ProjectTemplate[];
}

export function ProjectDetailView({
  project,
  projectEstimates,
  modules,
  optionGroups,
  catalogs,
  customers,
  ownerLabels,
  breakdown = null,
  materialSummary = null,
  breakdownLoading = false,
  breakdownError = null,
  previewBlocked = false,
  missingGroups = [],
  groupLabels,
  showCosts,
  exportMenu,
  exportBlockMessage,
  exportErrors = [],
  exportBusy = false,
  exportBlocked = false,
  productionExportDisabled,
  productionExportOk,
  onExport,
  itemHandlers,
  removeConfirm,
  updateProjectLevelChoice,
  onUpdateMeasureDefaults,
  viewer3D,
  itemError,
  addItemModalOpen,
  onOpenAddItemModal,
  onBackToList,
  onOpenPresentation,
  onEditMeta,
  onDuplicate,
  onSaveAsTemplate,
  onMarkProduced,
  onRequestReopen,
  onRequestDelete,
  onUpdateKitchenLayout,
  onApplyScenarioB,
  onDuplicateWithScenarioB,
  onUpdateInstallationChecklist,
  onImportNesting,
  onUpdateProjectLevelChoices,
  canMutate,
  canDelete,
  canReopen,
  canMarkProduced,
}: ProjectDetailViewProps): ReactNode {
  const saleEstimate = projectEstimates[project.id];
  const chromeSale =
    breakdown?.salePrice ??
    (typeof saleEstimate === 'number' ? saleEstimate : null);

  /**
   * Merge a partial measure default (per furnitureType, depth/height) into the
   * project's measureDefaults (#109). Empty values clear the dimension; a type
   * with no remaining dims is dropped; an empty map clears the whole field.
   */
  const updateMeasureDefaults = (
    type: FurnitureType,
    field: 'depth' | 'height',
    value: string,
  ) => {
    if (!onUpdateMeasureDefaults) return;
    const prev = { ...(project.measureDefaults ?? {}) } as Record<
      FurnitureType,
      { depth?: number; height?: number } | undefined
    >;
    const typeEntry = prev[type] ? { ...prev[type]! } : {};
    const parsed = value.trim() === '' ? undefined : Number(value);
    if (field === 'depth') {
      if (parsed === undefined || Number.isNaN(parsed)) delete typeEntry.depth;
      else typeEntry.depth = parsed;
    } else {
      if (parsed === undefined || Number.isNaN(parsed)) delete typeEntry.height;
      else typeEntry.height = parsed;
    }
    if (typeEntry.depth === undefined && typeEntry.height === undefined) {
      delete prev[type];
    } else {
      prev[type] = typeEntry;
    }
    const hasAny = (Object.keys(prev) as FurnitureType[]).some(
      (k) => prev[k] !== undefined,
    );
    onUpdateMeasureDefaults(
      project.id,
      hasAny ? (prev as Project['measureDefaults']) : undefined,
    );
  };

  return (
    <div className="project-detail" data-testid="project-detail">
      {/* Sticky tool chrome: status + total + primary export stay visible while scrolling */}
      <header
        className="workspace-chrome"
        data-testid="project-detail-chrome"
      >
        <div className="workspace-chrome__lead">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={onBackToList}
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
            Lista
          </button>
          <div className="workspace-chrome__identity">
            <div className="workspace-chrome__title-row">
              <h2 className="workspace-chrome__title">{project.name}</h2>
              <StatusBadge status={project.status} />
            </div>
            <p className="workspace-chrome__subtitle">
              {resolveCustomerName(project.customerId, customers)}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {project.items.length} mueble
              {project.items.length === 1 ? '' : 's'}
              <span className="workspace-chrome__dot" aria-hidden>
                ·
              </span>
              {project.currency}
              {showCosts ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>
                    ·
                  </span>
                  Margen ×{project.marginFactor.toFixed(2)}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="workspace-chrome__total" data-testid="project-detail-total">
          <span className="workspace-chrome__total-label">Precio de venta</span>
          <span
            className={
              chromeSale == null
                ? 'workspace-chrome__total-value workspace-chrome__total-value--muted'
                : 'workspace-chrome__total-value'
            }
          >
            {chromeSale == null
              ? '—'
              : formatProjectMoney(chromeSale, project.currency)}
          </span>
        </div>
        <div className="workspace-chrome__actions">
          {/*
            Chrome — agrupación Fase 2 UI (design.md §6.2):
              1) Exportar Optimizer (primary): el más usado en planta. Visible
                 solo si el callback está presente y la acción está habilitada
                 (rol + status + no bloqueado). En otro caso se va al menú.
              2) Más exports ▾ (DropdownMenu): los 6 exports restantes, agrupados
                 por Producción / Comercial. Cada ítem con su propio disabled.
              3) Presentar, Editar/Duplicar/Guardar plantilla, Marcar en
                 producción, Reabrir, Eliminar — directos (estados/CRUD).
          */}
          {onExport ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={productionExportDisabled}
              title={
                !productionExportOk
                  ? 'Export de producción solo en Aceptado o En producción'
                  : 'Exportar cut-list Optimizer (.xlsx)'
              }
              onClick={() => {
                void onExport?.();
              }}
              data-testid="project-chrome-export"
            >
              {exportBusy ? 'Exportando…' : 'Exportar Optimizer'}
            </button>
          ) : null}
          {exportMenu.sections.length > 0 ? (
            <DropdownMenu
              ariaLabel="Más exports"
              triggerLabel={exportBusy ? 'Exportando…' : 'Más exports'}
              triggerClassName="btn"
              disabled={exportBusy}
              sections={exportMenu.sections}
              onClose={exportMenu.onClose}
            />
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={onOpenPresentation}
            data-testid="project-chrome-present"
            title="Modo presentación para el cliente (sin costos ni exports de planta)"
          >
            Presentar
          </button>
          {canMutate ? (
          <button
            type="button"
            className="btn"
            onClick={() => onEditMeta(project)}
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden />
            Editar
          </button>
          ) : null}
          {canMutate && onDuplicate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onDuplicate(project.id)}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden />
              Duplicar
            </button>
          ) : null}
          {canMutate && onSaveAsTemplate ? (
            <button
              type="button"
              className="btn"
              onClick={() => onSaveAsTemplate(project.id)}
              data-testid={`save-as-template-btn-${project.id}`}
            >
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden />
              Guardar como plantilla
            </button>
          ) : null}
          {canMarkProduced &&
          project.status === 'accepted' &&
          onMarkProduced ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onMarkProduced(project.id)}
              data-testid="project-mark-produced"
            >
              Marcar en producción
            </button>
          ) : null}
          {canReopen &&
          (project.status === 'quoted' ||
            project.status === 'accepted' ||
            project.status === 'produced') &&
          onRequestReopen ? (
            <button
              type="button"
              className="btn"
              onClick={onRequestReopen}
              data-testid="project-reopen"
            >
              Reabrir a borrador
            </button>
          ) : null}
          {canDelete ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={onRequestDelete}
          >
            <Trash2 size={16} strokeWidth={1.5} aria-hidden />
            Eliminar
          </button>
          ) : null}
        </div>
      </header>

      {project.ownerUserId ? (
        <p className="project-detail__notes" data-testid="project-owner-label">
          Responsable:{' '}
          {ownerLabels[project.ownerUserId] || project.ownerUserId}
        </p>
      ) : null}
      {project.notes ? (
        <p className="project-detail__notes">{project.notes}</p>
      ) : null}

      <div className="project-detail__body">
        {/*
          Single main column (options + items) so the 2-col grid stays:
          main | totals — never three siblings (that pushed totals down).
        */}
        <div className="project-detail__main">
        {optionGroups.length > 0 && onUpdateProjectLevelChoices ? (
          <section
            className="project-detail__section project-level-options"
            aria-label="Opciones del proyecto"
            data-testid="project-level-options"
          >
            <div className="project-detail__section-header">
              <h3 className="project-detail__section-title">
                Opciones del proyecto
              </h3>
            </div>
            <p className="project-editor__hint">
              Defaults de cotización. Cada mueble las hereda salvo que
              overridees en la línea.
            </p>
            <div className="project-item-choices">
              {optionGroups.map((group) => {
                const options = optionsForGroup(group, catalogs);
                return (
                  <div key={group.id} className="catalog-form__field">
                    <label htmlFor={`project-level-${group.code}`}>
                      {group.name} ({group.code})
                    </label>
                    <select
                      id={`project-level-${group.code}`}
                      value={
                        project.projectLevelChoices?.[group.code] ?? ''
                      }
                      onChange={(e) =>
                        updateProjectLevelChoice(group.code, e.target.value)
                      }
                      data-testid={`project-level-choice-${group.code}`}
                    >
                      <option value="">Sin default</option>
                      {options.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name} — {opt.code}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {onUpdateMeasureDefaults && !isProjectClosed(project.status) ? (
          (() => {
            // Render one row per furnitureType actually used by the catalog.
            const typesInUse = Array.from(
              new Set(
                modules.map((m) => m.furnitureType ?? 'inferior'),
              ),
            ) as FurnitureType[];
            if (typesInUse.length === 0) return null;
            const labels: Record<FurnitureType, string> = {
              inferior: 'Inferiores (gabinetes)',
              superior: 'Superiores (alacenas)',
              alto: 'Altos (despensas)',
            };
            return (
              <section
                className="project-detail__section project-measure-defaults"
                aria-label="Parámetros de medida del proyecto"
                data-testid="project-measure-defaults"
              >
                <div className="project-detail__section-header">
                  <h3 className="project-detail__section-title">
                    Parámetros de medida
                  </h3>
                </div>
                <p className="project-editor__hint">
                  Defaults de fondo/alto (mm) por tipo de mueble. Al agregar un
                  mueble se pre-selecciona el preset más cercano; cada línea
                  puede override.
                </p>
                <div className="measure-defaults-grid">
                  {typesInUse.map((type) => {
                    const entry = project.measureDefaults?.[type];
                    return (
                      <div
                        key={type}
                        className="measure-defaults-row"
                        data-testid={`project-measure-default-${type}`}
                      >
                        <span className="measure-defaults-row__label">
                          {labels[type]}
                        </span>
                        <div className="measure-defaults-row__inputs">
                          <div className="measure-input">
                            <label
                              htmlFor={`md-${type}-depth`}
                              className="measure-input__label"
                            >
                              Fondo (mm)
                            </label>
                            <input
                              id={`md-${type}-depth`}
                              className="measure-input__field"
                              type="number"
                              min={1}
                              step="any"
                              placeholder="Ej. 560"
                              value={entry?.depth ?? ''}
                              onChange={(e) =>
                                updateMeasureDefaults(
                                  type,
                                  'depth',
                                  e.target.value,
                                )
                              }
                              data-testid={`project-measure-default-${type}-depth`}
                            />
                          </div>
                          <div className="measure-input">
                            <label
                              htmlFor={`md-${type}-height`}
                              className="measure-input__label"
                            >
                              Alto (mm)
                            </label>
                            <input
                              id={`md-${type}-height`}
                              className="measure-input__field"
                              type="number"
                              min={1}
                              step="any"
                              placeholder="Ej. 720"
                              value={entry?.height ?? ''}
                              onChange={(e) =>
                                updateMeasureDefaults(
                                  type,
                                  'height',
                                  e.target.value,
                                )
                              }
                              data-testid={`project-measure-default-${type}-height`}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()
        ) : null}

        <KitchenPlanPanel
          project={project}
          modules={modules}
          canEdit={Boolean(
            canMutate &&
              project.status === 'draft' &&
              onUpdateKitchenLayout,
          )}
          onChange={(layout) => {
            onUpdateKitchenLayout?.(project.id, layout);
          }}
        />

        <QuoteScenarioCompare
          project={project}
          catalog={{
            materials: catalogs.materials,
            edges: catalogs.edges,
            hardware: catalogs.hardware,
            optionGroups,
            modules,
          }}
          optionGroups={optionGroups}
          canApply={Boolean(
            canMutate && project.status === 'draft' && onApplyScenarioB,
          )}
          canDuplicate={Boolean(canMutate && onDuplicateWithScenarioB)}
          currency={project.currency}
          onApplyB={(role, choiceId) => {
            onApplyScenarioB?.(project.id, role, choiceId);
          }}
          onDuplicateWithB={(role, choiceId) => {
            onDuplicateWithScenarioB?.(project.id, role, choiceId);
          }}
        />

        <InstallationChecklistPanel
          project={project}
          canEdit={Boolean(canMutate && onUpdateInstallationChecklist)}
          onChange={(items) => {
            onUpdateInstallationChecklist?.(project.id, items);
          }}
        />

        <section
          className="project-detail__section project-detail__items"
          aria-label="Ítems de cotización"
        >
          <div className="project-detail__section-header">
            <h3 className="project-detail__section-title">
              Muebles ({project.items.length})
            </h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {project.items.length > 0 ? (
                <button
                  type="button"
                  className="btn btn--small btn--outline"
                  onClick={viewer3D.onOpenQuote3D}
                  data-testid="project-view-3d-run"
                >
                  <Box size={14} strokeWidth={1.5} aria-hidden />
                  Vista 3D cotización
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={onOpenAddItemModal}
                disabled={modules.length === 0}
              >
                <Plus size={14} strokeWidth={1.5} aria-hidden />
                Agregar mueble
              </button>
            </div>
          </div>

          {itemError && !addItemModalOpen ? (
            <p className="catalog-form__error">{itemError}</p>
          ) : null}

          {project.items.length === 0 ? (
            <p className="project-detail__empty">
              Sin muebles. Agregá uno del catálogo para cotizar.
            </p>
          ) : (
            <div className="project-item-list">
              {project.items.map((item, index) => {
                const mod = modules.find((m) => m.id === item.moduleId);
                const groups = groupsForModuleItem(mod, optionGroups);
                return (
                  <div
                    key={item.id}
                    className="project-item-card"
                    data-testid={`project-item-${item.id}`}
                  >
                    <div className="project-item-card__header">
                      <h4 className="project-item-card__title">
                        Ítem {index + 1}:{' '}
                        {mod
                          ? `${mod.name} — ${mod.code}`
                          : `Mueble desconocido (${item.moduleId})`}
                        {mod?.furnitureType ? (
                          <span
                            className="project-item-type-badge"
                            data-testid={`project-item-type-badge-${item.id}`}
                          >
                            {furnitureTypeLabel(mod.furnitureType)}
                          </span>
                        ) : null}
                        {item.structureRevisionPin !== undefined ? (
                          <ProjectItemStructureRevisionIndicator
                            pin={item.structureRevisionPin}
                            testId={`project-item-revision-pin-${item.id}`}
                          />
                        ) : null}
                      </h4>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {mod && (
                          <button
                            type="button"
                            className="btn btn--small btn--outline"
                            onClick={() => viewer3D.onOpenItem3D(item, mod)}
                            data-testid={`view-3d-btn-${item.id}`}
                          >
                            <Box size={14} strokeWidth={1.5} aria-hidden />
                            3D
                          </button>
                        )}
                        {removeConfirm.confirmRemoveItemId === item.id ? (
                          <span className="project-inline-confirm">
                            <span className="project-inline-confirm__text">
                              ¿Quitar?
                            </span>
                            <button
                              type="button"
                              className="btn btn--small btn--danger"
                              onClick={() =>
                                removeConfirm.onConfirmRemoveItem(
                                  project.id,
                                  item.id,
                                )
                              }
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              className="btn btn--small"
                              onClick={removeConfirm.onCancelRemoveItem}
                            >
                              Cancelar
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--small btn--danger"
                            onClick={() =>
                              removeConfirm.onRequestRemoveItem(item.id)
                            }
                          >
                            Quitar
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="project-editor__grid">
                      <div className="catalog-form__field">
                        <label htmlFor={`item-qty-${item.id}`}>Cantidad</label>
                        <input
                          id={`item-qty-${item.id}`}
                          type="number"
                          min={1}
                          step={1}
                          value={item.quantity}
                          onChange={(e) =>
                            itemHandlers.onUpdateItemQuantity(
                              item,
                              Number(e.target.value),
                            )
                          }
                        />
                      </div>
                      {mod && (mod.presets?.length ?? 0) > 0 ? (
                        <div className="catalog-form__field">
                          <label htmlFor={`item-measure-${item.id}`}>
                            Medida
                          </label>
                          <select
                            id={`item-measure-${item.id}`}
                            value={item.measurePresetId ?? ''}
                            onChange={(e) =>
                              itemHandlers.onUpdateItemMeasurePreset(
                                item,
                                e.target.value,
                              )
                            }
                            data-testid={`item-measure-preset-${item.id}`}
                          >
                            <option value="">Elegí medida…</option>
                            {mod.presets!.map((pr) => (
                              <option key={pr.id} value={pr.id}>
                                {pr.name?.trim()
                                  ? `${pr.name} (${pr.width}×${pr.height}×${pr.depth} mm)`
                                  : `${pr.width}×${pr.height}×${pr.depth} mm`}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>

                    {groups.length === 0 ? (
                      <p className="catalog-empty">
                        Este mueble no tiene grupos de opción requeridos.
                      </p>
                    ) : (
                      <div className="project-item-choices">
                        {groups.map((group) => {
                          const options = optionsForGroup(group, catalogs);
                          const lineValue =
                            item.optionChoices[group.code]?.trim() ?? '';
                          const projectDefault =
                            project.projectLevelChoices?.[group.code]?.trim() ??
                            '';
                          const isOverride = Boolean(lineValue);
                          const inheritLabel = projectDefault
                            ? `Usar default del proyecto (${optionLabelForId(projectDefault, group, catalogs)})`
                            : 'Usar default del proyecto';
                          return (
                            <div
                              key={group.id}
                              className="catalog-form__field"
                            >
                              <label
                                htmlFor={`choice-${item.id}-${group.code}`}
                              >
                                {group.name} ({group.code})
                                {isOverride ? (
                                  <span
                                    className="project-choice-override-badge"
                                    title="Esta línea overridea el default del proyecto"
                                  >
                                    Override
                                  </span>
                                ) : null}
                              </label>
                              <select
                                id={`choice-${item.id}-${group.code}`}
                                value={lineValue}
                                onChange={(e) =>
                                  itemHandlers.onUpdateItemChoice(
                                    item,
                                    group.code,
                                    e.target.value,
                                  )
                                }
                                data-testid={`item-choice-${item.id}-${group.code}`}
                              >
                                <option value="">{inheritLabel}</option>
                                {options.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.name} — {opt.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </div>

        <aside
          className={
            previewBlocked || !breakdown
              ? 'project-totals project-totals--blocked project-totals--sticky'
              : 'project-totals project-totals--sticky'
          }
          aria-label="Totales de cotización"
          aria-live="polite"
        >
          <div className="project-totals__header">
            <div className="project-totals__heading">
              <h3 className="project-totals__title">
                {isProjectClosed(project.status) && project.priceSnapshot
                  ? 'Totales (congelados)'
                  : 'Totales'}
              </h3>
              {isProjectClosed(project.status) && project.priceSnapshot ? (
                <span
                  className="project-totals__frozen-badge"
                  title={`Precios capturados el ${formatIsoDate(project.priceSnapshot.capturedAt)}`}
                >
                  Precios congelados
                </span>
              ) : null}
            </div>
            {breakdownLoading ? (
              <InlineLoading
                label="Recalculando…"
                data-testid="breakdown-loading"
              />
            ) : null}
          </div>

          {breakdownError ? (
            <p
              className="project-totals__error"
              role="alert"
              data-testid="breakdown-error"
            >
              <AlertCircle size={16} strokeWidth={1.5} aria-hidden />
              <span>{breakdownError}</span>
            </p>
          ) : null}

          <PricePreviewGate
            requiredGroupCodes={previewBlocked ? missingGroups : []}
            optionChoices={{}}
            groupLabels={groupLabels}
            blockedMessage="Totales bloqueados: faltan opciones obligatorias en uno o más ítems."
          >
            {breakdown ? (
              <dl className="project-totals__grid">
                {showCosts ? (
                  <>
                    <div>
                      <dt>Materiales</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.materialsCost,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Cantos</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.edgeTotal,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Herrajes</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.hardwareTotal,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Costo directo</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.directCost,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>MO modular</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.laborModular,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>MO fija</dt>
                      <dd>
                        {formatProjectMoney(
                          breakdown.laborFixedCost,
                          project.currency,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Factor margen</dt>
                      <dd>{breakdown.marginFactor.toFixed(2)}</dd>
                    </div>
                  </>
                ) : null}
                <div className="project-totals__sale-row">
                  <dt>Precio de venta</dt>
                  <dd className="project-totals__sale">
                    {formatProjectMoney(breakdown.salePrice, project.currency)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="project-totals__empty">
                {project.items.length === 0
                  ? 'Agregá muebles para ver totales.'
                  : breakdownLoading
                    ? 'Calculando desglose…'
                    : 'No se pudo calcular el desglose con las opciones actuales.'}
              </p>
            )}
          </PricePreviewGate>

          {materialSummary &&
          (materialSummary.materials.length > 0 ||
            materialSummary.hardware.length > 0) ? (
            <section
              className="project-material-summary"
              aria-label="Resumen de materiales"
              data-testid="project-material-summary"
            >
              <h4 className="project-material-summary__title">
                Resumen de materiales
              </h4>
              {materialSummary.materials.length > 0 ? (
                <div className="project-material-summary__block">
                  <p className="project-material-summary__label">
                    Tableros · {materialSummary.totalAreaM2.toFixed(3)} m²
                  </p>
                  <ul className="project-material-summary__list">
                    {materialSummary.materials.map((row) => (
                      <li key={row.materialId}>
                        <span className="project-material-summary__name">
                          {row.name}
                        </span>
                        <span className="project-material-summary__meta">
                          {row.areaM2.toFixed(3)} m²
                          {showCosts
                            ? ` · ${formatProjectMoney(row.boardCost, project.currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    const sheets = estimateBoardSheets(
                      materialSummary.materials,
                      catalogs.materials,
                    ).filter((s) => s.estimatedSheets > 0);
                    if (sheets.length === 0) return null;
                    return (
                      <div
                        className="project-material-summary__block"
                        data-testid="project-sheet-estimate"
                        style={{ marginTop: '0.75rem' }}
                      >
                        <p className="project-material-summary__label">
                          Pliegos estimados
                        </p>
                        <p className="catalog-form__hint" style={{ marginTop: 0 }}>
                          Estimado — nesting real en software de corte
                        </p>
                        <ul className="project-material-summary__list">
                          {sheets.map((s) => (
                            <li key={s.materialId}>
                              <span className="project-material-summary__name">
                                {s.name}
                              </span>
                              <span className="project-material-summary__meta">
                                ~{s.estimatedSheets} pliego
                                {s.estimatedSheets === 1 ? '' : 's'}
                                {s.sheetWidthMm > 0
                                  ? ` (${s.sheetWidthMm}×${s.sheetLengthMm} mm)`
                                  : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}

                  {project.nestingImport && project.nestingImport.rows.length > 0 ? (
                    <div
                      className="project-material-summary__block"
                      data-testid="project-nesting-import"
                      style={{ marginTop: '0.75rem' }}
                    >
                      <p className="project-material-summary__label">
                        Nesting importado
                      </p>
                      <p className="catalog-form__hint" style={{ marginTop: 0 }}>
                        Consumo real ({project.nestingImport.sourceName ?? 'CSV'})
                        · {new Date(project.nestingImport.importedAt).toLocaleString()}
                      </p>
                      <ul className="project-material-summary__list">
                        {project.nestingImport.rows.map((r) => (
                          <li key={r.materialCode}>
                            <span className="project-material-summary__name">
                              {r.materialCode}
                            </span>
                            <span className="project-material-summary__meta">
                              {r.sheetsUsed} pliego{r.sheetsUsed === 1 ? '' : 's'}
                              {r.areaM2 != null ? ` · ${r.areaM2} m²` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {canMutate && onImportNesting ? (
                    <div style={{ marginTop: '0.75rem' }}>
                      <label className="btn btn--secondary btn--sm" style={{ cursor: 'pointer' }}>
                        Importar nesting (CSV)
                        <input
                          type="file"
                          accept=".csv,text/csv,text/plain"
                          style={{ display: 'none' }}
                          data-testid="project-nesting-file"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            void file.text().then((text) => {
                              const rows = parseNestingImportCsv(text);
                              if (rows.length === 0) return;
                              onImportNesting(
                                project.id,
                                nestingImportFromRows(
                                  rows,
                                  new Date().toISOString(),
                                  file.name,
                                ),
                              );
                            });
                          }}
                        />
                      </label>
                      <p className="catalog-form__hint">
                        Columnas: material_code, sheets_used [, area_m2]
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {materialSummary.edges.length > 0 ? (
                <div className="project-material-summary__block">
                  <p className="project-material-summary__label">
                    Cantos · {materialSummary.totalEdgeMl.toFixed(2)} ML
                  </p>
                  <ul className="project-material-summary__list">
                    {materialSummary.edges.map((row) => (
                      <li key={row.edgeBandId}>
                        <span className="project-material-summary__name">
                          {row.name}
                        </span>
                        <span className="project-material-summary__meta">
                          {row.edgeMl.toFixed(2)} ML
                          {showCosts
                            ? ` · ${formatProjectMoney(row.edgeCost, project.currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {materialSummary.hardware.length > 0 ? (
                <div className="project-material-summary__block">
                  <p className="project-material-summary__label">
                    Herrajes · {materialSummary.hardware.reduce((s, h) => s + h.quantity, 0)} uds
                  </p>
                  <ul className="project-material-summary__list">
                    {materialSummary.hardware.map((row) => (
                      <li key={row.hardwareId}>
                        <span className="project-material-summary__name">
                          {row.description}
                        </span>
                        <span className="project-material-summary__meta">
                          ×{row.quantity}
                          {showCosts
                            ? ` · ${formatProjectMoney(row.lineCost, project.currency)}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {exportBlockMessage ? (
            <p className="project-totals__export-msg" role="status">
              {exportBlockMessage}
            </p>
          ) : null}

          {exportErrors.length > 0 ? (
            <ExportIssueList issues={exportErrors} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
