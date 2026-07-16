import { describe, expect, it } from 'vitest';
import {
  NAV_PATHS,
  entityIdFromPath,
  entityPath,
  isEntitySection,
  moduleIdFromPath,
  navFromPath,
  pathForNav,
  projectIdFromPath,
  projectPath,
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
});
