/**
 * React Context for ProjectDetailView — eliminates prop drilling (#193).
 *
 * Groups all shared state + callbacks into a single context so child
 * components (items, totals, panels) access what they need directly
 * instead of receiving 40+ props threaded through intermediate components.
 */

import { createContext, useContext, type ReactNode } from 'react';
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
import type { DropdownMenuSection } from '../../common';

// ─── Catalogs ───────────────────────────────────────────────────────

export interface ProjectDetailCatalogs {
  readonly materials: readonly MaterialBoard[];
  readonly edges: readonly EdgeBand[];
  readonly hardware: readonly Hardware[];
}

// ─── Item handlers ──────────────────────────────────────────────────

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

// ─── Remove confirm ─────────────────────────────────────────────────

export interface ProjectDetailRemoveConfirm {
  readonly confirmRemoveItemId: string | null;
  readonly onRequestRemoveItem: (itemId: string) => void;
  readonly onCancelRemoveItem: () => void;
  readonly onConfirmRemoveItem: (projectId: string, itemId: string) => void;
}

// ─── 3D handlers ────────────────────────────────────────────────────

export interface ProjectDetail3DHandlers {
  readonly onOpenQuote3D: () => void;
  readonly onOpenItem3D: (item: ProjectItem, mod: Module) => void;
}

// ─── Full context value ─────────────────────────────────────────────

export interface ProjectDetailContextValue {
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
  readonly breakdown: QuoteBreakdown | null;
  readonly materialSummary: ProjectMaterialSummary | null;
  readonly breakdownLoading: boolean;
  readonly breakdownError: string | null;
  readonly previewBlocked: boolean;
  readonly missingGroups: readonly string[];
  readonly groupLabels: Readonly<Record<string, string>>;
  readonly showCosts: boolean;

  // --- Export ---
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

  // --- Item handlers ---
  readonly itemHandlers: ProjectDetailItemHandlers;
  readonly removeConfirm: ProjectDetailRemoveConfirm;

  // --- Project-level choices / measures ---
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

  // --- Item error / add modal ---
  readonly itemError: string | null;
  readonly addItemModalOpen: boolean;
  readonly onOpenAddItemModal: () => void;

  // --- Navigation / chrome ---
  readonly onBackToList: () => void;
  readonly onOpenPresentation: () => void;
  readonly onEditMeta: (project: Project) => void;
  readonly onDuplicate?: (id: string) => void;
  readonly onSaveAsTemplate?: (projectId: string) => void;
  readonly onMarkProduced?: (projectId: string) => void;
  readonly onRequestReopen: () => void;
  readonly onRequestDelete: () => void;

  // --- Kitchen / scenarios / checklist / nesting ---
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

  // --- Permissions ---
  readonly canMutate: boolean;
  readonly canDelete: boolean;
  readonly canReopen: boolean;
  readonly canMarkProduced: boolean;
  readonly projectTemplates?: readonly ProjectTemplate[];
}

// ─── Context + hook ─────────────────────────────────────────────────

const ProjectDetailContext = createContext<ProjectDetailContextValue | null>(
  null,
);

export function useProjectDetail(): ProjectDetailContextValue {
  const ctx = useContext(ProjectDetailContext);
  if (!ctx) {
    throw new Error(
      'useProjectDetail must be used within a <ProjectDetailProvider>',
    );
  }
  return ctx;
}

export function ProjectDetailProvider({
  value,
  children,
}: {
  readonly value: ProjectDetailContextValue;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <ProjectDetailContext.Provider value={value}>
      {children}
    </ProjectDetailContext.Provider>
  );
}

export { ProjectDetailContext };
