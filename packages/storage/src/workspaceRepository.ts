/**
 * Storage port — UI and shells depend on this interface only (API-ready).
 */

import type { Catalog, Project, ProjectTemplate, Workspace } from '@muebles/domain';

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
}
