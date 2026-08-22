import type {
  Catalog,
  Project,
  WorkshopSettings,
  ProjectInternalMessage,
  ProjectInternalMessageType,
  ProjectPhoto,
  ProjectPhotoStage,
  ProjectTechnicalStatus,
  ProjectTemplate,
  WarrantyPhotoKind,
  WarrantyTicket,
  WarrantyTicketPhoto,
  ShowcasePhotoItem,
  Workspace,
  ItemFloorStatus,
  FloorStatusEvent,
  LoadingProgress,
  ProjectPickingState,
  MaterialStock,
  StockMaterialKind,
  StockMovement,
  StockMovementType,
  PurchaseOrder,
  Supplier,
  PartInstance,
  PartOperationType,
  ModuleUnitExecution,
  ModuleUnitStatus,
  InstallationJob,
  InstallationJobStatus,
  ClientCloseout,
  MaterialPlanning,
  MaterialRequirementLine,
  MaterialsReleaseCheck,
  ProjectMaterialLineCoverage,
  MaterialAvailability,
  QualityJob,
  QualityIssue,
  QualityIssueStatus,
  ReworkAction,
  UnitQcChecklistItem,
} from '@muebles/domain';

/** Derived closeout gate check as returned by the installation endpoints. */
export interface InstallationCloseoutCheck {
  readonly code: string;
  readonly label: string;
  readonly passed: boolean;
  readonly required: boolean;
  readonly details: string;
}

/** Derived view of an installation job (OC-070..OC-074). */
export interface InstallationView {
  readonly installation: InstallationJob | null;
  readonly jobStatus: InstallationJobStatus;
  readonly units: { readonly mode: string; readonly installed: number; readonly total: number };
  readonly closeoutChecks: readonly InstallationCloseoutCheck[];
  readonly closeoutReady: boolean;
}

/** Error thrown when the OC-074 closeout gates block sign-off/close. */
export class CloseoutGateError extends Error {
  readonly checks: readonly InstallationCloseoutCheck[];
  constructor(checks: readonly InstallationCloseoutCheck[], message: string) {
    super(message);
    this.name = 'CloseoutGateError';
    this.checks = checks;
  }
}

/** Derived evidence view of a project's material planning (OC-050..OC-054). */
export interface MaterialPlanningView {
  readonly planning: MaterialPlanning | null;
  readonly coverage: readonly ProjectMaterialLineCoverage[];
  readonly availability: readonly MaterialAvailability[];
  readonly releaseChecks: readonly MaterialsReleaseCheck[];
  readonly releaseReady: boolean;
  readonly released: boolean;
  readonly eventsAppended?: number;
}

/** Error thrown when the OC-054 release gates block the materials release. */
export class MaterialsReleaseGateError extends Error {
  readonly checks: readonly MaterialsReleaseCheck[];
  constructor(checks: readonly MaterialsReleaseCheck[], message: string) {
    super(message);
    this.name = 'MaterialsReleaseGateError';
    this.checks = checks;
  }
}

/** Derived view of a project's quality job (OC-060..OC-062). */
export interface QualityView {
  readonly quality: QualityJob | null;
  readonly openIssues: number;
  readonly reworkCost: { readonly materialCost: number; readonly laborMinutes: number };
  readonly unitGates: readonly {
    readonly unitId: string;
    readonly status: string;
    readonly gate: { readonly ready: boolean; readonly overridden: boolean };
  }[];
  readonly eventsAppended?: number;
}
export interface WorkspaceRepository {
  /** Load full workspace; missing file → seed workspace. */
  load(): Promise<Workspace>;

  /** Persist full workspace (atomic on file adapters). */
  save(workspace: Workspace): Promise<void>;

  getCatalog(): Promise<Catalog>;
  saveCatalog(catalog: Catalog): Promise<void>;

  /**
   * Persist ONLY workshop settings. F118 S1: adapters must patch the stored
   * settings in place — never re-save a whole workspace snapshot built from
   * possibly-stale in-memory catalog/projects (that clobbered server data).
   */
  saveWorkshopSettings(settings: WorkshopSettings): Promise<void>;

  getProjects(): Promise<readonly Project[]>;
  /** Create a new project (POST). Prefer this over saveProject for first write. */
  createProject(project: Project): Promise<void>;
  /** Update existing project (upsert PUT→POST fallback for other adapters). */
  saveProject(project: Project): Promise<void>;
  deleteProject(projectId: string): Promise<void>;

  // --- Project templates (#110 / H15) ---

  getProjectTemplates(): Promise<readonly ProjectTemplate[]>;
  /** Create a new template (POST). Prefer this over saveProjectTemplate. */
  createProjectTemplate(template: ProjectTemplate): Promise<void>;
  /** Update existing template (upsert PUT→POST fallback). */
  saveProjectTemplate(template: ProjectTemplate): Promise<void>;
  deleteProjectTemplate(templateId: string): Promise<void>;

  // --- Project gallery photos (CRM Phase 1) ---

  getProjectPhotos?(projectId: string): Promise<readonly ProjectPhoto[]>;
  uploadProjectPhoto?(
    projectId: string,
    file: File | Blob,
    data?: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ): Promise<ProjectPhoto>;
  createProjectPhoto?(photo: {
    projectId: string;
    stage: ProjectPhotoStage;
    url: string;
    caption?: string;
    isShowcase?: boolean;
  }): Promise<ProjectPhoto>;
  updateProjectPhoto?(
    projectId: string,
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ): Promise<ProjectPhoto>;
  deleteProjectPhoto?(projectId: string, photoId: string): Promise<void>;
  listShowcasePhotos?(onlyShowcase?: boolean): Promise<readonly ShowcasePhotoItem[]>;


  // --- Internal messages & technical workflow (CRM Phase 2) ---

  getProjectInternalMessages?(projectId: string): Promise<readonly ProjectInternalMessage[]>;
  createProjectInternalMessage?(message: {
    projectId: string;
    messageType?: ProjectInternalMessageType;
    content: string;
    senderName?: string;
    attachments?: readonly string[];
  }): Promise<ProjectInternalMessage>;
  updateProjectTechnicalWorkflow?(
    projectId: string,
    updates: {
      assignedEngineerId?: string;
      technicalStatus?: ProjectTechnicalStatus;
      surveyCompletedAt?: string;
      installationScheduledDate?: string;
      comment?: string;
      forceRelease?: boolean;
    },
  ): Promise<Project>;

  // --- Floor scan & Loading status (PROD-3.1 / F092) ---

  floorScan?(
    projectId: string,
    payload: {
      module?: string;
      factoryCode?: string;
      itemId?: string;
      targetStatus?: ItemFloorStatus;
      advance?: boolean;
    },
  ): Promise<{
    projectId: string;
    projectName: string;
    itemId: string;
    factoryCode: string;
    moduleCode: string;
    moduleName: string;
    statusBefore: ItemFloorStatus;
    statusAfter: ItemFloorStatus;
    nextStatus: string;
    loadingProgress: LoadingProgress;
    /** Audit entry written for the transition (F092); null on no-op. */
    event?: FloorStatusEvent | null;
  }>;

  getProjectLoadingStatus?(projectId: string): Promise<{
    projectId: string;
    projectName: string;
    loadingProgress: LoadingProgress;
  }>;

  setProjectItemFloorStatus?(
    projectId: string,
    itemId: string,
    status?: ItemFloorStatus,
  ): Promise<{
    projectId: string;
    itemId: string;
    floorStatus: ItemFloorStatus;
    nextStatus: string;
    /** Audit entry written for the transition (F092); null on no-op. */
    event?: FloorStatusEvent | null;
  }>;

  /** Shop-floor transition log of a project, oldest first (F092). */
  listFloorEvents?(projectId: string): Promise<readonly FloorStatusEvent[]>;

  // --- Physical part/unit execution (#301 / OC-030..OC-034) ---

  /** Read the physical executions + per-unit assembly readiness. */
  getPartExecutions?(projectId: string): Promise<{
    partInstances: readonly PartInstance[];
    moduleUnits: readonly ModuleUnitExecution[];
    assemblyReadiness: readonly Record<string, unknown>[];
  }>;

  /** Generate/replace physical executions (server validates + guards). */
  generatePartExecutions?(projectId: string, payload: {
    partInstances: readonly PartInstance[];
    moduleUnits: readonly ModuleUnitExecution[];
    force?: boolean;
  }): Promise<{ partInstances: number; moduleUnits: number; forced: boolean }>;

  /** Complete one operation of a piece (current op when operationType omitted). */
  advancePartOperation?(projectId: string, partId: string, payload: {
    operationType?: PartOperationType;
    advance?: boolean;
    operatorName?: string;
    machineId?: string;
    notes?: string;
    source?: string;
  }): Promise<{ part: PartInstance; assemblyReadiness?: Record<string, unknown> }>;

  /** Advance one module unit through the server-side assembly gate. */
  advanceModuleUnit?(projectId: string, unitId: string, payload: {
    targetStatus?: ModuleUnitStatus;
    advance?: boolean;
    notes?: string;
    source?: string;
    packageCount?: number;
  }): Promise<{
    unit: ModuleUnitExecution;
    nextStatus: string;
    assemblyReadiness?: Record<string, unknown>;
  }>;

  // --- Installation job (OC-070..OC-074) ---

  /** Read the installation job + derived closeout view. */
  getInstallation?(projectId: string): Promise<InstallationView>;

  /**
   * Replace the installation job (server validates transitions and derives
   * the audit lifecycle events; closeout facts are rejected here).
   */
  saveInstallation?(
    projectId: string,
    job: InstallationJob,
  ): Promise<InstallationView & { eventsAppended: number }>;

  /**
   * Server-authoritative client sign-off / project close behind the OC-074
   * gates. Throws CloseoutGateError (with the failing checks) on 409.
   */
  installationCloseout?(
    projectId: string,
    payload: {
      action: 'complete_installation' | 'sign_off' | 'close';
      signedOffBy?: string;
      notes?: string;
      photoIds?: readonly string[];
    },
  ): Promise<{ installation: InstallationJob; closeout?: ClientCloseout } & InstallationView>;

  // --- Material planning (OC-050..OC-054) ---

  /** Read the planning + derived evidence view (coverage, release gates). */
  getMaterialPlanning?(projectId: string): Promise<MaterialPlanningView>;

  /** Materialize requirements from the released BOM (server binds release). */
  deriveMaterialRequirements?(
    projectId: string,
    lines: readonly MaterialRequirementLine[],
  ): Promise<MaterialPlanningView>;

  /** Reserve against warehouse availability; shortage remainder is audited. */
  reserveMaterials?(
    projectId: string,
    lines?: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[],
  ): Promise<MaterialPlanningView>;

  /**
   * Evidence-backed materials release (OC-054). Failing gates require an
   * override reason; throws MaterialsReleaseGateError (with the checks) on 409.
   */
  releaseMaterials?(
    projectId: string,
    overrideReason?: string,
  ): Promise<MaterialPlanningView>;

  // --- Quality job (OC-060..OC-062) ---

  /** Read the quality job + derived view (open issues, rework cost, QC gates). */
  getQuality?(projectId: string): Promise<QualityView>;

  /** Report a quality issue linked to a piece/unit (OC-060). */
  reportQualityIssue?(
    projectId: string,
    payload: {
      description: string;
      category: QualityIssue['category'];
      projectItemId?: string;
      partInstanceId?: string;
      moduleUnitId?: string;
      station?: QualityIssue['station'];
      notes?: string;
      photoIds?: readonly string[];
    },
  ): Promise<QualityView>;

  /** Resolve / verify / reopen a quality issue. */
  transitionQualityIssue?(
    projectId: string,
    issueId: string,
    toStatus: QualityIssueStatus,
    notes?: string,
  ): Promise<QualityView>;

  /** Record the OC-061 resolution with costing + physical piece effect. */
  recordQualityRework?(
    projectId: string,
    payload: {
      issueId: string;
      action: ReworkAction['action'];
      reason?: string;
      partInstanceId?: string;
      targetOperation?: string;
      materialCost?: number;
      laborMinutes?: number;
    },
  ): Promise<QualityView>;

  /** Per-unit QC checklist (OC-062); packaging reads it through the gate. */
  recordQualityUnitQc?(
    projectId: string,
    unitId: string,
    checklist: readonly UnitQcChecklistItem[],
    notes?: string,
  ): Promise<QualityView>;

  /** Supervisor-only audited override to package without approved QC. */
  overrideQualityUnitQc?(
    projectId: string,
    unitId: string,
    reason: string,
  ): Promise<QualityView>;

  // --- Production Activity Tracking (gerente_produccion) ---

  /** Full dashboard metrics: sectors, active jobs, damage counts. */
  getProductionDashboard?(): Promise<{
    totalProjects: number;
    totalItems: number;
    totalInstalled: number;
    avgProgress: number;
    todayCompleted: number;
    todayDamages: number;
    sectors: Array<{
      sector: string;
      label: string;
      activeOperators: number;
      queueLength: number;
      itemsInProgress: number;
      itemsCompletedToday: number;
      avgTimeMinutes: number;
      activeJobs: Array<{
        activityId: string;
        projectId: string;
        projectName: string;
        sector: string;
        itemId?: string;
        moduleCode?: string;
        operatorId: string;
        operatorName: string;
        machineId?: string;
        machineName?: string;
        startedAt: string;
        durationMin: number;
      }>;
    }>;
  }>;

  /** All active jobs right now across all sectors. */
  getProductionActiveJobs?(): Promise<Array<{
    activityId: string;
    projectId: string;
    projectName: string;
    sector: string;
    itemId?: string;
    moduleCode?: string;
    operatorId: string;
    operatorName: string;
    machineId?: string;
    machineName?: string;
    startedAt: string;
    durationMin: number;
  }>>;

  /** Operator claims a job (starts working). */
  claimProductionActivity?(payload: {
    projectId: string;
    itemId?: string;
    sector: string;
    machineId?: string;
    machineName?: string;
  }): Promise<{
    id: string;
    projectId: string;
    projectName: string;
    itemId?: string;
    moduleCode?: string;
    sector: string;
    type: string;
    operatorId: string;
    operatorName: string;
    startedAt: string;
    createdAt: string;
  }>;

  /** Operator finishes a job (records pieces count). */
  finishProductionActivity?(
    activityId: string,
    payload: { piecesCount: number; notes?: string },
  ): Promise<{
    id: string;
    projectId: string;
    projectName: string;
    itemId: string;
    moduleCode: string;
    sector: string;
    type: string;
    operatorId: string;
    operatorName: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    piecesCount: number;
    notes: string;
  }>;

  /** Report a damaged piece. */
  reportProductionDamage?(payload: {
    projectId: string;
    itemId: string;
    sector: string;
    damageType: string;
    description: string;
    photoUrl?: string;
    needsReplace: boolean;
  }): Promise<{
    id: string;
    projectId: string;
    projectName: string;
    itemId: string;
    sector: string;
    damageType: string;
    description: string;
    reportedBy: string;
    reportedByName: string;
    reportedAt: string;
    needsReplace: boolean;
  }>;

  /** Mark damage report as resolved. */
  resolveProductionDamage?(damageId: string): Promise<void>;

  // --- User Sector Management (Admin assigns sectors to operators) ---

  /** List sectors assigned to a user. */
  getUserSectors?(userId: string): Promise<Array<{
    userId: string;
    sector: string;
    subSector?: string;
    assignedAt: string;
  }>>;

  /** Set sectors for a user (replaces all existing). */
  setUserSectors?(userId: string, sectors: Array<{
    sector: string;
    subSector?: string;
  }>): Promise<void>;

  /** List operators assigned to a specific sector. */
  getOperatorsBySector?(sector: string): Promise<Array<{
    id: string;
    name: string;
    email: string;
  }>>;

  /** Own station assignments (Mi Estación, F094) — GET /api/me/sectors. */
  getMySectors?(): Promise<Array<{
    userId: string;
    sector: string;
    subSector?: string;
  }>>;

  // --- Compras / Almacén picking (Fase 3) ---

  /**
   * Every project × material picking state (persisted despacho). Returns
   * rows for all projects — the screen derives pendiente from absence.
   */
  listPickingStates?(): Promise<readonly ProjectPickingState[]>;
  /**
   * Upsert one project × material picking state. Server/local adapter stamp
   * markedAt/markedBy (who/when) on despacho; status pendiente clears them.
   */
  setProjectPickingState?(state: ProjectPickingState): Promise<void>;

  // --- Compras / Almacén stock (Fase 3b) ---

  /** All tracked materials with live balance + minimum. */
  getStock?(): Promise<readonly MaterialStock[]>;
  /**
   * Set the minimum-stock threshold of a material (creates the row when the
   * material was never tracked — it shows as agotado until an entrada).
   */
  upsertStockMin?(stock: {
    kind: StockMaterialKind;
    materialId: string;
    minStock: number;
  }): Promise<MaterialStock>;
  /**
   * Append a ledger movement and update the balance atomically. `quantity` is
   * positive for entrada/salida/despacho (sign decided by type); `ajuste` is
   * signed by the caller. A despacho with `revertsId` credits back (reversión).
   * Rejects when the balance would go negative or the material is untracked.
   */
  recordStockMovement?(payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    projectId?: string;
    note?: string;
    revertsId?: string;
  }): Promise<StockMovement>;
  /** Ledger, newest first, optionally filtered by kind/material_id/projectId. */
  listStockMovements?(filter?: {
    kind?: StockMaterialKind;
    materialId?: string;
    projectId?: string;
    limit?: number;
  }): Promise<readonly StockMovement[]>;

  // --- Compras / Almacén proveedores + órdenes de compra (Fase 3c) ---

  /** All suppliers (active + inactive). */
  listSuppliers?(): Promise<readonly Supplier[]>;
  /** Create a supplier (POST /api/suppliers). */
  createSupplier?(supplier: {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }): Promise<Supplier>;
  /** Update an existing supplier. */
  updateSupplier?(supplier: {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }): Promise<Supplier>;
  /** Deactivate a supplier (soft delete). */
  deactivateSupplier?(id: string): Promise<void>;
  /** All purchase orders, newest first. */
  listPurchaseOrders?(): Promise<readonly PurchaseOrder[]>;
  /** One purchase order with its items. */
  getPurchaseOrder?(id: string): Promise<PurchaseOrder | null>;
  /** Create a PO (borrador; number/status created server-side). */
  createPurchaseOrder?(po: {
    id: string;
    supplierId: string;
    notes?: string;
    items: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[];
  }): Promise<PurchaseOrder>;
  /** Edit a borrador PO (supplier + items replaced). */
  updatePurchaseOrder?(po: {
    id: string;
    supplierId: string;
    notes?: string;
    items: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[];
  }): Promise<PurchaseOrder>;
  /** borrador → emitida. */
  emitPurchaseOrder?(id: string): Promise<PurchaseOrder>;
  /** borrador/emitida → cancelada. */
  cancelPurchaseOrder?(id: string): Promise<PurchaseOrder>;
  /**
   * Receive lines of an emitted PO: records stock entradas (note references
   * the OC number) and advances received_quantity; fully received → recibida.
   */
  receivePurchaseOrder?(
    id: string,
    lines: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[],
  ): Promise<PurchaseOrder>;

  // --- Warranty Desk & Post-Sale (CRM Phase 3) ---

  getWarrantyTickets?(filter?: {
    projectId?: string;
    customerId?: string;
    status?: string;
  }): Promise<readonly WarrantyTicket[]>;
  getWarrantyTicket?(ticketId: string): Promise<WarrantyTicket | null>;
  createWarrantyTicket?(
    ticket: Partial<WarrantyTicket> & Pick<WarrantyTicket, 'projectId' | 'title'>,
  ): Promise<WarrantyTicket>;
  updateWarrantyTicket?(
    ticketId: string,
    updates: Partial<WarrantyTicket>,
  ): Promise<WarrantyTicket>;
  deleteWarrantyTicket?(ticketId: string): Promise<void>;
  uploadWarrantyTicketPhoto?(
    ticketId: string,
    file: File | Blob,
    data?: { kind?: WarrantyPhotoKind; caption?: string },
  ): Promise<WarrantyTicketPhoto>;
  createWarrantyTicketPhoto?(photo: {
    ticketId: string;
    url: string;
    kind?: WarrantyPhotoKind;
    caption?: string;
  }): Promise<WarrantyTicketPhoto>;
  deleteWarrantyTicketPhoto?(ticketId: string, photoId: string): Promise<void>;
}

