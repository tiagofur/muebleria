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
  navBlockedForSession,
  isNewEntityEditPath,
  moduleEditIdFromPath,
  moduleEditPath,
  moduleIdFromPath,
  navFromPath,
  pathForNav,
  productionOrderFromPath,
  productionOrderPath,
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
    expect(navFromPath('/quotes')).toBe('quotes');
    expect(navFromPath('/option-groups')).toBe('optionGroups');
    expect(navFromPath('/users')).toBe('users');
    expect(navFromPath('/settings')).toBe('settings');
  });

  it('resolves entity deep links for all id-bearing sections', () => {
    const id = '969f82ae-8da6-45d0-b49a-951dbfde309e';
    const sections = [
      'quotes',
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

    expect(projectPath(id)).toBe(`/quotes/${id}`);
    expect(projectIdFromPath(`/quotes/${id}`)).toBe(id);
    expect(moduleIdFromPath(`/modules/${id}`)).toBe(id);
    expect(entityIdFromPath('/quotes', 'quotes')).toBeNull();
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

  it('resolves production order deep links (PROD-0.1)', () => {
    const id = '969f82ae-8da6-45d0-b49a-951dbfde309e';
    expect(navFromPath('/orders')).toBe('orders');
    expect(navFromPath(`/orders/${id}`)).toBe('orders');
    expect(navFromPath(`/orders/${id}/cutlist`)).toBe('orders');
    expect(productionOrderPath(id)).toBe(`/orders/${id}`);
    expect(productionOrderPath(id, 'resumen')).toBe(`/orders/${id}`);
    expect(productionOrderPath(id, 'documentos')).toBe(
      `/orders/${id}/documents`,
    );
    expect(productionOrderFromPath('/orders')).toBeNull();
    expect(productionOrderFromPath(`/orders/${id}`)).toEqual({
      projectId: id,
      tab: 'resumen',
    });
    expect(productionOrderFromPath(`/orders/${id}/views`)).toEqual({
      projectId: id,
      tab: 'vistas',
    });
    expect(productionOrderFromPath(`/orders/${id}/dispatch`)).toBeNull();
    expect(productionOrderFromPath(`/orders/${id}/labels`)).toEqual({
      projectId: id,
      tab: 'etiquetas',
    });
    expect(productionOrderPath(id, 'etiquetas')).toBe(
      `/orders/${id}/labels`,
    );
    // Legacy Spanish slugs no longer parse.
    expect(productionOrderFromPath(`/orders/${id}/despacho`)).toBeNull();
    expect(productionOrderFromPath(`/orders/${id}/nope`)).toBeNull();
  });
});

describe('plant board route (F093)', () => {
  it('maps /plant-board to the plantBoard nav and back', () => {
    expect(NAV_PATHS.plantBoard).toBe('/plant-board');
    expect(pathForNav('plantBoard')).toBe('/plant-board');
    expect(navFromPath('/plant-board')).toBe('plantBoard');
  });

  it('keeps plantBoard out of entity deep-link sections', () => {
    expect(isEntitySection('plantBoard')).toBe(false);
  });

  it('maps /shipments to the embarques nav (despacho + instalación board)', () => {
    expect(NAV_PATHS.shipments).toBe('/shipments');
    expect(pathForNav('shipments')).toBe('/shipments');
    expect(navFromPath('/shipments')).toBe('shipments');
    expect(isEntitySection('shipments')).toBe(false);
  });

  it('maps /installations to the instalaciones nav (cargado → instalado)', () => {
    expect(NAV_PATHS.installations).toBe('/installations');
    expect(pathForNav('installations')).toBe('/installations');
    expect(navFromPath('/installations')).toBe('installations');
    expect(isEntitySection('installations')).toBe(false);
  });

  it('maps remaining nav ids to English paths', () => {
    expect(NAV_PATHS.production).toBe('/production');
    expect(NAV_PATHS.productionDashboard).toBe('/production-dashboard');
    expect(NAV_PATHS.salesDashboard).toBe('/sales-dashboard');
    expect(NAV_PATHS.engineeringDashboard).toBe('/engineering-dashboard');
    expect(NAV_PATHS.engineering).toBe('/engineering');
    expect(NAV_PATHS.warehouseDashboard).toBe('/warehouse-dashboard');
    expect(NAV_PATHS.warehouse).toBe('/warehouse');
    expect(NAV_PATHS.finishes).toBe('/finishes');
    expect(NAV_PATHS.addOns).toBe('/add-ons');
    expect(navFromPath('/production')).toBe('production');
    expect(navFromPath('/production-dashboard')).toBe('productionDashboard');
    expect(navFromPath('/sales-dashboard')).toBe('salesDashboard');
    expect(navFromPath('/engineering-dashboard')).toBe('engineeringDashboard');
    expect(navFromPath('/engineering')).toBe('engineering');
    expect(navFromPath('/warehouse-dashboard')).toBe('warehouseDashboard');
    expect(navFromPath('/warehouse')).toBe('warehouse');
    expect(navFromPath('/finishes')).toBe('finishes');
    expect(navFromPath('/add-ons')).toBe('addOns');
    expect(entityIdFromPath('/finishes/x', 'finishes')).toBe(
      'x',
    );
  });

  describe('navBlockedForSession (deep-link guard, design.md §4.1)', () => {
    it('guest deep links to /orders bounce to home instead of an empty main', () => {
      expect(navBlockedForSession('guest', null, 'orders')).toBe(true);
      expect(navBlockedForSession('guest', null, 'production')).toBe(true);
      expect(navBlockedForSession('guest', null, 'warehouse')).toBe(true);
    });

    it('guest keeps local-mode sections (quotes, materials, settings)', () => {
      expect(navBlockedForSession('guest', null, 'quotes')).toBe(false);
      expect(navBlockedForSession('guest', null, 'materials')).toBe(false);
      expect(navBlockedForSession('guest', null, 'settings')).toBe(false);
    });

    it('auth blocks by role and the guest role set does not leak in', () => {
      expect(navBlockedForSession('auth', 'vendedor', 'orders')).toBe(true);
      expect(navBlockedForSession('auth', 'produccion', 'orders')).toBe(false);
      // A null role under auth is blocked everywhere except home-ish basics.
      expect(navBlockedForSession('auth', null, 'orders')).toBe(true);
    });
  });
});
