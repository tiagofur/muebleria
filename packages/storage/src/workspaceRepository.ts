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
  }>;

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



