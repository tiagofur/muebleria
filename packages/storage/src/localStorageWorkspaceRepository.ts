/**
 * LocalStorage implementation of WorkspaceRepository for Guest mode.
 */

import type {
  Catalog,
  Project,
  ProjectTemplate,
  Workspace,
  ItemFloorStatus,
  FloorStatusEvent,
  LoadingProgress,
} from '@muebles/domain';
import {
  withWorkshopSettings,
  advanceFloorStatus,
  appendFloorEvent,
  calculateLoadingProgress,
  nextItemFloorStatus,
  normalizeItemFloorStatus,
} from '@muebles/domain';
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
        return withWorkshopSettings(JSON.parse(raw) as Workspace);
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

  async createProject(project: Project): Promise<void> {
    return this.saveProject(project);
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

  // --- Project templates (#110 / H15) ---

  async getProjectTemplates(): Promise<readonly ProjectTemplate[]> {
    return this.getWorkspace().projectTemplates ?? [];
  }

  async createProjectTemplate(template: ProjectTemplate): Promise<void> {
    return this.saveProjectTemplate(template);
  }

  async saveProjectTemplate(template: ProjectTemplate): Promise<void> {
    const ws = this.getWorkspace();
    const current = ws.projectTemplates ?? [];
    const exists = current.some((t) => t.id === template.id);
    const projectTemplates = exists
      ? current.map((t) => (t.id === template.id ? template : t))
      : [...current, template];
    this.saveWorkspace({ ...ws, projectTemplates });
  }

  async deleteProjectTemplate(templateId: string): Promise<void> {
    const ws = this.getWorkspace();
    this.saveWorkspace({
      ...ws,
      projectTemplates: (ws.projectTemplates ?? []).filter(
        (t) => t.id !== templateId,
      ),
    });
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
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Obra no encontrada');

    const item = payload.itemId
      ? project.items.find((it) => it.id === payload.itemId)
      : project.items[0];
    if (!item) throw new Error('Item no encontrado');

    const before = normalizeItemFloorStatus(item.floorStatus);
    // Floor-scan contract keeps arbitrary targets (dispatch module labels):
    // allowJump preserves behavior while the event records the skip (F092).
    const advance = advanceFloorStatus({
      projectId: project.id,
      itemId: item.id,
      current: before,
      target: payload.targetStatus,
      advance: payload.advance,
      allowJump: true,
      source: 'scan',
    });
    const after = advance.ok ? advance.status : before;
    const event = advance.ok ? advance.event : null;

    const updatedItems = project.items.map((it) =>
      it.id === item.id ? { ...it, floorStatus: after } : it,
    );
    let updatedProject: Project = { ...project, items: updatedItems };
    if (event) updatedProject = appendFloorEvent(updatedProject, event);
    const updatedWs = {
      ...ws,
      projects: ws.projects.map((p) => (p.id === projectId ? updatedProject : p)),
    };
    this.saveWorkspace(updatedWs);

    const progress = calculateLoadingProgress(updatedProject);
    const mod = ws.catalog.modules.find((m) => m.id === item.moduleId);

    return {
      projectId: project.id,
      projectName: project.name,
      itemId: item.id,
      factoryCode: mod?.code ?? item.moduleId,
      moduleCode: mod?.code ?? item.moduleId,
      moduleName: mod?.name ?? '',
      statusBefore: before,
      statusAfter: after,
      nextStatus: nextItemFloorStatus(after) ?? '',
      loadingProgress: progress,
      event,
    };
  }

  async getProjectLoadingStatus(projectId: string): Promise<{
    projectId: string;
    projectName: string;
    loadingProgress: LoadingProgress;
  }> {
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Obra no encontrada');
    return {
      projectId: project.id,
      projectName: project.name,
      loadingProgress: calculateLoadingProgress(project),
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
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Obra no encontrada');
    const item = project.items.find((it) => it.id === itemId);
    if (!item) throw new Error('Item no encontrado');

    const currentStatus = normalizeItemFloorStatus(item.floorStatus);
    // Arbitrary select (Modules tab) stays supported; jumps get audited.
    const advance = advanceFloorStatus({
      projectId,
      itemId,
      current: currentStatus,
      target: status,
      advance: !status,
      allowJump: true,
      source: 'manual',
    });
    const resolvedStatus = advance.ok ? advance.status : currentStatus;
    const event = advance.ok ? advance.event : null;

    const updatedItems = project.items.map((it) =>
      it.id === itemId ? { ...it, floorStatus: resolvedStatus } : it,
    );
    let updatedProject: Project = { ...project, items: updatedItems };
    if (event) updatedProject = appendFloorEvent(updatedProject, event);
    this.saveWorkspace({
      ...ws,
      projects: ws.projects.map((p) => (p.id === projectId ? updatedProject : p)),
    });

    return {
      projectId,
      itemId,
      floorStatus: resolvedStatus,
      nextStatus: nextItemFloorStatus(resolvedStatus) ?? '',
      event,
    };
  }

  async listFloorEvents(
    projectId: string,
  ): Promise<readonly FloorStatusEvent[]> {
    const ws = this.getWorkspace();
    const project = ws.projects.find((p) => p.id === projectId);
    return project?.floorEvents ?? [];
  }
}
