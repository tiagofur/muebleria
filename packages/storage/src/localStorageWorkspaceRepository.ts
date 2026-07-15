/**
 * LocalStorage implementation of WorkspaceRepository for Guest mode.
 */

import type { Catalog, Project, Workspace } from '@muebles/domain';
import type { WorkspaceRepository } from './workspaceRepository';
import { createSeedWorkspace } from './seed';

const LOCAL_STORAGE_KEY = 'muebles_guest_workspace';

export class LocalStorageWorkspaceRepository implements WorkspaceRepository {
  private getWorkspace(): Workspace {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return createSeedWorkspace();
    }
    try {
      const raw = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as Workspace;
      }
    } catch {
      // ignore
    }
    return createSeedWorkspace();
  }

  private saveWorkspace(ws: Workspace): void {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) return;
    try {
      globalThis.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(ws));
    } catch {
      // ignore
    }
  }

  async load(): Promise<Workspace> {
    return this.getWorkspace();
  }

  async save(workspace: Workspace): Promise<void> {
    this.saveWorkspace(workspace);
  }

  async getCatalog(): Promise<Catalog> {
    return this.getWorkspace().catalog;
  }

  async saveCatalog(catalog: Catalog): Promise<void> {
    const ws = this.getWorkspace();
    this.saveWorkspace({
      ...ws,
      catalog,
    });
  }

  async getProjects(): Promise<readonly Project[]> {
    return this.getWorkspace().projects;
  }

  async saveProject(project: Project): Promise<void> {
    const ws = this.getWorkspace();
    const exists = ws.projects.some((p) => p.id === project.id);
    const projects = exists
      ? ws.projects.map((p) => (p.id === project.id ? project : p))
      : [...ws.projects, project];
    this.saveWorkspace({
      ...ws,
      projects,
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const ws = this.getWorkspace();
    this.saveWorkspace({
      ...ws,
      projects: ws.projects.filter((p) => p.id !== projectId),
    });
  }
}
