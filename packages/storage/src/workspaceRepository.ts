import type {
  Catalog,
  Project,
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
} from '@muebles/domain';

export interface WorkspaceRepository {
  /** Load full workspace; missing file → seed workspace. */
  load(): Promise<Workspace>;

  /** Persist full workspace (atomic on file adapters). */
  save(workspace: Workspace): Promise<void>;

  getCatalog(): Promise<Catalog>;
  saveCatalog(catalog: Catalog): Promise<void>;

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
        itemId: string;
        moduleCode: string;
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
    itemId: string;
    moduleCode: string;
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
    itemId: string;
    sector: string;
    machineId?: string;
    machineName?: string;
  }): Promise<{
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



