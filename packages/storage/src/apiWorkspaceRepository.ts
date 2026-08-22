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
  WorkshopSettings,
  ItemFloorStatus,
  FloorStatusEvent,
  LoadingProgress,
  PartInstance,
  PartOperationType,
  ModuleUnitExecution,
  ModuleUnitStatus,
  InstallationJob,
  ClientCloseout,
  ProjectPickingState,
  MaterialStock,
  StockMaterialKind,
  StockMovement,
  StockMovementType,
  PurchaseOrder,
  Supplier,
  MaterialRequirementLine,
  QualityIssue,
  QualityIssueStatus,
  TimeEntry,
  OtherActualCost,
  ReworkAction,
  UnitQcChecklistItem,
} from '@muebles/domain';
import {
  DEFAULT_WORKSHOP_SETTINGS,
  withWorkshopSettings,
} from '@muebles/domain';
import type {
  WorkspaceRepository,
  InstallationView,
  InstallationCloseoutCheck,
  MaterialPlanningView,
  QualityView,
  JobCostingView,
} from './workspaceRepository';
import { CloseoutGateError, MaterialsReleaseGateError } from './workspaceRepository';
import {
  agregadoToApi,
  ambientCategoryToApi,
  ambientMaterialToApi,
  catalogFromApi,
  moduleUnitFromApi,
  moduleUnitToApi,
  partInstanceFromApi,
  partInstanceToApi,
  installationJobFromApi,
  installationJobToApi,
  materialPlanningFromApi,
  materialCoverageFromApi,
  materialAvailabilityFromApi,
  releaseChecksFromApi,
  qualityJobFromApi,
  closeoutChecksFromApi,
  categoryToApi,
  componentToApi,
  customerToApi,
  edgeToApi,
  hardwareToApi,
  materialToApi,
  moduleToApi,
  structureToApi,
  optionGroupToApi,
  projectFromApi,
  projectInternalMessageFromApi,
  projectPhotoFromApi,
  showcasePhotoItemFromApi,
  pickingStateFromApi,
  stockFromApi,
  stockMovementFromApi,
  supplierFromApi,
  supplierToApi,
  purchaseOrderFromApi,
  poItemToApi,
  projectTemplateFromApi,
  projectTemplateToApi,
  projectToApi,
  sortCategoriesForSave,
  warrantyTicketFromApi,
  warrantyTicketPhotoFromApi,
  warrantyTicketPhotoToApi,
  warrantyTicketToApi,
  workshopSettingsFromApi,
  workshopSettingsToApi,
  jobCostingFromApi,
  jobCostSummaryFromApi,
  materialCostValuationFromApi,
} from './apiMappers';

import { SCHEMA_VERSION } from './seed';

/** Snake_case floor event from the Go API → domain shape (F092). */
function floorEventFromApi(
  raw: unknown,
): FloorStatusEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? '');
  if (!id) return null;
  return {
    id,
    projectId: String(r.project_id ?? ''),
    itemId: String(r.item_id ?? ''),
    from: (r.from_status as FloorStatusEvent['from']) ?? 'pending',
    to: (r.to_status as FloorStatusEvent['to']) ?? 'pending',
    at: String(r.at ?? ''),
    byUserId: r.by_user_id ? String(r.by_user_id) : undefined,
    byName: r.by_name ? String(r.by_name) : undefined,
    source: (r.source as FloorStatusEvent['source']) ?? 'api',
    note: r.note ? String(r.note) : undefined,
  };
}

function activeJobFromApi(raw: Record<string, unknown>): {
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
} {
  const optionalString = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined;

  return {
    activityId: String(raw.activity_id ?? ''),
    projectId: String(raw.project_id ?? ''),
    projectName: String(raw.project_name ?? ''),
    sector: String(raw.sector ?? ''),
    itemId: optionalString(raw.item_id),
    moduleCode: optionalString(raw.module_code),
    operatorId: String(raw.operator_id ?? ''),
    operatorName: String(raw.operator_name ?? ''),
    machineId: optionalString(raw.machine_id),
    machineName: optionalString(raw.machine_name),
    startedAt: String(raw.started_at ?? ''),
    durationMin: typeof raw.duration_min === 'number' ? raw.duration_min : 0,
  };
}

function dashboardMetricsFromApi(raw: Record<string, unknown>): {
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
} {
  const num = (v: unknown): number =>
    typeof v === 'number' ? v : 0;
  const sectors = Array.isArray(raw.sectors)
    ? (raw.sectors as Record<string, unknown>[]).map((s) => ({
        sector: String(s.sector ?? ''),
        label: String(s.label ?? ''),
        activeOperators: num(s.active_operators),
        queueLength: num(s.queue_length),
        itemsInProgress: num(s.items_in_progress),
        itemsCompletedToday: num(s.items_completed_today),
        avgTimeMinutes: num(s.avg_time_minutes),
        activeJobs: Array.isArray(s.active_jobs)
          ? (s.active_jobs as Record<string, unknown>[]).map(activeJobFromApi)
          : [],
      }))
    : [];

  return {
    totalProjects: num(raw.total_projects),
    totalItems: num(raw.total_items),
    totalInstalled: num(raw.total_installed),
    avgProgress: num(raw.avg_progress),
    todayCompleted: num(raw.today_completed),
    todayDamages: num(raw.today_damages),
    sectors,
  };
}

function claimedProductionActivityFromApi(raw: Record<string, unknown>): {
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
} {
  const optionalString = (value: unknown): string | undefined =>
    typeof value === 'string' && value !== '' ? value : undefined;

  return {
    id: String(raw.id ?? ''),
    projectId: String(raw.project_id ?? ''),
    projectName: String(raw.project_name ?? ''),
    itemId: optionalString(raw.item_id),
    moduleCode: optionalString(raw.module_code),
    sector: String(raw.sector ?? ''),
    type: String(raw.type ?? ''),
    operatorId: String(raw.operator_id ?? ''),
    operatorName: String(raw.operator_name ?? ''),
    startedAt: String(raw.started_at ?? ''),
    createdAt: String(raw.created_at ?? ''),
  };
}

export class APIWorkspaceRepository implements WorkspaceRepository {
  private readonly baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8080/api') {
    this.baseUrl = baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      try {
        const token = globalThis.localStorage.getItem('muebles_token');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {
        // Ignorar si localStorage está deshabilitado
      }
    }
    return headers;
  }

  async load(): Promise<Workspace> {
    const catalog = await this.getCatalog();
    const projects = await this.getProjects();
    const settings = await this.getWorkshopSettings();
    const projectTemplates = await this.getProjectTemplates();
    return withWorkshopSettings({
      schemaVersion: SCHEMA_VERSION,
      catalog,
      projects,
      projectTemplates,
      settings,
    });
  }

  async save(workspace: Workspace): Promise<void> {
    if (workspace.settings) {
      await this.saveWorkshopSettings(workspace.settings);
    }
    await this.saveCatalog(workspace.catalog);
    for (const p of workspace.projects) {
      await this.saveProject(p);
    }
    for (const t of workspace.projectTemplates ?? []) {
      await this.saveProjectTemplate(t);
    }
  }

  async getWorkshopSettings(): Promise<WorkshopSettings> {
    const headers = this.getHeaders();
    try {
      const res = await fetch(`${this.baseUrl}/settings`, { headers });
      if (!res.ok) {
        return { ...DEFAULT_WORKSHOP_SETTINGS };
      }
      return workshopSettingsFromApi(await res.json());
    } catch {
      return { ...DEFAULT_WORKSHOP_SETTINGS };
    }
  }

  async saveWorkshopSettings(settings: WorkshopSettings): Promise<void> {
    const headers = this.getHeaders();
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(workshopSettingsToApi(settings)),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to save settings: ${res.status} ${res.statusText}`,
      );
    }
  }

  async getCatalog(): Promise<Catalog> {
    const headers = this.getHeaders();
    const fetchJson = async (path: string): Promise<unknown> => {
      const res = await fetch(`${this.baseUrl}${path}`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to load ${path}: ${res.status} ${res.statusText}`);
      }
      return res.json();
    };

    const [
      materials,
      edges,
      hardware,
      optionGroups,
      modules,
      customers,
      categories,
      structures,
      components,
      agregados,
      ambientMaterials,
      ambientCategories,
    ] = await Promise.all([
      fetchJson('/catalog/materials'),
      fetchJson('/catalog/edges'),
      fetchJson('/catalog/hardware'),
      fetchJson('/catalog/option-groups'),
      fetchJson('/catalog/modules'),
      fetchJson('/customers'),
      fetchJson('/catalog/categories'),
      fetchJson('/catalog/structures').catch(() => []),
      fetchJson('/catalog/components').catch(() => []),
      fetchJson('/catalog/agregados').catch(() => []),
      // Ambient materials are presentation-only (floor/wall textures for the 3D
      // room scene). `.catch(() => [])` keeps older backends (without the
      // endpoint) working — ambient renders as none, same as today.
      fetchJson('/catalog/ambient-materials').catch(() => []),
      fetchJson('/catalog/ambient-categories').catch(() => []),
    ]);

    return catalogFromApi({
      materials,
      edges,
      hardware,
      optionGroups,
      modules,
      structures,
      categories,
      customers,
      components,
      agregados,
      ambientMaterials,
      ambientCategories,
    });
  }

  /**
   * Upsert entity: PUT by id; only POST when missing (404) or transport error.
   * Avoids POST-on-500 which caused duplicate-key / cascade noise.
   *
   * Conflict handling (F116 C2): a 409 (or 400 with a duplicate-key message)
   * from either PUT or POST means the payload's code collides with another
   * row. It is rethrown so saveCatalog rejects and the shell surfaces an
   * error — swallowing it made the UI claim "✓ creado" for entities the
   * server never accepted (they vanished on refresh).
   */
  private async upsert(
    pathById: string,
    pathCollection: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    let res: Response | null = null;
    try {
      res = await fetch(`${this.baseUrl}${pathById}`, {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });
    } catch {
      res = null;
    }

    if (res?.ok) return;

    const putBody = res ? await res.text().catch(() => '') : '';
    if (res && isConflict(res.status, putBody)) {
      const msg = `API upsert conflict ${pathById}: el código ya existe en el servidor`;
      console.error(msg);
      throw new Error(msg);
    }

    const missing =
      !res ||
      res.status === 404 ||
      res.status === 405 ||
      // Legacy Go handlers returned 500 "no rows" before not-found mapping.
      (res.status === 500 && /not found|no rows/i.test(putBody));

    if (!missing) {
      const msg = `API upsert failed ${pathById}: ${res?.status} ${putBody}`;
      console.error(msg);
      // Must throw so saveCatalog rejects and the shell toasts — silent
      // return left materials looking saved in UI until refresh (e.g. new
      // columns not yet migrated / old server binary).
      throw new Error(msg);
    }

    try {
      const created = await fetch(`${this.baseUrl}${pathCollection}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      });
      if (!created.ok) {
        const text = await created.text().catch(() => '');
        const msg = `API create failed ${pathCollection}: ${created.status} ${text}`;
        console.error(msg);
        throw new Error(msg);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('API create failed')) {
        throw err;
      }
      console.error(`API create error ${pathCollection}:`, err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  async saveCatalog(catalog: Catalog): Promise<void> {
    for (const m of catalog.materials) {
      await this.upsert(
        `/catalog/materials/${m.id}`,
        '/catalog/materials',
        materialToApi(m),
      );
    }

    for (const e of catalog.edges) {
      await this.upsert(
        `/catalog/edges/${e.id}`,
        '/catalog/edges',
        edgeToApi(e),
      );
    }

    for (const h of catalog.hardware) {
      await this.upsert(
        `/catalog/hardware/${h.id}`,
        '/catalog/hardware',
        hardwareToApi(h),
      );
    }

    for (const og of catalog.optionGroups) {
      await this.upsert(
        `/catalog/option-groups/${og.id}`,
        '/catalog/option-groups',
        optionGroupToApi(og),
      );
    }

    // Components before structures/modules: structure_components and
    // module_components FK reference components(id).
    for (const c of catalog.components ?? []) {
      await this.upsert(
        `/catalog/components/${c.id}`,
        '/catalog/components',
        componentToApi(c),
      );
    }

    for (const a of catalog.agregados ?? []) {
      await this.upsert(
        `/catalog/agregados/${a.id}`,
        '/catalog/agregados',
        agregadoToApi(a),
      );
    }

    for (const st of catalog.structures ?? []) {
      await this.upsert(
        `/catalog/structures/${st.id}`,
        '/catalog/structures',
        structureToApi(st),
      );
    }

    // Categories before modules (FK); parents before children.
    if (catalog.categories) {
      for (const cat of sortCategoriesForSave(catalog.categories)) {
        await this.upsert(
          `/catalog/categories/${cat.id}`,
          '/catalog/categories',
          categoryToApi(cat),
        );
      }
    }

    for (const mod of catalog.modules) {
      await this.upsert(
        `/catalog/modules/${mod.id}`,
        '/catalog/modules',
        moduleToApi(mod),
      );
    }

    if (catalog.customers) {
      for (const c of catalog.customers) {
        await this.upsert(
          `/customers/${c.id}`,
          '/customers',
          customerToApi(c),
        );
      }
    }

    // Ambient categories (finishes taxonomy, max 3 levels).
    if (catalog.ambientCategories) {
      for (const cat of sortCategoriesForSave(catalog.ambientCategories)) {
        await this.upsert(
          `/catalog/ambient-categories/${cat.id}`,
          '/catalog/ambient-categories',
          ambientCategoryToApi(cat),
        );
      }
    }

    // Ambient materials (floor/wall/ceiling textures and finishes). Without this loop,
    // create/update in the UI mutates the in-memory catalog but never reaches
    // the DB — the material vanishes on reload (getCatalog fetches []).
    if (catalog.ambientMaterials) {
      for (const am of catalog.ambientMaterials) {
        await this.upsert(
          `/catalog/ambient-materials/${am.id}`,
          '/catalog/ambient-materials',
          ambientMaterialToApi(am),
        );
      }
    }
  }

  async getProjects(): Promise<readonly Project[]> {
    const res = await fetch(`${this.baseUrl}/projects`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to load projects: ${res.statusText}`);
    }
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : [];
    return list.map((p) => projectFromApi(p as Record<string, unknown>));
  }

  /**
   * Create path — POST only. Avoids the upsert PUT probe that always 404s for
   * brand-new ids (noisy console) and is the correct verb for first insert.
   */
  async createProject(project: Project): Promise<void> {
    const res = await fetch(`${this.baseUrl}/projects`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(projectToApi(project)),
    });
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    if (isConflict(res.status, text)) return;
    console.error(`API create failed /projects: ${res.status} ${text}`);
    throw new Error(`Failed to create project: ${res.status} ${text}`);
  }

  async saveProject(project: Project): Promise<void> {
    await this.upsert(
      `/projects/${project.id}`,
      '/projects',
      projectToApi(project),
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    await fetch(`${this.baseUrl}/projects/${projectId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
  }

  // --- Project templates (#110 / H15) ---

  async getProjectTemplates(): Promise<readonly ProjectTemplate[]> {
    const res = await fetch(`${this.baseUrl}/project-templates`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      // Endpoint may not exist yet on older backends → treat as empty.
      return [];
    }
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : [];
    return list.map((t) =>
      projectTemplateFromApi(t as Record<string, unknown>),
    );
  }

  async createProjectTemplate(template: ProjectTemplate): Promise<void> {
    const res = await fetch(`${this.baseUrl}/project-templates`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(projectTemplateToApi(template)),
    });
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    if (isConflict(res.status, text)) return;
    console.error(
      `API create failed /project-templates: ${res.status} ${text}`,
    );
    throw new Error(`Failed to create project template: ${res.status} ${text}`);
  }

  async saveProjectTemplate(template: ProjectTemplate): Promise<void> {
    await this.upsert(
      `/project-templates/${template.id}`,
      '/project-templates',
      projectTemplateToApi(template),
    );
  }

  async deleteProjectTemplate(templateId: string): Promise<void> {
    await fetch(`${this.baseUrl}/project-templates/${templateId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
  }

  // --- Project gallery photos (CRM Phase 1) ---

  async getProjectPhotos(projectId: string): Promise<readonly ProjectPhoto[]> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/photos`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Failed to load project photos: ${res.statusText}`);
    }
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : [];
    return list.map((p) => projectPhotoFromApi(p as Record<string, unknown>));
  }

  async uploadProjectPhoto(
    projectId: string,
    file: File | Blob,
    data?: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ): Promise<ProjectPhoto> {
    const formData = new FormData();
    formData.append('file', file);
    if (data?.stage) formData.append('stage', data.stage);
    if (data?.caption) formData.append('caption', data.caption);
    if (data?.isShowcase !== undefined) formData.append('is_showcase', String(data.isShowcase));

    const headers: Record<string, string> = {};
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      try {
        const token = globalThis.localStorage.getItem('muebles_token');
        if (token) headers['Authorization'] = `Bearer ${token}`;
      } catch {
        // ignore
      }
    }

    const res = await fetch(`${this.baseUrl}/projects/${projectId}/photos`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to upload project photo: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return projectPhotoFromApi(raw as Record<string, unknown>);
  }

  async createProjectPhoto(photo: {
    projectId: string;
    stage: ProjectPhotoStage;
    url: string;
    caption?: string;
    isShowcase?: boolean;
  }): Promise<ProjectPhoto> {
    const res = await fetch(`${this.baseUrl}/projects/${photo.projectId}/photos`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        stage: photo.stage,
        url: photo.url,
        caption: photo.caption,
        is_showcase: photo.isShowcase,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create project photo: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return projectPhotoFromApi(raw as Record<string, unknown>);
  }

  async updateProjectPhoto(
    projectId: string,
    photoId: string,
    updates: { stage?: ProjectPhotoStage; caption?: string; isShowcase?: boolean },
  ): Promise<ProjectPhoto> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/photos/${photoId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        stage: updates.stage,
        caption: updates.caption,
        is_showcase: updates.isShowcase,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to update project photo: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return projectPhotoFromApi(raw as Record<string, unknown>);
  }

  async deleteProjectPhoto(projectId: string, photoId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/photos/${photoId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to delete project photo: ${res.status} ${text}`);
    }
  }

  async listShowcasePhotos(onlyShowcase = false): Promise<readonly ShowcasePhotoItem[]> {
    const url = `${this.baseUrl}/showcase/photos${onlyShowcase ? '?only_showcase=true' : ''}`;
    const res = await fetch(url, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      throw new Error(`Failed to load showcase photos: ${res.statusText}`);
    }
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : [];
    return list.map((p) => showcasePhotoItemFromApi(p as Record<string, unknown>));
  }


  async getProjectInternalMessages(projectId: string): Promise<readonly ProjectInternalMessage[]> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/messages`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to load project internal messages: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw.map((r) => projectInternalMessageFromApi(r as Record<string, unknown>));
  }

  async createProjectInternalMessage(message: {
    projectId: string;
    messageType?: ProjectInternalMessageType;
    content: string;
    senderName?: string;
    attachments?: readonly string[];
  }): Promise<ProjectInternalMessage> {
    const res = await fetch(`${this.baseUrl}/projects/${message.projectId}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        message_type: message.messageType ?? 'comment',
        content: message.content,
        sender_name: message.senderName,
        attachments: message.attachments ? [...message.attachments] : [],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create internal message: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return projectInternalMessageFromApi(raw as Record<string, unknown>);
  }

  async updateProjectTechnicalWorkflow(
    projectId: string,
    updates: {
      assignedEngineerId?: string;
      technicalStatus?: ProjectTechnicalStatus;
      surveyCompletedAt?: string;
      installationScheduledDate?: string;
      comment?: string;
      forceRelease?: boolean;
    },
  ): Promise<Project> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/technical-workflow`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        assigned_engineer_id: updates.assignedEngineerId,
        technical_status: updates.technicalStatus,
        survey_completed_at: updates.surveyCompletedAt,
        installation_scheduled_date: updates.installationScheduledDate,
        comment: updates.comment,
        force_release: updates.forceRelease,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to update technical workflow: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return projectFromApi(raw as Record<string, unknown>);
  }

  // --- Floor scan & Loading status (PROD-3.1 / F092) ---

  async floorScan(
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
    event?: FloorStatusEvent | null;
  }> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/floor-scan`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        module: payload.module,
        factory_code: payload.factoryCode,
        item_id: payload.itemId,
        target_status: payload.targetStatus,
        advance: payload.advance,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Floor scan failed: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const progressRaw = (raw.loading_progress ?? {}) as Record<string, unknown>;
    return {
      projectId: String(raw.project_id ?? ''),
      projectName: String(raw.project_name ?? ''),
      itemId: String(raw.item_id ?? ''),
      factoryCode: String(raw.factory_code ?? ''),
      moduleCode: String(raw.module_code ?? ''),
      moduleName: String(raw.module_name ?? ''),
      statusBefore: (raw.status_before as ItemFloorStatus) ?? 'pending',
      statusAfter: (raw.status_after as ItemFloorStatus) ?? 'pending',
      nextStatus: String(raw.next_status ?? ''),
      loadingProgress: {
        totalUnits: Number(progressRaw.total_packages ?? 0),
        loadedUnits: Number(progressRaw.loaded_packages ?? 0),
        percentage: Number(progressRaw.loading_percentage ?? 0),
        isComplete: Boolean(progressRaw.all_loaded),
        totalPackages: Number(progressRaw.total_packages ?? 0),
        packagedPackages: Number(progressRaw.packaged_packages ?? 0),
        loadedPackages: Number(progressRaw.loaded_packages ?? 0),
        installedPackages: Number(progressRaw.installed_packages ?? 0),
        packagingPercentage: Number(progressRaw.packaging_percentage ?? 0),
        loadingPercentage: Number(progressRaw.loading_percentage ?? 0),
        allPackaged: Boolean(progressRaw.all_packaged),
        allLoaded: Boolean(progressRaw.all_loaded),
        canReleaseToDelivery: Boolean(progressRaw.can_release_to_delivery),
      },
      event: floorEventFromApi(raw.event),
    };
  }

  // --- Physical part & unit execution (OC-030..OC-034 / #301) ---

  /**
   * Raw assembly readiness payload returned by the part-executions endpoints.
   * Mirrors domain AssemblyReadiness (snake_case over the wire).
   */
  async getPartExecutions(projectId: string): Promise<{
    partInstances: readonly PartInstance[];
    moduleUnits: readonly ModuleUnitExecution[];
    assemblyReadiness: readonly Record<string, unknown>[];
  }> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/part-executions`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get part executions: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const partsRaw = Array.isArray(raw.part_instances) ? raw.part_instances : [];
    const unitsRaw = Array.isArray(raw.module_units) ? raw.module_units : [];
    const readinessRaw = Array.isArray(raw.assembly_readiness) ? raw.assembly_readiness : [];
    return {
      partInstances: partsRaw.map((p) => partInstanceFromApi(p as Record<string, unknown>)),
      moduleUnits: unitsRaw.map((u) => moduleUnitFromApi(u as Record<string, unknown>)),
      assemblyReadiness: readinessRaw as Record<string, unknown>[],
    };
  }

  async advancePartOperation(
    projectId: string,
    partId: string,
    payload: {
      /** Station advance: the explicit operation to complete. Omit it to let
       * the server complete the piece's CURRENT operation (scanner mode). */
      operationType?: PartOperationType;
      advance?: boolean;
      operatorName?: string;
      machineId?: string;
      notes?: string;
      source?: string;
    },
  ): Promise<{ part: PartInstance; assemblyReadiness?: Record<string, unknown> }> {
    return this.postPartExecution(
      `/projects/${projectId}/parts/${encodeURIComponent(partId)}/advance`,
      {
        operation_type: payload.operationType,
        advance: payload.advance ?? payload.operationType === undefined,
        operator_name: payload.operatorName,
        machine_id: payload.machineId,
        notes: payload.notes,
        source: payload.source,
      },
    );
  }

  async advanceModuleUnit(
    projectId: string,
    unitId: string,
    payload: {
      targetStatus?: ModuleUnitStatus;
      advance?: boolean;
      notes?: string;
      source?: string;
      /** Bulto count recorded when the unit enters `packaged`. */
      packageCount?: number;
    },
  ): Promise<{
    unit: ModuleUnitExecution;
    nextStatus: string;
    assemblyReadiness?: Record<string, unknown>;
  }> {
    return this.postPartExecution(
      `/projects/${projectId}/units/${encodeURIComponent(unitId)}/advance`,
      {
        target_status: payload.targetStatus,
        advance: payload.advance,
        notes: payload.notes,
        source: payload.source,
        package_count: payload.packageCount,
      },
    );
  }

  async assemblyOverride(
    projectId: string,
    unitId: string,
    reason: string,
  ): Promise<{ unit: ModuleUnitExecution }> {
    return this.postPartExecution(
      `/projects/${projectId}/units/${encodeURIComponent(unitId)}/assembly-override`,
      { reason },
    );
  }

  async reworkPart(
    projectId: string,
    partId: string,
    payload: {
      action: 'rework' | 'refabricate';
      reason: string;
      targetOperation?: PartOperationType;
      /** OC-061 job costing: affected material cost and labor minutes. */
      materialCost?: number;
      laborMinutes?: number;
    },
  ): Promise<{ part: PartInstance }> {
    return this.postPartExecution(
      `/projects/${projectId}/parts/${encodeURIComponent(partId)}/rework`,
      {
        action: payload.action,
        reason: payload.reason,
        target_operation: payload.targetOperation,
        material_cost: payload.materialCost,
        labor_minutes: payload.laborMinutes,
      },
    );
  }

  /**
   * Generate/replace the physical executions of a project (#301). The BOM
   * resolution lives in TS domain (derivePartInstancesForProject); the server
   * validates lines/quantities/released revision and refuses to discard floor
   * progress without an explicit supervisor force.
   */
  async generatePartExecutions(
    projectId: string,
    payload: {
      partInstances: readonly PartInstance[];
      moduleUnits: readonly ModuleUnitExecution[];
      force?: boolean;
    },
  ): Promise<{ partInstances: number; moduleUnits: number; forced: boolean }> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/part-executions`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        part_instances: payload.partInstances.map(partInstanceToApi),
        module_units: payload.moduleUnits.map(moduleUnitToApi),
        force: payload.force,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Generate part executions failed: ${res.status} ${text}`);
    }
    return (await res.json()) as { partInstances: number; moduleUnits: number; forced: boolean };
  }

  // --- Installation job (OC-070..OC-074) ---

  /** Parse the derived installation view shared by GET/PUT/closeout. */
  private parseInstallationView(raw: Record<string, unknown>): InstallationView {
    const unitsRaw = (raw.units ?? {}) as Record<string, unknown>;
    return {
      installation: installationJobFromApi(raw.installation) ?? null,
      jobStatus: (String(raw.job_status ?? 'planned')) as InstallationView['jobStatus'],
      units: {
        mode: String(unitsRaw.mode ?? 'none'),
        installed: Number(unitsRaw.installed ?? 0),
        total: Number(unitsRaw.total ?? 0),
      },
      closeoutChecks: closeoutChecksFromApi(raw.closeout_checks ?? raw.closeoutChecks),
      closeoutReady: Boolean(raw.closeout_ready ?? raw.closeoutReady),
    };
  }

  async getInstallation(projectId: string): Promise<InstallationView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/installation`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get installation: ${res.status} ${text}`);
    }
    return this.parseInstallationView((await res.json()) as Record<string, unknown>);
  }

  async saveInstallation(
    projectId: string,
    job: InstallationJob,
  ): Promise<InstallationView & { eventsAppended: number }> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/installation`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(installationJobToApi(job)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Save installation failed: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      ...this.parseInstallationView(raw),
      eventsAppended: Number(raw.events_appended ?? raw.eventsAppended ?? 0),
    };
  }

  async installationCloseout(
    projectId: string,
    payload: {
      action: 'complete_installation' | 'sign_off' | 'close';
      signedOffBy?: string;
      notes?: string;
      photoIds?: readonly string[];
    },
  ): Promise<{ installation: InstallationJob; closeout?: ClientCloseout } & InstallationView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/installation/closeout`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        action: payload.action,
        signed_off_by: payload.signedOffBy,
        notes: payload.notes,
        photo_ids: payload.photoIds,
      }),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const checks: readonly InstallationCloseoutCheck[] = closeoutChecksFromApi(
        raw.closeout_checks ?? raw.closeoutChecks,
      );
      if (res.status === 409 && checks.length > 0) {
        throw new CloseoutGateError(checks, String(raw.error ?? 'gates de cierre pendientes'));
      }
      throw new Error(`Installation closeout failed: ${res.status} ${JSON.stringify(raw)}`);
    }
    const view = this.parseInstallationView(raw);
    const installation =
      installationJobFromApi(raw.installation) ??
      view.installation ??
      (() => {
        throw new Error('Installation closeout failed: respuesta sin installation');
      })();
    return {
      ...view,
      installation,
      closeout: installation.closeout,
    };
  }

  /** Shared POST + parse for the part-executions endpoints. */
  private async postPartExecution<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Part execution failed: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const part = raw.part ? partInstanceFromApi(raw.part as Record<string, unknown>) : undefined;
    const unit = raw.unit ? moduleUnitFromApi(raw.unit as Record<string, unknown>) : undefined;
    return {
      ...(part ? { part } : {}),
      ...(unit ? { unit } : {}),
      ...(raw.next_status !== undefined ? { nextStatus: String(raw.next_status ?? '') } : {}),
      ...(raw.assembly_readiness !== undefined && raw.assembly_readiness !== null
        ? { assemblyReadiness: raw.assembly_readiness as Record<string, unknown> }
        : {}),
    } as T;
  }

  async getProjectLoadingStatus(projectId: string): Promise<{
    projectId: string;
    projectName: string;
    loadingProgress: LoadingProgress;
  }> {
    const res = await fetch(
      `${this.baseUrl}/projects/${projectId}/loading-status`,
      {
        headers: this.getHeaders(),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get loading status: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    const progressRaw = (raw.loading_progress ?? {}) as Record<string, unknown>;
    return {
      projectId: String(raw.project_id ?? ''),
      projectName: String(raw.project_name ?? ''),
      loadingProgress: {
        totalUnits: Number(progressRaw.total_packages ?? 0),
        loadedUnits: Number(progressRaw.loaded_packages ?? 0),
        percentage: Number(progressRaw.loading_percentage ?? 0),
        isComplete: Boolean(progressRaw.all_loaded),
        totalPackages: Number(progressRaw.total_packages ?? 0),
        packagedPackages: Number(progressRaw.packaged_packages ?? 0),
        loadedPackages: Number(progressRaw.loaded_packages ?? 0),
        installedPackages: Number(progressRaw.installed_packages ?? 0),
        packagingPercentage: Number(progressRaw.packaging_percentage ?? 0),
        loadingPercentage: Number(progressRaw.loading_percentage ?? 0),
        allPackaged: Boolean(progressRaw.all_packaged),
        allLoaded: Boolean(progressRaw.all_loaded),
        canReleaseToDelivery: Boolean(progressRaw.can_release_to_delivery),
      },
    };
  }

  async setProjectItemFloorStatus(
    projectId: string,
    itemId: string,
    status?: ItemFloorStatus,
  ): Promise<{
    projectId: string;
    itemId: string;
    floorStatus: ItemFloorStatus;
    nextStatus: string;
    event?: FloorStatusEvent | null;
  }> {
    const res = await fetch(
      `${this.baseUrl}/projects/${projectId}/items/${itemId}/floor-status`,
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ status }),
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set floor status: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    return {
      projectId: String(raw.project_id ?? ''),
      itemId: String(raw.item_id ?? ''),
      floorStatus: (raw.floor_status as ItemFloorStatus) ?? 'pending',
      nextStatus: String(raw.next_status ?? ''),
      event: floorEventFromApi(raw.event),
    };
  }

  async listFloorEvents(
    projectId: string,
  ): Promise<readonly FloorStatusEvent[]> {
    const res = await fetch(
      `${this.baseUrl}/projects/${projectId}/floor-events`,
      { headers: this.getHeaders() },
    );
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list floor events: ${res.status} ${text}`);
    }
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e) => floorEventFromApi(e as Record<string, unknown>))
      .filter((e): e is FloorStatusEvent => e !== null);
  }

  // --- Warranty Desk & Post-Sale (CRM Phase 3) ---

  async getWarrantyTickets(filter?: {
    projectId?: string;
    customerId?: string;
    status?: string;
  }): Promise<readonly WarrantyTicket[]> {
    const params = new URLSearchParams();
    if (filter?.projectId) params.set('project_id', filter.projectId);
    if (filter?.customerId) params.set('customer_id', filter.customerId);
    if (filter?.status) params.set('status', filter.status);

    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/warranties${query}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list warranty tickets: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw.map((t) => warrantyTicketFromApi(t as Record<string, unknown>));
  }

  async getWarrantyTicket(ticketId: string): Promise<WarrantyTicket | null> {
    const res = await fetch(`${this.baseUrl}/warranties/${ticketId}`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get warranty ticket: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return warrantyTicketFromApi(raw as Record<string, unknown>);
  }

  async createWarrantyTicket(
    ticket: Partial<WarrantyTicket> & Pick<WarrantyTicket, 'projectId' | 'title'>,
  ): Promise<WarrantyTicket> {
    const res = await fetch(`${this.baseUrl}/warranties`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        id: ticket.id,
        ticket_number: ticket.ticketNumber,
        project_id: ticket.projectId,
        customer_id: ticket.customerId,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        assigned_technician_id: ticket.assignedTechnicianId,
        scheduled_date: ticket.scheduledDate,
        refabrication_pieces: ticket.refabricationPieces,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create warranty ticket: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return warrantyTicketFromApi(raw as Record<string, unknown>);
  }

  async updateWarrantyTicket(
    ticketId: string,
    updates: Partial<WarrantyTicket>,
  ): Promise<WarrantyTicket> {
    const res = await fetch(`${this.baseUrl}/warranties/${ticketId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({
        title: updates.title,
        description: updates.description,
        category: updates.category,
        priority: updates.priority,
        status: updates.status,
        assigned_technician_id: updates.assignedTechnicianId,
        scheduled_date: updates.scheduledDate,
        resolved_at: updates.resolvedAt,
        resolution_notes: updates.resolutionNotes,
        refabrication_pieces: updates.refabricationPieces,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to update warranty ticket: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return warrantyTicketFromApi(raw as Record<string, unknown>);
  }

  async deleteWarrantyTicket(ticketId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/warranties/${ticketId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to delete warranty ticket: ${res.status} ${text}`);
    }
  }

  async uploadWarrantyTicketPhoto(
    ticketId: string,
    file: File | Blob,
    data?: { kind?: WarrantyPhotoKind; caption?: string },
  ): Promise<WarrantyTicketPhoto> {
    const formData = new FormData();
    formData.append('file', file);
    if (data?.kind) formData.append('kind', data.kind);
    if (data?.caption) formData.append('caption', data.caption);

    const headers = this.getHeaders();
    delete headers['Content-Type'];

    const res = await fetch(`${this.baseUrl}/warranties/${ticketId}/photos`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to upload warranty photo: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return warrantyTicketPhotoFromApi(raw as Record<string, unknown>);
  }

  async createWarrantyTicketPhoto(photo: {
    ticketId: string;
    url: string;
    kind?: WarrantyPhotoKind;
    caption?: string;
  }): Promise<WarrantyTicketPhoto> {
    const res = await fetch(`${this.baseUrl}/warranties/${photo.ticketId}/photos`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        kind: photo.kind,
        url: photo.url,
        caption: photo.caption,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create warranty photo: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return warrantyTicketPhotoFromApi(raw as Record<string, unknown>);
  }

  async deleteWarrantyTicketPhoto(ticketId: string, photoId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/warranties/${ticketId}/photos/${photoId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to delete warranty photo: ${res.status} ${text}`);
    }
  }

  // ─── Production Activity Tracking (gerente_produccion) ──────────────────────

  async getProductionDashboard(): Promise<{
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
  }> {
    const res = await fetch(`${this.baseUrl}/production/dashboard`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to fetch production dashboard: ${res.status} ${text}`);
    }
    const data = await res.json() as { metrics: Record<string, unknown> };
    return dashboardMetricsFromApi(data.metrics ?? {});
  }

  async getProductionActiveJobs(): Promise<Array<{
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
  }>> {
    const res = await fetch(`${this.baseUrl}/production/active`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to fetch active jobs: ${res.status} ${text}`);
    }
    const data = await res.json() as { jobs: readonly Record<string, unknown>[] };
    return (data.jobs ?? []).map(activeJobFromApi);
  }

  async claimProductionActivity(payload: {
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
  }> {
    const res = await fetch(`${this.baseUrl}/production/activity/claim`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        project_id: payload.projectId,
        item_id: payload.itemId,
        sector: payload.sector,
        machine_id: payload.machineId,
        machine_name: payload.machineName,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to claim activity: ${res.status} ${text}`);
    }
    const raw = await res.json() as { activity: Record<string, unknown> };
    return claimedProductionActivityFromApi(raw.activity);
  }

  async finishProductionActivity(activityId: string, payload: { piecesCount: number; notes?: string }): Promise<{
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
  }> {
    const res = await fetch(`${this.baseUrl}/production/activity/finish/${activityId}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to finish activity: ${res.status} ${text}`);
    }
    const raw = await res.json() as { activity: Record<string, unknown> };
    return raw.activity as ReturnType<typeof this.finishProductionActivity> extends Promise<infer R> ? R : never;
  }

  async reportProductionDamage(payload: {
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
  }> {
    const res = await fetch(`${this.baseUrl}/production/activity/damage`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to report damage: ${res.status} ${text}`);
    }
    const raw = await res.json() as { report: Record<string, unknown> };
    return raw.report as ReturnType<typeof this.reportProductionDamage> extends Promise<infer R> ? R : never;
  }

  async resolveProductionDamage(damageId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/production/damage/${damageId}/resolve`, {
      method: 'PATCH',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to resolve damage: ${res.status} ${text}`);
    }
  }

  // --- User Sector Management ---

  async getUserSectors(userId: string): Promise<Array<{
    userId: string;
    sector: string;
    subSector?: string;
    assignedAt: string;
  }>> {
    const res = await fetch(`${this.baseUrl}/admin/users/${userId}/sectors`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get user sectors: ${res.status} ${text}`);
    }
    const raw = await res.json();
    // Go returns {user_id, sector, sub_sector?, created_at} (F094 — was
    // mapped from a non-existent assigned_at field).
    return (raw as Array<Record<string, unknown>>).map((s) => ({
      userId: (s.user_id as string) ?? userId,
      sector: s.sector as string,
      subSector: (s.sub_sector as string) || undefined,
      assignedAt: (s.created_at as string) ?? '',
    }));
  }

  async setUserSectors(userId: string, sectors: Array<{
    sector: string;
    subSector?: string;
  }>): Promise<void> {
    const res = await fetch(`${this.baseUrl}/admin/users/${userId}/sectors`, {
      method: 'PUT',
      headers: this.getHeaders(),
      // API contract is snake_case (F094 — subSector camelCase was silently
      // dropped by the Go decoder).
      body: JSON.stringify({
        sectors: sectors.map((s) => ({
          sector: s.sector,
          ...(s.subSector ? { sub_sector: s.subSector } : {}),
        })),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set user sectors: ${res.status} ${text}`);
    }
  }

  async getMySectors(): Promise<Array<{
    userId: string;
    sector: string;
    subSector?: string;
  }>> {
    const res = await fetch(`${this.baseUrl}/me/sectors`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get my sectors: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return (raw as Array<Record<string, unknown>>).map((s) => ({
      userId: (s.user_id as string) ?? '',
      sector: s.sector as string,
      subSector: (s.sub_sector as string) || undefined,
    }));
  }

  async getOperatorsBySector(sector: string): Promise<Array<{
    id: string;
    name: string;
    email: string;
  }>> {
    const res = await fetch(`${this.baseUrl}/production/operators?sector=${encodeURIComponent(sector)}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get operators by sector: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return (raw as Array<Record<string, unknown>>).map((u) => ({
      id: u.id as string,
      name: u.name as string,
      email: u.email as string,
    }));
  }

  // --- Compras / Almacén picking (Fase 3) ---

  async listPickingStates(): Promise<readonly ProjectPickingState[]> {
    const res = await fetch(`${this.baseUrl}/picking`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list picking states: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => pickingStateFromApi(r as Record<string, unknown>))
      .filter((p): p is ProjectPickingState => Boolean(p.projectId));
  }

  async setProjectPickingState(state: ProjectPickingState): Promise<void> {
    const res = await fetch(`${this.baseUrl}/picking`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        project_id: state.projectId,
        material: state.material,
        status: state.status,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set picking state: ${res.status} ${text}`);
    }
  }

  // --- Compras / Almacén stock (Fase 3b) ---

  async getStock(): Promise<readonly MaterialStock[]> {
    const res = await fetch(`${this.baseUrl}/stock`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get stock: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => stockFromApi(r as Record<string, unknown>))
      .filter((s): s is MaterialStock => Boolean(s.materialId));
  }

  async upsertStockMin(stock: {
    kind: StockMaterialKind;
    materialId: string;
    minStock: number;
  }): Promise<MaterialStock> {
    const res = await fetch(`${this.baseUrl}/stock`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        kind: stock.kind,
        material_id: stock.materialId,
        min_stock: stock.minStock,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set stock minimum: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return stockFromApi(raw as Record<string, unknown>);
  }

  async recordStockMovement(payload: {
    kind: StockMaterialKind;
    materialId: string;
    type: StockMovementType;
    quantity: number;
    projectId?: string;
    note?: string;
    revertsId?: string;
  }): Promise<StockMovement> {
    const res = await fetch(`${this.baseUrl}/stock/movements`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        kind: payload.kind,
        material_id: payload.materialId,
        type: payload.type,
        quantity: payload.quantity,
        project_id: payload.projectId ?? '',
        note: payload.note ?? '',
        reverts_id: payload.revertsId ?? '',
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to record stock movement: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return stockMovementFromApi(raw as Record<string, unknown>);
  }

  async listStockMovements(filter?: {
    kind?: StockMaterialKind;
    materialId?: string;
    projectId?: string;
    limit?: number;
  }): Promise<readonly StockMovement[]> {
    const params = new URLSearchParams();
    if (filter?.kind) params.set('kind', filter.kind);
    if (filter?.materialId) params.set('material_id', filter.materialId);
    if (filter?.projectId) params.set('project_id', filter.projectId);
    if (filter?.limit) params.set('limit', String(filter.limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/stock/movements${query}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list stock movements: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((m) => stockMovementFromApi(m as Record<string, unknown>))
      .filter((m): m is StockMovement => Boolean(m.id));
  }

  // --- Compras / Almacén proveedores + órdenes de compra (Fase 3c) ---

  async listSuppliers(): Promise<readonly Supplier[]> {
    const res = await fetch(`${this.baseUrl}/suppliers`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list suppliers: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => supplierFromApi(r as Record<string, unknown>))
      .filter((s): s is Supplier => Boolean(s.id));
  }

  async createSupplier(supplier: {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }): Promise<Supplier> {
    const res = await fetch(`${this.baseUrl}/suppliers`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(supplierToApi(supplier)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create supplier: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return supplierFromApi(raw as Record<string, unknown>);
  }

  async updateSupplier(supplier: {
    id: string;
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
  }): Promise<Supplier> {
    const res = await fetch(`${this.baseUrl}/suppliers/${supplier.id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(supplierToApi(supplier)),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to update supplier: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return supplierFromApi(raw as Record<string, unknown>);
  }

  async deactivateSupplier(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/suppliers/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to deactivate supplier: ${res.status} ${text}`);
    }
  }

  async listPurchaseOrders(): Promise<readonly PurchaseOrder[]> {
    const res = await fetch(`${this.baseUrl}/purchase-orders`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return [];
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list purchase orders: ${res.status} ${text}`);
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => purchaseOrderFromApi(r as Record<string, unknown>))
      .filter((p): p is PurchaseOrder => Boolean(p.id));
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
    const res = await fetch(`${this.baseUrl}/purchase-orders/${id}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      if (res.status === 404) return null;
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get purchase order: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return purchaseOrderFromApi(raw as Record<string, unknown>);
  }

  async createPurchaseOrder(po: {
    id: string;
    supplierId: string;
    notes?: string;
    requiredBy?: string;
    expectedAt?: string;
    items: readonly {
      kind: StockMaterialKind;
      materialId: string;
      quantity: number;
      unitCost?: number;
      allocatedProjectId?: string;
    }[];
  }): Promise<PurchaseOrder> {
    const res = await fetch(`${this.baseUrl}/purchase-orders`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        id: po.id,
        supplier_id: po.supplierId,
        notes: po.notes ?? '',
        ...(po.requiredBy ? { required_by: po.requiredBy } : {}),
        ...(po.expectedAt ? { expected_at: po.expectedAt } : {}),
        items: po.items.map(poItemToApi),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to create purchase order: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return purchaseOrderFromApi(raw as Record<string, unknown>);
  }

  async updatePurchaseOrder(po: {
    id: string;
    supplierId: string;
    notes?: string;
    requiredBy?: string;
    expectedAt?: string;
    items: readonly {
      kind: StockMaterialKind;
      materialId: string;
      quantity: number;
      unitCost?: number;
      allocatedProjectId?: string;
    }[];
  }): Promise<PurchaseOrder> {
    const res = await fetch(`${this.baseUrl}/purchase-orders/${po.id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({
        supplier_id: po.supplierId,
        notes: po.notes ?? '',
        ...(po.requiredBy ? { required_by: po.requiredBy } : {}),
        ...(po.expectedAt ? { expected_at: po.expectedAt } : {}),
        items: po.items.map(poItemToApi),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to update purchase order: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return purchaseOrderFromApi(raw as Record<string, unknown>);
  }

  async emitPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const res = await fetch(`${this.baseUrl}/purchase-orders/${id}/emit`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to emit purchase order: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return purchaseOrderFromApi(raw as Record<string, unknown>);
  }

  async cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
    const res = await fetch(`${this.baseUrl}/purchase-orders/${id}/cancel`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to cancel purchase order: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return purchaseOrderFromApi(raw as Record<string, unknown>);
  }

  async receivePurchaseOrder(
    id: string,
    lines: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[],
  ): Promise<PurchaseOrder> {
    const res = await fetch(`${this.baseUrl}/purchase-orders/${id}/receive`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ lines: lines.map(poItemToApi) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to receive purchase order: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return purchaseOrderFromApi(raw as Record<string, unknown>);
  }

  // ─── Material planning (OC-050..OC-054) ─────────────────────────────────────

  private parseMaterialPlanningView(raw: Record<string, unknown>): MaterialPlanningView {
    return {
      planning: materialPlanningFromApi(raw.planning) ?? null,
      coverage: materialCoverageFromApi(raw.coverage),
      availability: materialAvailabilityFromApi(raw.availability),
      releaseChecks: releaseChecksFromApi(raw.release_checks ?? raw.releaseChecks),
      releaseReady: Boolean(raw.release_ready ?? raw.releaseReady),
      released: Boolean(raw.released),
      eventsAppended: Number(raw.events_appended ?? raw.eventsAppended ?? 0) || undefined,
    };
  }

  async getMaterialPlanning(projectId: string): Promise<MaterialPlanningView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/materials`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get material planning: ${res.status} ${text}`);
    }
    return this.parseMaterialPlanningView((await res.json()) as Record<string, unknown>);
  }

  async deriveMaterialRequirements(
    projectId: string,
    lines: readonly MaterialRequirementLine[],
  ): Promise<MaterialPlanningView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/materials/derive`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        lines: lines.map((l) => ({ kind: l.kind, material_id: l.materialId, quantity: l.quantity })),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to derive requirements: ${res.status} ${text}`);
    }
    return this.parseMaterialPlanningView((await res.json()) as Record<string, unknown>);
  }

  async reserveMaterials(
    projectId: string,
    lines?: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[],
  ): Promise<MaterialPlanningView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/materials/reserve`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        lines: (lines ?? []).map((l) => ({ kind: l.kind, material_id: l.materialId, quantity: l.quantity })),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to reserve materials: ${res.status} ${text}`);
    }
    return this.parseMaterialPlanningView((await res.json()) as Record<string, unknown>);
  }

  async consumeMaterials(
    projectId: string,
    lines: readonly { kind: StockMaterialKind; materialId: string; quantity: number }[],
  ): Promise<MaterialPlanningView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/materials/consume`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        lines: lines.map((l) => ({ kind: l.kind, material_id: l.materialId, quantity: l.quantity })),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to consume materials: ${res.status} ${text}`);
    }
    return this.parseMaterialPlanningView((await res.json()) as Record<string, unknown>);
  }

  async releaseMaterials(projectId: string, overrideReason?: string): Promise<MaterialPlanningView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/materials/release`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(overrideReason ? { override_reason: overrideReason } : {}),
    });
    if (res.status === 409) {
      const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw new MaterialsReleaseGateError(
        releaseChecksFromApi(raw.release_checks ?? raw.releaseChecks),
        String(raw.error ?? 'la liberación de material requiere evidencia completa'),
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to release materials: ${res.status} ${text}`);
    }
    return this.parseMaterialPlanningView((await res.json()) as Record<string, unknown>);
  }

  // ─── Quality job (OC-060..OC-062) ────────────────────────────────────────────

  private parseQualityView(raw: Record<string, unknown>): QualityView {
    const costRaw = (raw.rework_cost ?? {}) as Record<string, unknown>;
    const gates = Array.isArray(raw.unit_gates ?? raw.unitGates)
      ? ((raw.unit_gates ?? raw.unitGates) as readonly Record<string, unknown>[])
      : [];
    return {
      quality: qualityJobFromApi(raw.quality) ?? null,
      openIssues: Number(raw.open_issues ?? raw.openIssues ?? 0),
      reworkCost: {
        materialCost: Number(costRaw.material_cost ?? costRaw.materialCost ?? 0),
        laborMinutes: Number(costRaw.labor_minutes ?? costRaw.laborMinutes ?? 0),
      },
      unitGates: gates.map((g) => {
        const gate = (g.gate ?? {}) as Record<string, unknown>;
        return {
          unitId: String(g.unit_id ?? g.unitId ?? ''),
          status: String(g.status ?? ''),
          gate: { ready: Boolean(gate.ready), overridden: Boolean(gate.overridden) },
        };
      }),
      eventsAppended: Number(raw.events_appended ?? raw.eventsAppended ?? 0) || undefined,
    };
  }

  async getQuality(projectId: string): Promise<QualityView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/quality`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get quality: ${res.status} ${text}`);
    }
    return this.parseQualityView((await res.json()) as Record<string, unknown>);
  }

  async reportQualityIssue(
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
  ): Promise<QualityView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/quality/issue`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        description: payload.description,
        category: payload.category,
        ...(payload.projectItemId ? { project_item_id: payload.projectItemId } : {}),
        ...(payload.partInstanceId ? { part_instance_id: payload.partInstanceId } : {}),
        ...(payload.moduleUnitId ? { module_unit_id: payload.moduleUnitId } : {}),
        ...(payload.station ? { station: payload.station } : {}),
        ...(payload.notes ? { notes: payload.notes } : {}),
        ...(payload.photoIds?.length ? { photo_ids: payload.photoIds } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to report quality issue: ${res.status} ${text}`);
    }
    return this.parseQualityView((await res.json()) as Record<string, unknown>);
  }

  async transitionQualityIssue(
    projectId: string,
    issueId: string,
    toStatus: QualityIssueStatus,
    notes?: string,
  ): Promise<QualityView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/quality/issue/${issueId}/transition`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ to_status: toStatus, ...(notes ? { notes } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to transition quality issue: ${res.status} ${text}`);
    }
    return this.parseQualityView((await res.json()) as Record<string, unknown>);
  }

  async recordQualityRework(
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
  ): Promise<QualityView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/quality/rework`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        issue_id: payload.issueId,
        action: payload.action,
        ...(payload.reason ? { reason: payload.reason } : {}),
        ...(payload.partInstanceId ? { part_instance_id: payload.partInstanceId } : {}),
        ...(payload.targetOperation ? { target_operation: payload.targetOperation } : {}),
        ...(payload.materialCost !== undefined ? { material_cost: payload.materialCost } : {}),
        ...(payload.laborMinutes !== undefined ? { labor_minutes: payload.laborMinutes } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to record rework: ${res.status} ${text}`);
    }
    return this.parseQualityView((await res.json()) as Record<string, unknown>);
  }

  async recordQualityUnitQc(
    projectId: string,
    unitId: string,
    checklist: readonly UnitQcChecklistItem[],
    notes?: string,
  ): Promise<QualityView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/quality/qc/${unitId}`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        checklist: checklist.map((c) => ({ code: c.code, passed: c.passed })),
        ...(notes ? { notes } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to record unit QC: ${res.status} ${text}`);
    }
    return this.parseQualityView((await res.json()) as Record<string, unknown>);
  }

  async overrideQualityUnitQc(projectId: string, unitId: string, reason: string): Promise<QualityView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/quality/qc/${unitId}/override`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to override unit QC: ${res.status} ${text}`);
    }
    return this.parseQualityView((await res.json()) as Record<string, unknown>);
  }

  private parseJobCostingView(raw: Record<string, unknown>): JobCostingView {
    return {
      costing: jobCostingFromApi(raw.costing) ?? null,
      summary: jobCostSummaryFromApi(raw.summary),
      material: materialCostValuationFromApi(raw.material),
      eventsAppended: Number(raw.events_appended ?? raw.eventsAppended ?? 0) || undefined,
    };
  }

  async getJobCosting(projectId: string): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to get job costing: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }

  async captureCostBaseline(projectId: string): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing/baseline`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to capture cost baseline: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }

  async setCostingLaborRate(projectId: string, ratePerHour: number): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing/labor-rate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ rate_per_hour: ratePerHour }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to set labor rate: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }

  async recordCostingTime(
    projectId: string,
    payload: { category: TimeEntry['category']; minutes: number; note?: string },
  ): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing/time`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        category: payload.category,
        minutes: payload.minutes,
        ...(payload.note ? { note: payload.note } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to record costing time: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }

  async voidCostingTime(projectId: string, entryId: string, reason?: string): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing/time/${entryId}/void`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to void costing time: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }

  async recordCostingOtherCost(
    projectId: string,
    payload: { kind: OtherActualCost['kind']; amount: number; vendor?: string; note?: string },
  ): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing/other`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        kind: payload.kind,
        amount: payload.amount,
        ...(payload.vendor ? { vendor: payload.vendor } : {}),
        ...(payload.note ? { note: payload.note } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to record other cost: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }

  async voidCostingOtherCost(projectId: string, costId: string, reason?: string): Promise<JobCostingView> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/costing/other/${costId}/void`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to void other cost: ${res.status} ${text}`);
    }
    return this.parseJobCostingView((await res.json()) as Record<string, unknown>);
  }
}



/**
 * Reports whether a response indicates a duplicate/conflict — i.e. the entity
 * already exists, so an upsert has nothing to do. Matches the backend's two
 * shapes: HTTP 409 Conflict, and the legacy 400 "ya está registrado" message
 * some handlers emitted before the 409 unification.
 */
function isConflict(status: number, body: string): boolean {
  if (status === 409) return true;
  if (status === 400 && /ya est.a registrado|already registered|already exists/i.test(body)) {
    return true;
  }
  return false;
}
