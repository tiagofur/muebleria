/**
 * Local-first adapter: single workspace JSON file with atomic write (PER-01, NFR-03).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  Catalog,
  Project,
  ProjectTemplate,
  Workspace,
  WorkshopSettings,
} from '@granete/domain';

import { createSeedWorkspace } from './seed';
import { migrateWorkspace } from './migrateWorkspace';
import type { WorkspaceRepository } from './workspaceRepository';

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

/**
 * File-backed workspace repository.
 * Save path: write `{filePath}.tmp` then rename over target (atomic on same volume).
 */
export class JSONFileStorage implements WorkspaceRepository {
  constructor(private readonly filePath: string) {}

  async load(): Promise<Workspace> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      return migrateWorkspace(JSON.parse(raw) as Workspace);
    } catch (error) {
      if (isNotFoundError(error)) {
        return createSeedWorkspace();
      }
      throw error;
    }
  }

  async save(workspace: Workspace): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp`;
    const payload = `${JSON.stringify(workspace, null, 2)}\n`;
    await writeFile(tmpPath, payload, 'utf8');
    await rename(tmpPath, this.filePath);
  }

  async getCatalog(): Promise<Catalog> {
    const workspace = await this.load();
    return workspace.catalog;
  }

  async saveCatalog(catalog: Catalog): Promise<void> {
    const workspace = await this.load();
    await this.save({ ...workspace, catalog });
  }

  async saveWorkshopSettings(settings: WorkshopSettings): Promise<void> {
    const workspace = await this.load();
    await this.save({ ...workspace, settings });
  }

  async getProjects(): Promise<readonly Project[]> {
    const workspace = await this.load();
    return workspace.projects;
  }

  async createProject(project: Project): Promise<void> {
    return this.saveProject(project);
  }

  async saveProject(project: Project): Promise<void> {
    const workspace = await this.load();
    const index = workspace.projects.findIndex((p) => p.id === project.id);
    const projects =
      index === -1
        ? [...workspace.projects, project]
        : workspace.projects.map((p, i) => (i === index ? project : p));
    await this.save({ ...workspace, projects });
  }

  async deleteProject(projectId: string): Promise<void> {
    const workspace = await this.load();
    await this.save({
      ...workspace,
      projects: workspace.projects.filter((p) => p.id !== projectId),
    });
  }

  // --- Project templates (#110 / H15) ---

  async getProjectTemplates(): Promise<readonly ProjectTemplate[]> {
    const workspace = await this.load();
    return workspace.projectTemplates ?? [];
  }

  async createProjectTemplate(template: ProjectTemplate): Promise<void> {
    return this.saveProjectTemplate(template);
  }

  async saveProjectTemplate(template: ProjectTemplate): Promise<void> {
    const workspace = await this.load();
    const current = workspace.projectTemplates ?? [];
    const index = current.findIndex((t) => t.id === template.id);
    const next =
      index === -1
        ? [...current, template]
        : current.map((t, i) => (i === index ? template : t));
    await this.save({ ...workspace, projectTemplates: next });
  }

  async deleteProjectTemplate(templateId: string): Promise<void> {
    const workspace = await this.load();
    const current = workspace.projectTemplates ?? [];
    await this.save({
      ...workspace,
      projectTemplates: current.filter((t) => t.id !== templateId),
    });
  }
}
