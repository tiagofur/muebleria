/**
 * React Context for ProjectDetailView — eliminates prop drilling (#193).
 *
 * Groups all shared state + callbacks into a single context so child
 * components (items, totals, panels) access what they need directly
 * instead of receiving 40+ props threaded through intermediate components.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type {
  Component,
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
  ProjectPhoto,
  ProjectPhotoStage,
  ProjectTemplate,
  QuoteBreakdown,
  Structure,
} from '@granete/domain';

import type { DropdownMenuSection } from '../../common';
import type { CostingHandlers } from './CostingPanel';
import type { CostingPanelView } from '../costingView';
import type { SurveyHandlers } from './SiteSurveyPanel';
import type { ProjectOverviewNav } from './ProjectOverviewPanel';

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
  /** When provided, enables drag & drop reordering of items. */
  readonly onReorderItems?: (fromIndex: number, toIndex: number) => void;
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
  /**
   * Required for board/edge option roles on composed modules (structure +
   * components). Without these, pickers only show hardware groups.
   */
  readonly catalogComponents: readonly Component[];
  readonly catalogStructures: readonly Structure[];
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
  readonly onExportProductionPack?: () => void | Promise<void>;
  readonly onOpenInProduction?: (projectId: string) => void;

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
  /** Full-screen spatial studio (place/move on walls). */
  readonly onOpenSpatialStudio?: () => void;
  /**
   * After adding furniture from quote: soft cue to place in Proyectar
   * (never auto-opens studio).
   */
  readonly postAddPlaceCue?: boolean;
  readonly onDismissPostAddPlaceCue?: () => void;
  /** Open Proyectar focused on unplaced units (CTA from cue / tools). */
  readonly onOpenSpatialStudioUnplaced?: () => void;
  readonly onEditMeta: (project: Project) => void;
  readonly onDuplicate?: (id: string) => void;
  readonly onSaveAsTemplate?: (projectId: string) => void;
  readonly onMarkProduced?: (projectId: string) => void;
  readonly onChangeStatus?: (
    projectId: string,
    status: import('@granete/domain').ProjectStatus,
  ) => void;
  readonly onRequestReopen: () => void;
  readonly onRequestDelete: () => void;

  // --- Kitchen / scenarios / checklist / nesting ---
  readonly onUpdateKitchenLayout?: (
    projectId: string,
    layout: import('@granete/domain').ProjectKitchenLayout,
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
    items: readonly import('@granete/domain').InstallationChecklistItem[],
  ) => void;
  // --- Job costing (OC-080..OC-084, #304) ---
  readonly costingView?: CostingPanelView | null;
  readonly costingHandlers?: CostingHandlers;
  readonly canManageCosting?: boolean;
  readonly canCaptureCosting?: boolean;
  readonly canRecordOtherCosting?: boolean;
  readonly canVoidCosting?: boolean;
  readonly costingLabelsByMaterial?: Readonly<Record<string, string>>;
  // --- Structured site survey (OC-040/OC-041, #305) ---
  readonly surveyHandlers?: SurveyHandlers;
  readonly canCaptureSurvey?: boolean;
  readonly canVerifySurvey?: boolean;
  readonly canApproveSurvey?: boolean;
  /** Transversal workspace navigation from the overview panel (OC-091). */
  readonly overviewNav?: ProjectOverviewNav;

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

  // --- Permissions ---
  /** Role can mutate projects (vendedor/gerente/admin). */
  readonly canMutate: boolean;
  /**
   * Content edits (items, options, meta comercial): draft only + canMutate.
   * #257 freeze.
   */
  readonly canEditContent: boolean;
  readonly canDelete: boolean;
  readonly canReopen: boolean;
  /** Admin/gerente: reopen accepted|produced (#257). */
  readonly canForceReopenClosed: boolean;
  readonly canMarkProduced: boolean;
  readonly projectTemplates?: readonly ProjectTemplate[];

  // --- CRM & Project Photos (CRM Phase 1) ---
  readonly photos?: readonly ProjectPhoto[];
  readonly onUploadPhotos?: (
    files: File[],
    stage: ProjectPhotoStage,
    caption?: string,
  ) => Promise<void>;
  readonly onUpdatePhoto?: (
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ) => Promise<void>;
  readonly onDeletePhoto?: (photoId: string) => Promise<void>;
  readonly workshopName?: string;

  // --- CRM & Internal Comms (CRM Phase 2) ---
  readonly internalMessages?: readonly import('@granete/domain').ProjectInternalMessage[];
  readonly onSendInternalMessage?: (msg: {
    messageType: import('@granete/domain').ProjectInternalMessageType;
    content: string;
    senderName?: string;
  }) => Promise<void> | void;
  readonly onUpdateTechnicalWorkflow?: (updates: {
    assignedEngineerId?: string;
    technicalStatus?: import('@granete/domain').ProjectTechnicalStatus;
    surveyCompletedAt?: string;
    installationScheduledDate?: string;
    comment?: string;
  }) => Promise<void> | void;
  readonly assignableOwners?: readonly { readonly id: string; readonly name: string; readonly role?: string }[];
  readonly currentUserId?: string;

  // --- CRM & Warranty Desk (CRM Phase 3) ---
  readonly warranties?: readonly import('@granete/domain').WarrantyTicket[];
  readonly availableCutRows?: readonly import('@granete/domain').ProductionCutRow[];
  readonly onCreateWarrantyTicket?: (
    ticket: Partial<import('@granete/domain').WarrantyTicket> & {
      projectId: string;
      title: string;
      category: import('@granete/domain').WarrantyTicketCategory;
      priority: import('@granete/domain').WarrantyTicketPriority;
    },
  ) => Promise<void>;

  readonly onUpdateWarrantyTicket?: (
    ticketId: string,
    updates: Partial<import('@granete/domain').WarrantyTicket>,
  ) => Promise<void>;
  readonly onDeleteWarrantyTicket?: (ticketId: string) => Promise<void>;
  readonly onUploadWarrantyPhoto?: (
    ticketId: string,
    file: File,
    kind?: import('@granete/domain').WarrantyPhotoKind,
    caption?: string,
  ) => Promise<void>;
  readonly onExportWarrantyRefabricationOptimizer?: (
    ticket: import('@granete/domain').WarrantyTicket,
  ) => void;

  // --- Project Lifecycle & Operational Core (OC-010..OC-024) ---
  readonly onOpenReleaseModal?: () => void;
  readonly onOpenChangeOrderModal?: () => void;
  readonly onReleaseToProduction?: (
    projectId: string,
    note?: string,
    options?: import('@granete/domain').ProductionReleaseOptions,
  ) => void | Promise<void>;
  readonly onRevokeProductionRelease?: (
    projectId: string,
    reason: string,
  ) => void | Promise<void>;
  readonly onCreateChangeOrder?: (
    projectId: string,
    params: {
      reason: string;
      description?: string;
      impact?: import('@granete/domain').ChangeOrderImpact;
    },
  ) => void | Promise<void>;
  readonly onSubmitChangeOrder?: (
    projectId: string,
    changeOrderId: string,
  ) => void | Promise<void>;
  readonly onApproveChangeOrder?: (
    projectId: string,
    changeOrderId: string,
    decisionNotes?: string,
  ) => void | Promise<void>;
  readonly onRejectChangeOrder?: (
    projectId: string,
    changeOrderId: string,
    reason: string,
  ) => void | Promise<void>;
  readonly onCreateRevision?: (name?: string, description?: string) => void | Promise<void>;
  readonly onDecideApproval?: (
    approvalId: string,
    decision: 'approved' | 'rejected',
    notes?: string,
  ) => void | Promise<void>;
  readonly onRequestApproval?: (
    type: import('@granete/domain').ApprovalType,
    notes?: string,
  ) => void | Promise<void>;
  readonly onChangeCommercialStatus?: (
    status: import('@granete/domain').CommercialStatus,
  ) => void | Promise<void>;
  readonly onRecordDeposit?: (
    params: import('@granete/domain').DepositReceivedPayload & { note?: string },
  ) => void | Promise<void>;
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
