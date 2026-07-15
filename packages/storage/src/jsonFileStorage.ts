/**
 * Local-first adapter: single workspace JSON file with atomic write (PER-01, NFR-03).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Catalog, Project, Workspace } from '@muebles/domain';

import { createSeedWorkspace } from './seed';
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
      return JSON.parse(raw) as Workspace;
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

  async getProjects(): Promise<readonly Project[]> {
    const workspace = await this.load();
    return workspace.projects;
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
}
