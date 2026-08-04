/**
 * Project detail view (F058b) — extracted from ProjectsScreen.renderDetail.
 *
 * Renders the sticky workspace chrome (status + total + action buttons) and
 * the 2-column body (main with options/measure defaults/panels/items + aside
 * with totals + material summary).
 *
 * All state lives in the parent (ProjectsScreen) and is passed down as
 * controlled props: navigation handlers reset most of it and several pieces
 * (3D viewer, add-item) are consumed by sibling modals in the parent.
 *
 * #193 — Props are forwarded into a React Context so child components
 * (items, panels, totals) can pull what they need without prop threading.
 *
 * #refactor — Sub-sections extracted to reduce file size:
 *   - ProjectItemsSection  → items list with 3D, quantity, measure, choices
 *   - ProjectOptionsSection → project-level option defaults
 *   - ProjectMeasureDefaults → depth/height defaults by furniture type
 *   - ProjectTotalsAside   → breakdown, material summary, nesting, issues
 */

import { type ReactNode } from 'react';
import type {
  Customer,
  ExportIssue,
  FurnitureType,
  Module,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectMaterialSummary,
  ProjectStatus,
  ProjectTemplate,
  QuoteBreakdown,
} from '@muebles/domain';

import {
  Check,
  ChevronLeft,
  Copy,
  LayoutTemplate,
  Pencil,
  Send,
  Trash2,
} from 'lucide-react';
import { DropdownMenu, type DropdownMenuSection } from '../../common';
import { KitchenPlanPanel } from './KitchenPlanPanel';
import { QuoteScenarioCompare } from './QuoteScenarioCompare';
import { InstallationChecklistPanel } from './InstallationChecklistPanel';
import { StatusBadge } from './StatusBadge';
import { ProjectItemsSection } from './ProjectItemsSection';
import { ProjectOptionsSection } from './ProjectOptionsSection';
import { ProjectMeasureDefaults } from './ProjectMeasureDefaults';
import { ProjectTotalsAside } from './ProjectTotalsAside';
import {
  formatProjectMoney,
  resolveCustomerName,
} from '../projectHelpers';
import {
  ProjectDetailProvider,
  useProjectDetail,
  type ProjectDetailCatalogs,
  type ProjectDetailItemHandlers,
  type ProjectDetailRemoveConfirm,
  type ProjectDetail3DHandlers,
} from './projectDetailContext';

// ─── Re-export context types for external consumers ──────────────────
export type { ProjectDetailCatalogs, ProjectDetailItemHandlers, ProjectDetailRemoveConfirm, ProjectDetail3DHandlers };
export { useProjectDetail } from './projectDetailContext';

// ─── Props (unchanged — backward compatible) ────────────────────────

export interface ProjectDetailViewProps {
  // --- Project data ---
  readonly project: Project;
  readonly projectEstimates: Readonly<Record<string, number | null>>;

  // --- Catalog data ---
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalogs: ProjectDetailCatalogs;
  readonly customers: readonly Customer[];
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
  readonly onExportProductionPack?: () => void | Promise<void>;

  // --- Item handlers + inline-remove confirm ---
  readonly itemHandlers: ProjectDetailItemHandlers;
  readonly removeConfirm: ProjectDetailRemoveConfirm;

  // --- Project-level choice / measure handlers ---
  readonly updateProjectLevelChoice: (
    groupCode: string,
    optionId: string,
  ) => void;
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
  /** Transition status: draft→quoted, quoted→accepted (gap #3). */
  readonly onChangeStatus?: (projectId: string, status: ProjectStatus) => void;
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
  readonly onExportScenarioPdf?: (
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

  // --- Version history (#200) ---
  readonly onRestoreVersion?: (version: number) => void;

  // --- Permission flags ---
  readonly canMutate: boolean;
  readonly canDelete: boolean;
  readonly canReopen: boolean;
  readonly canMarkProduced: boolean;
  readonly projectTemplates?: readonly ProjectTemplate[];
}

// ─── Inner component (consumes context) ─────────────────────────────

function ProjectDetailViewInner(): ReactNode {
  const ctx = useProjectDetail();
  const {
    project,
    modules,
    optionGroups,
    catalogs,
    customers,
    ownerLabels,
    breakdown,
    exportMenu,
    exportBusy,
    productionExportDisabled,
    productionExportOk,
    onExport,
    onBackToList,
    onOpenPresentation,
    onEditMeta,
    onDuplicate,
    onSaveAsTemplate,
    onMarkProduced,
    onChangeStatus,
    onRequestReopen,
    onRequestDelete,
    onUpdateKitchenLayout,
    onApplyScenarioB,
    onDuplicateWithScenarioB,
    onExportScenarioPdf,
    onUpdateInstallationChecklist,
    canMutate,
    canDelete,
    canReopen,
    canMarkProduced,
  } = ctx;

  const chromeSale = breakdown?.salePrice ?? null;

  return (
    <>
      {/* Sticky tool chrome */}
      <header className="workspace-chrome" data-testid="project-detail-chrome">
        <div className="workspace-chrome__lead">
          <button type="button" className="btn btn--ghost btn--small" onClick={onBackToList}>
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
              <span className="workspace-chrome__dot" aria-hidden>·</span>
              {project.items.length} mueble{project.items.length === 1 ? '' : 's'}
              <span className="workspace-chrome__dot" aria-hidden>·</span>
              {project.currency}
              {ctx.showCosts ? (
                <>
                  <span className="workspace-chrome__dot" aria-hidden>·</span>
                  Margen ×{project.marginFactor.toFixed(2)}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="workspace-chrome__total" data-testid="project-detail-total">
          <span className="workspace-chrome__total-label">Precio de venta</span>
          <span className={chromeSale == null ? 'workspace-chrome__total-value workspace-chrome__total-value--muted' : 'workspace-chrome__total-value'}>
            {chromeSale == null ? '—' : formatProjectMoney(chromeSale, project.currency)}
          </span>
        </div>
        <div className="workspace-chrome__actions">
          {onExport ? (
            <button type="button" className="btn btn--primary" disabled={productionExportDisabled}
              title={!productionExportOk ? 'Export de producción solo en Aceptado o En producción' : 'Exportar cut-list Optimizer (.xlsx)'}
              onClick={() => { void onExport?.(); }} data-testid="project-chrome-export">
              {ctx.exportBusy ? 'Exportando…' : 'Exportar Optimizer'}
            </button>
          ) : null}
          {ctx.onExportProductionPack ? (
            <button type="button" className="btn btn--primary" disabled={productionExportDisabled}
              title={!productionExportOk ? 'Pack de producción solo en Aceptado o En producción' : 'Descargar paquete completo ZIP (Optimizer + Herrajes + Etiquetas + Resumen)'}
              onClick={() => { void ctx.onExportProductionPack?.(); }} data-testid="project-chrome-export-pack">
              {ctx.exportBusy ? 'Generando Pack…' : '📦 Pack Producción'}
            </button>
          ) : null}
          {exportMenu.sections.length > 0 ? (
            <DropdownMenu ariaLabel="Más exports" triggerLabel={exportBusy ? 'Exportando…' : 'Más exports'}
              triggerClassName="btn" disabled={exportBusy} sections={exportMenu.sections} onClose={exportMenu.onClose} />
          ) : null}
          <button type="button" className="btn" onClick={onOpenPresentation} data-testid="project-chrome-present"
            title="Modo presentación para el cliente (sin costos ni exports de planta)">
            Presentar
          </button>
          {canMutate ? (
            <button type="button" className="btn" onClick={() => onEditMeta(project)}>
              <Pencil size={16} strokeWidth={1.5} aria-hidden /> Editar
            </button>
          ) : null}
          {canMutate && onDuplicate ? (
            <button type="button" className="btn" onClick={() => onDuplicate(project.id)}>
              <Copy size={16} strokeWidth={1.5} aria-hidden /> Duplicar
            </button>
          ) : null}
          {canMutate && onSaveAsTemplate ? (
            <button type="button" className="btn" onClick={() => onSaveAsTemplate(project.id)}
              data-testid={`save-as-template-btn-${project.id}`}>
              <LayoutTemplate size={16} strokeWidth={1.5} aria-hidden /> Guardar como plantilla
            </button>
          ) : null}
          {canMutate && project.status === 'draft' && onChangeStatus ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onChangeStatus(project.id, 'quoted')}
              data-testid="project-send-quote"
              title="Cambia el estado a Enviada y congela los precios"
            >
              <Send size={16} strokeWidth={1.5} aria-hidden /> Enviar al cliente
            </button>
          ) : null}
          {canMutate && project.status === 'quoted' && onChangeStatus ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => onChangeStatus(project.id, 'accepted')}
              data-testid="project-accept-quote"
              title="Marca la cotización como aceptada por el cliente"
            >
              <Check size={16} strokeWidth={1.5} aria-hidden /> Aceptar cotización
            </button>
          ) : null}
          {canMarkProduced && project.status === 'accepted' && onMarkProduced ? (
            <button type="button" className="btn btn--primary" onClick={() => onMarkProduced(project.id)}
              data-testid="project-mark-produced">
              Marcar en producción
            </button>
          ) : null}
          {canReopen && (project.status === 'quoted' || project.status === 'accepted' || project.status === 'produced') && onRequestReopen ? (
            <button type="button" className="btn" onClick={onRequestReopen} data-testid="project-reopen">
              Reabrir a borrador
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="btn btn--danger" onClick={onRequestDelete}>
              <Trash2 size={16} strokeWidth={1.5} aria-hidden /> Eliminar
            </button>
          ) : null}
        </div>
      </header>

      {project.ownerUserId ? (
        <p className="project-detail__notes" data-testid="project-owner-label">
          Responsable: {ownerLabels[project.ownerUserId] || project.ownerUserId}
        </p>
      ) : null}
      {project.notes ? (
        <p className="project-detail__notes">{project.notes}</p>
      ) : null}

      <div className="project-detail__body">
        <div className="project-detail__main">
          <ProjectOptionsSection />
          <ProjectMeasureDefaults />

          <KitchenPlanPanel
            project={project}
            modules={modules}
            canEdit={Boolean(canMutate && project.status === 'draft' && onUpdateKitchenLayout)}
            onChange={(layout) => { onUpdateKitchenLayout?.(project.id, layout); }}
          />

          <QuoteScenarioCompare
            project={project}
            catalog={{ materials: catalogs.materials, edges: catalogs.edges, hardware: catalogs.hardware, optionGroups, modules }}
            optionGroups={optionGroups}
            canApply={Boolean(canMutate && project.status === 'draft' && onApplyScenarioB)}
            canDuplicate={Boolean(canMutate && onDuplicateWithScenarioB)}
            currency={project.currency}
            onApplyB={(role, choiceId) => { onApplyScenarioB?.(project.id, role, choiceId); }}
            onDuplicateWithB={(role, choiceId) => { onDuplicateWithScenarioB?.(project.id, role, choiceId); }}
            onExportScenarioPdf={(role, choiceId) => { onExportScenarioPdf?.(project.id, role, choiceId); }}
          />

          <InstallationChecklistPanel
            project={project}
            canEdit={Boolean(canMutate && onUpdateInstallationChecklist)}
            onChange={(items) => { onUpdateInstallationChecklist?.(project.id, items); }}
          />

          <ProjectItemsSection />
        </div>

        <ProjectTotalsAside />
      </div>
    </>
  );
}

// ─── Public entry point (wraps inner with provider) ──────────────────

export function ProjectDetailView(props: ProjectDetailViewProps): ReactNode {
  const contextValue = {
    project: props.project,
    projectEstimates: props.projectEstimates,
    modules: props.modules,
    optionGroups: props.optionGroups,
    catalogs: props.catalogs,
    customers: props.customers,
    ownerLabels: props.ownerLabels,
    breakdown: props.breakdown ?? null,
    materialSummary: props.materialSummary ?? null,
    breakdownLoading: props.breakdownLoading ?? false,
    breakdownError: props.breakdownError ?? null,
    previewBlocked: props.previewBlocked ?? false,
    missingGroups: props.missingGroups ?? [],
    groupLabels: props.groupLabels ?? {},
    showCosts: props.showCosts,
    exportMenu: props.exportMenu,
    exportBlockMessage: props.exportBlockMessage,
    exportErrors: props.exportErrors,
    exportBusy: props.exportBusy,
    exportBlocked: props.exportBlocked,
    productionExportDisabled: props.productionExportDisabled,
    productionExportOk: props.productionExportOk,
    onExport: props.onExport,
    onExportProductionPack: props.onExportProductionPack,
    itemHandlers: props.itemHandlers,
    removeConfirm: props.removeConfirm,
    updateProjectLevelChoice: props.updateProjectLevelChoice,
    onUpdateMeasureDefaults: props.onUpdateMeasureDefaults,
    viewer3D: props.viewer3D,
    itemError: props.itemError,
    addItemModalOpen: props.addItemModalOpen,
    onOpenAddItemModal: props.onOpenAddItemModal,
    onBackToList: props.onBackToList,
    onOpenPresentation: props.onOpenPresentation,
    onEditMeta: props.onEditMeta,
    onDuplicate: props.onDuplicate,
    onSaveAsTemplate: props.onSaveAsTemplate,
    onMarkProduced: props.onMarkProduced,
    onChangeStatus: props.onChangeStatus,
    onRequestReopen: props.onRequestReopen,
    onRequestDelete: props.onRequestDelete,
    onUpdateKitchenLayout: props.onUpdateKitchenLayout,
    onApplyScenarioB: props.onApplyScenarioB,
    onDuplicateWithScenarioB: props.onDuplicateWithScenarioB,
    onExportScenarioPdf: props.onExportScenarioPdf,
    onUpdateInstallationChecklist: props.onUpdateInstallationChecklist,
    onImportNesting: props.onImportNesting,
    onUpdateProjectLevelChoices: props.onUpdateProjectLevelChoices,
    canMutate: props.canMutate,
    canDelete: props.canDelete,
    canReopen: props.canReopen,
    canMarkProduced: props.canMarkProduced,
    onRestoreVersion: props.onRestoreVersion,
    projectTemplates: props.projectTemplates,
  };

  return (
    <div className="project-detail" data-testid="project-detail">
      <ProjectDetailProvider value={contextValue}>
        <ProjectDetailViewInner />
      </ProjectDetailProvider>
    </div>
  );
}
