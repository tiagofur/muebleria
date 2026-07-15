/**
 * Storage port — UI and shells depend on this interface only (API-ready).
 */

import type { Catalog, Project, Workspace } from '@muebles/domain';

export interface WorkspaceRepository {
  /** Load full workspace; missing file → seed workspace. */
  load(): Promise<Workspace>;

  /** Persist full workspace (atomic on file adapters). */
  save(workspace: Workspace): Promise<void>;

  getCatalog(): Promise<Catalog>;
  saveCatalog(catalog: Catalog): Promise<void>;

  getProjects(): Promise<readonly Project[]>;
  saveProject(project: Project): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}
