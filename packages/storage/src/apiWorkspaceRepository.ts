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
  Workspace,
  WorkshopSettings,
} from '@muebles/domain';
import {
  DEFAULT_WORKSHOP_SETTINGS,
  withWorkshopSettings,
} from '@muebles/domain';
import type { WorkspaceRepository } from './workspaceRepository';
import {
  agregadoToApi,
  ambientCategoryToApi,
  ambientMaterialToApi,
  catalogFromApi,
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
} from './apiMappers';



import { SCHEMA_VERSION } from './seed';

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
   * Conflict handling: a 409 (or 400 with a duplicate-key message) from either
   * PUT or POST means the entity already exists — the upsert's goal is met, so
   * it returns silently instead of logging an error. This keeps the console
   * clean when React re-invokes saves (StrictMode double-fire, re-renders) or
   * when demo/seed data overlaps existing rows.
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
    // Already exists → upsert goal met, nothing more to do.
    if (res && isConflict(res.status, putBody)) return;

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
        // Conflict on POST = already created concurrently → treat as success.
        if (!isConflict(created.status, text)) {
          const msg = `API create failed ${pathCollection}: ${created.status} ${text}`;
          console.error(msg);
          throw new Error(msg);
        }
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
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to update technical workflow: ${res.status} ${text}`);
    }
    const raw = await res.json();
    return projectFromApi(raw as Record<string, unknown>);
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

