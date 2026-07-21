import { describe, expect, it } from 'vitest';
import {
  NAV_PATHS,
  componentEditIdFromPath,
  componentEditPath,
  entityIdFromPath,
  entityEditIdFromPath,
  entityPath,
  isEntityEditPath,
  isEntitySection,
  isNewEntityEditPath,
  moduleEditIdFromPath,
  moduleEditPath,
  moduleIdFromPath,
  navFromPath,
  pathForNav,
  projectIdFromPath,
  projectPath,
  structureEditIdFromPath,
  structureEditPath,
  NEW_ENTITY_ID,
} from './routes';

describe('app routes', () => {
  it('maps every nav id to a path starting with /', () => {
    for (const id of Object.keys(NAV_PATHS) as (keyof typeof NAV_PATHS)[]) {
      expect(pathForNav(id).startsWith('/')).toBe(true);
    }
  });

  it('round-trips section paths', () => {
    expect(navFromPath('/')).toBe('home');
    expect(navFromPath('/home')).toBe('home');
    expect(navFromPath('/materials')).toBe('materials');
    expect(navFromPath('/projects')).toBe('projects');
    expect(navFromPath('/option-groups')).toBe('optionGroups');
    expect(navFromPath('/users')).toBe('users');
    expect(navFromPath('/settings')).toBe('settings');
  });

  it('resolves entity deep links for all id-bearing sections', () => {
    const id = '969f82ae-8da6-45d0-b49a-951dbfde309e';
    const sections = [
      'projects',
      'modules',
      'materials',
      'edges',
      'hardware',
      'optionGroups',
      'customers',
    ] as const;

    for (const section of sections) {
      expect(isEntitySection(section)).toBe(true);
      const path = entityPath(section, id);
      expect(path).toContain(id);
      expect(entityIdFromPath(path, section)).toBe(id);
      expect(navFromPath(path)).toBe(section);
    }

    expect(projectPath(id)).toBe(`/projects/${id}`);
    expect(projectIdFromPath(`/projects/${id}`)).toBe(id);
    expect(moduleIdFromPath(`/modules/${id}`)).toBe(id);
    expect(entityIdFromPath('/projects', 'projects')).toBeNull();
  });

  it('home and users are not entity-detail sections', () => {
    expect(isEntitySection('home')).toBe(false);
    expect(isEntitySection('users')).toBe(false);
  });

  it('returns null for unknown paths', () => {
    expect(navFromPath('/nope')).toBeNull();
    expect(navFromPath('/api/projects')).toBeNull();
  });

  it('extracts entity id from /section/:id/edit paths (Fase 3 UI)', () => {
    const id = '969f82ae-8da6-45d0-b49a-951dbfde309e';
    expect(moduleEditPath(id)).toBe(`/modules/${id}/edit`);
    expect(structureEditPath(id)).toBe(`/structures/${id}/edit`);
    expect(componentEditPath('comp-1')).toBe(`/components/comp-1/edit`);

    expect(moduleEditIdFromPath(`/modules/${id}/edit`)).toBe(id);
    expect(structureEditIdFromPath(`/structures/${id}/edit`)).toBe(id);
    expect(componentEditIdFromPath(`/components/${id}/edit`)).toBe(id);

    // /edit is also a valid module nav (still resolves to 'modules')
    expect(navFromPath(`/modules/${id}/edit`)).toBe('modules');

    // Plain view path is NOT an edit path
    expect(isEntityEditPath(`/modules/${id}`, 'modules')).toBe(false);
    expect(isEntityEditPath(`/modules/${id}/edit`, 'modules')).toBe(true);
    expect(entityIdFromPath(`/modules/${id}/edit`, 'modules')).toBeNull();
  });

  it('detects new-entity edit paths (/section/new/edit)', () => {
    expect(isNewEntityEditPath('/modules/new/edit', 'modules')).toBe(true);
    expect(isNewEntityEditPath('/modules/some-id/edit', 'modules')).toBe(false);
    expect(moduleEditIdFromPath('/modules/new/edit')).toBe(NEW_ENTITY_ID);
  });
});
