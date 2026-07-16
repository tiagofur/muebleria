import type { Catalog, Project, Workspace, WorkshopSettings } from '@muebles/domain';
import {
  DEFAULT_WORKSHOP_SETTINGS,
  withWorkshopSettings,
} from '@muebles/domain';
import type { WorkspaceRepository } from './workspaceRepository';
import {
  catalogFromApi,
  categoryToApi,
  customerToApi,
  edgeToApi,
  hardwareToApi,
  materialToApi,
  moduleToApi,
  structureToApi,
  optionGroupToApi,
  projectFromApi,
  projectToApi,
  sortCategoriesForSave,
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
    return withWorkshopSettings({
      schemaVersion: SCHEMA_VERSION,
      catalog,
      projects,
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
    ] = await Promise.all([
      fetchJson('/catalog/materials'),
      fetchJson('/catalog/edges'),
      fetchJson('/catalog/hardware'),
      fetchJson('/catalog/option-groups'),
      fetchJson('/catalog/modules'),
      fetchJson('/customers'),
      fetchJson('/catalog/categories'),
      fetchJson('/catalog/structures').catch(() => []),
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
      console.error(`API upsert failed ${pathById}: ${res?.status} ${putBody}`);
      return;
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
          console.error(
            `API create failed ${pathCollection}: ${created.status} ${text}`,
          );
        }
      }
    } catch (err) {
      console.error(`API create error ${pathCollection}:`, err);
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

