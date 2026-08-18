import { describe, expect, it } from 'vitest';
import {
  isValidUserRole,
  navIdsForRole,
  roleCanAccessCustomers,
  roleCanAccessProjects,
  roleCanDeleteProject,
  canExportProductionForProject,
  projectAllowsProductionExport,
  roleCanExportProduction,
  roleCanMarkProduced,
  roleCanMutateCatalog,
  roleCanMutateModules,
  roleCanMutateProjects,
  roleCanReopenProject,
  roleCanViewCosts,
  roleCanViewPortfolioDashboard,
  roleLabelEs,
  roleUsesProductionQueue,
  roleCanClaimProductionJob,
  roleCanAccessProductionDashboard,
  roleCanAccessSalesDashboard,
  roleIsScopedBySector,
  sectorsAllowedForRole,
  roleCanAdvanceStation,
  roleCanAccessPurchasingNav,
  roleCanMarkPicking,
  roleCanManagePurchasing,
} from './rbac';

describe('rbac (F035)', () => {
  it('accepts product roles and rejects legacy labels', () => {
    expect(isValidUserRole('ingeniero')).toBe(true);
    expect(isValidUserRole('gerente_ventas')).toBe(true);
    expect(isValidUserRole('produccion')).toBe(true);
    expect(isValidUserRole('disenador')).toBe(false);
    expect(isValidUserRole('carpintero')).toBe(false);
  });

  it('denies catalog ABM to vendedor and produccion', () => {
    expect(roleCanMutateCatalog('vendedor')).toBe(false);
    expect(roleCanMutateCatalog('produccion')).toBe(false);
    expect(roleCanMutateCatalog('ingeniero')).toBe(true);
    expect(roleCanMutateModules('vendedor')).toBe(false);
    expect(roleCanMutateModules('ingeniero')).toBe(true);
  });

  it('denies project delete to vendedor', () => {
    expect(roleCanDeleteProject('vendedor')).toBe(false);
    expect(roleCanDeleteProject('gerente_ventas')).toBe(true);
    expect(roleCanMutateProjects('vendedor')).toBe(true);
  });

  it('denies production export to vendedor', () => {
    expect(roleCanExportProduction('vendedor')).toBe(false);
    expect(roleCanExportProduction('produccion')).toBe(true);
    expect(roleCanExportProduction('ingeniero')).toBe(true);
  });

  it('ingeniero exports production only on accepted/produced (F041)', () => {
    expect(projectAllowsProductionExport('accepted')).toBe(true);
    expect(projectAllowsProductionExport('produced')).toBe(true);
    expect(projectAllowsProductionExport('draft')).toBe(false);
    expect(projectAllowsProductionExport('quoted')).toBe(false);
    expect(canExportProductionForProject('ingeniero', 'accepted')).toBe(true);
    expect(canExportProductionForProject('ingeniero', 'produced')).toBe(true);
    expect(canExportProductionForProject('ingeniero', 'draft')).toBe(false);
    expect(canExportProductionForProject('vendedor', 'accepted')).toBe(false);
  });

  it('hides CRM from produccion', () => {
    expect(roleCanAccessCustomers('produccion')).toBe(false);
    expect(navIdsForRole('produccion').has('customers')).toBe(false);
    expect(navIdsForRole('produccion').has('projects')).toBe(true);
  });

  it('F093 — Estado de Planta visible to every role (incl. vendedor/user)', () => {
    for (const role of [
      'vendedor',
      'gerente_ventas',
      'ingeniero',
      'produccion',
      'admin',
      'user',
    ]) {
      expect(navIdsForRole(role).has('plantBoard')).toBe(true);
    }
    expect(navIdsForRole(null).has('plantBoard')).toBe(true);
    // The production hub itself stays gated for export roles only.
    expect(navIdsForRole('vendedor').has('production')).toBe(false);
  });

  it('Ingeniería Muebles/Estructuras/Componentes vs Trabajo Vitrina', () => {
    expect(navIdsForRole('ingeniero').has('structures')).toBe(true);
    expect(navIdsForRole('admin').has('structures')).toBe(true);
    expect(navIdsForRole('vendedor').has('structures')).toBe(false);
    expect(navIdsForRole('produccion').has('structures')).toBe(false);
    expect(navIdsForRole(null).has('structures')).toBe(true);
    expect(navIdsForRole(null).has('components')).toBe(true);
    expect(navIdsForRole('ingeniero').has('components')).toBe(true);
    expect(navIdsForRole('vendedor').has('components')).toBe(false);
    expect(navIdsForRole('ingeniero').has('modules')).toBe(true);
    expect(navIdsForRole('vendedor').has('modules')).toBe(false);
    expect(navIdsForRole('ingeniero').has('ambientMaterials')).toBe(true);
    expect(navIdsForRole('admin').has('ambientMaterials')).toBe(true);
    expect(navIdsForRole('vendedor').has('ambientMaterials')).toBe(false);
    expect(navIdsForRole('gerente_ventas').has('ambientMaterials')).toBe(false);
    expect(navIdsForRole('produccion').has('ambientMaterials')).toBe(false);
    expect(navIdsForRole('vendedor').has('showcase')).toBe(true);
    expect(navIdsForRole('ingeniero').has('showcase')).toBe(true);
    expect(navIdsForRole('produccion').has('showcase')).toBe(false);
  });

  it('labels roles in Spanish de taller', () => {
    expect(roleLabelEs('gerente_ventas')).toBe('Gerente de ventas');
    expect(roleLabelEs('user')).toBe('Sin puesto');
  });

  it('reopen and mark produced permissions (F036)', () => {
    expect(roleCanReopenProject('gerente_ventas')).toBe(true);
    expect(roleCanReopenProject('vendedor')).toBe(true); // quoted→draft only (status gate)
    expect(roleCanReopenProject('produccion')).toBe(false);
    expect(roleCanMarkProduced('produccion')).toBe(true);
    expect(roleCanMarkProduced('ingeniero')).toBe(true);
    expect(roleCanMarkProduced('vendedor')).toBe(false);
  });

  it('portfolio dashboard is gerente/admin only (F037)', () => {
    expect(roleCanViewPortfolioDashboard('gerente_ventas')).toBe(true);
    expect(roleCanViewPortfolioDashboard('admin')).toBe(true);
    expect(roleCanViewPortfolioDashboard('vendedor')).toBe(false);
    expect(roleCanViewPortfolioDashboard('produccion')).toBe(false);
  });

  it('production queue filter remains produccion only (F038)', () => {
    expect(roleUsesProductionQueue('produccion')).toBe(true);
    expect(roleUsesProductionQueue('vendedor')).toBe(false);
    expect(roleUsesProductionQueue('ingeniero')).toBe(false);
  });

  it('production nav is for production-export roles (PROD-0.1)', () => {
    // Factory workspace nav (queue + OP hub) — not the plant-only project filter.
    expect(navIdsForRole('produccion').has('production')).toBe(true);
    expect(navIdsForRole('admin').has('production')).toBe(true);
    expect(navIdsForRole('ingeniero').has('production')).toBe(true);
    expect(navIdsForRole('gerente_ventas').has('production')).toBe(true);
    expect(navIdsForRole('vendedor').has('production')).toBe(false);
    // Guest (local mode): does NOT get production nav.
    expect(navIdsForRole(null).has('production')).toBe(false);
    expect(navIdsForRole('produccion').has('home')).toBe(true);
  });

  it('vendedor cannot view costs; admin/ingeniero can (F039)', () => {
    expect(roleCanViewCosts('vendedor')).toBe(false);
    expect(roleCanViewCosts('user')).toBe(false);
    expect(roleCanViewCosts('admin')).toBe(true);
    expect(roleCanViewCosts('ingeniero')).toBe(true);
    expect(roleCanViewCosts('gerente_ventas')).toBe(true);
    expect(roleCanViewCosts(null)).toBe(true);
  });

  it('vendedor sees costs only when workshop flag is on (F044 / COST-02)', () => {
    expect(roleCanViewCosts('vendedor', { vendedorCanViewCosts: false })).toBe(
      false,
    );
    expect(roleCanViewCosts('vendedor', { vendedorCanViewCosts: true })).toBe(
      true,
    );
    expect(roleCanViewCosts('user', { vendedorCanViewCosts: true })).toBe(true);
    // Flag must not restrict roles that already see costs.
    expect(roleCanViewCosts('ingeniero', { vendedorCanViewCosts: false })).toBe(
      true,
    );
    expect(roleCanViewCosts('admin', { vendedorCanViewCosts: false })).toBe(
      true,
    );
  });

  it('gerente_produccion role is valid and has production access', () => {
    expect(isValidUserRole('gerente_produccion')).toBe(true);
    expect(roleCanAccessProjects('gerente_produccion')).toBe(true);
    expect(roleCanExportProduction('gerente_produccion')).toBe(true);
    expect(roleCanMarkProduced('gerente_produccion')).toBe(true);
    expect(roleUsesProductionQueue('gerente_produccion')).toBe(true);
    expect(roleCanViewCosts('gerente_produccion')).toBe(true);
    expect(roleCanViewPortfolioDashboard('gerente_produccion')).toBe(true);
    expect(roleLabelEs('gerente_produccion')).toBe('Gerente de producción');
  });

  it('gerente_produccion has production dashboard access', () => {
    expect(navIdsForRole('gerente_produccion').has('productionDashboard')).toBe(true);
    expect(navIdsForRole('admin').has('productionDashboard')).toBe(true);
    expect(navIdsForRole('produccion').has('productionDashboard')).toBe(true);
    expect(navIdsForRole('gerente_ventas').has('productionDashboard')).toBe(false);
  });

  it('sales dashboard access for vendedor, gerente_ventas, and admin', () => {
    expect(roleCanAccessSalesDashboard('vendedor')).toBe(true);
    expect(roleCanAccessSalesDashboard('gerente_ventas')).toBe(true);
    expect(roleCanAccessSalesDashboard('admin')).toBe(true);
    expect(roleCanAccessSalesDashboard('ingeniero')).toBe(false);
    expect(roleCanAccessSalesDashboard('produccion')).toBe(false);
    expect(navIdsForRole('vendedor').has('salesDashboard')).toBe(true);
    expect(navIdsForRole('gerente_ventas').has('salesDashboard')).toBe(true);
    expect(navIdsForRole('admin').has('salesDashboard')).toBe(true);
    expect(navIdsForRole('ingeniero').has('salesDashboard')).toBe(false);
  });

  it('almacen role is valid and can claim production jobs', () => {
    expect(isValidUserRole('almacen')).toBe(true);
    expect(roleCanClaimProductionJob('almacen')).toBe(false);
    expect(roleCanClaimProductionJob('produccion')).toBe(true);
    expect(roleCanClaimProductionJob('admin')).toBe(true);
    expect(roleCanClaimProductionJob('vendedor')).toBe(false);
    expect(roleLabelEs('almacen')).toBe('Almacén');
    expect(roleIsScopedBySector('almacen')).toBe(true);
    expect(roleIsScopedBySector('produccion')).toBe(true);
    expect(roleIsScopedBySector('vendedor')).toBe(false);
  });

  it('F094 — function separation: almacen stays out of the factory hub', () => {
    // Warehouse works from Fábrica (staging + assigned sectors), not
    // from the production workspace: no exports, no mark-produced.
    expect(roleCanMarkProduced('almacen')).toBe(false);
    expect(roleCanExportProduction('almacen')).toBe(false);
    expect(navIdsForRole('almacen').has('production')).toBe(false);
    expect(navIdsForRole('almacen').has('fabric')).toBe(true);
    // The plant operator keeps the hub and gains the fabric queue.
    expect(navIdsForRole('produccion').has('production')).toBe(true);
    expect(navIdsForRole('produccion').has('fabric')).toBe(true);
    // Supervisors and commercial roles have no personal fabric queue.
    expect(navIdsForRole('admin').has('fabric')).toBe(false);
    expect(navIdsForRole('gerente_produccion').has('fabric')).toBe(false);
    expect(navIdsForRole('vendedor').has('fabric')).toBe(false);
  });

  it('F094 — roleCanAdvanceStation scopes operators to their sectors', () => {
    // Supervisors: full pipeline.
    expect(roleCanAdvanceStation('admin', 'loaded')).toBe(true);
    expect(roleCanAdvanceStation('gerente_produccion', 'installed')).toBe(true);
    expect(roleCanAdvanceStation('gerente_ventas', 'packaged')).toBe(true);
    expect(roleCanAdvanceStation('ingeniero', 'cut')).toBe(true);

    // produccion without assignments: legacy full access.
    expect(roleCanAdvanceStation('produccion', 'edged', [])).toBe(true);
    expect(roleCanAdvanceStation('produccion', 'edged', null)).toBe(true);

    // produccion assigned to cutting only.
    const cutter = roleCanAdvanceStation('produccion', 'cut', ['cutting']);
    expect(cutter).toBe(true);
    expect(roleCanAdvanceStation('produccion', 'edged', ['cutting'])).toBe(false);
    expect(roleCanAdvanceStation('produccion', 'loaded', ['cutting', 'shipping'])).toBe(true);

    // almacen: NEVER unrestricted — only explicitly assigned sectors.
    expect(roleCanAdvanceStation('almacen', 'cut', [])).toBe(false);
    expect(roleCanAdvanceStation('almacen', 'loaded', ['shipping'])).toBe(true);
    expect(roleCanAdvanceStation('almacen', 'cut', ['shipping'])).toBe(false);

    // Nobody advances into 'pending' (it is the queue, not a station output).
    expect(roleCanAdvanceStation('admin', 'pending')).toBe(false);
    expect(roleCanAdvanceStation('produccion', 'pending', ['cutting'])).toBe(false);

    // Commercial roles and users: no floor advancement at all.
    expect(roleCanAdvanceStation('vendedor', 'cut', ['cutting'])).toBe(false);
    expect(roleCanAdvanceStation('user', 'cut', ['cutting'])).toBe(false);
    expect(roleCanAdvanceStation(null, 'cut', ['cutting'])).toBe(false);
  });

  it('engineering nav is for ingeniero and admin only', () => {
    expect(navIdsForRole('ingeniero').has('engineering')).toBe(true);
    expect(navIdsForRole('admin').has('engineering')).toBe(true);
    expect(navIdsForRole('vendedor').has('engineering')).toBe(false);
    expect(navIdsForRole('produccion').has('engineering')).toBe(false);
    expect(navIdsForRole(null).has('engineering')).toBe(false);
  });

  it('Fase 3 — purchasing nav is for admin, gerente_produccion and almacen', () => {
    expect(roleCanAccessPurchasingNav('admin')).toBe(true);
    expect(roleCanAccessPurchasingNav('gerente_produccion')).toBe(true);
    expect(roleCanAccessPurchasingNav('almacen')).toBe(true);
    expect(roleCanAccessPurchasingNav('ingeniero')).toBe(false);
    expect(roleCanAccessPurchasingNav('gerente_ventas')).toBe(false);
    expect(roleCanAccessPurchasingNav('vendedor')).toBe(false);
    expect(roleCanAccessPurchasingNav('produccion')).toBe(false);
    expect(roleCanAccessPurchasingNav('user')).toBe(false);
    // Guest (local mode) keeps the hardcoded full-tool list without the
    // auth-only workspace navs (same as engineering / production).
    expect(roleCanAccessPurchasingNav(null)).toBe(false);

    expect(navIdsForRole('admin').has('purchasing')).toBe(true);
    expect(navIdsForRole('gerente_produccion').has('purchasing')).toBe(true);
    expect(navIdsForRole('almacen').has('purchasing')).toBe(true);
    expect(navIdsForRole('ingeniero').has('purchasing')).toBe(false);
    expect(navIdsForRole('gerente_ventas').has('purchasing')).toBe(false);
    expect(navIdsForRole('vendedor').has('purchasing')).toBe(false);
    expect(navIdsForRole('produccion').has('purchasing')).toBe(false);
    expect(navIdsForRole(null).has('purchasing')).toBe(false);
  });

  it('Fase 3 — roleCanMarkPicking: admin/almacen write, gerente read-only', () => {
    expect(roleCanMarkPicking('admin')).toBe(true);
    expect(roleCanMarkPicking('almacen')).toBe(true);
    expect(roleCanMarkPicking('gerente_produccion')).toBe(false);
    expect(roleCanMarkPicking('ingeniero')).toBe(false);
    expect(roleCanMarkPicking('produccion')).toBe(false);
    expect(roleCanMarkPicking('vendedor')).toBe(false);
    expect(roleCanMarkPicking('user')).toBe(false);
    // Guest / local mode persists locally.
    expect(roleCanMarkPicking(null)).toBe(false);
  });

  it('Fase 3c — roleCanManagePurchasing: admin/almacen write, gerente read-only', () => {
    expect(roleCanManagePurchasing('admin')).toBe(true);
    expect(roleCanManagePurchasing('almacen')).toBe(true);
    expect(roleCanManagePurchasing('gerente_produccion')).toBe(false);
    expect(roleCanManagePurchasing('ingeniero')).toBe(false);
    expect(roleCanManagePurchasing('produccion')).toBe(false);
    expect(roleCanManagePurchasing('vendedor')).toBe(false);
    expect(roleCanManagePurchasing('user')).toBe(false);
    expect(roleCanManagePurchasing(null)).toBe(false);
  });

  it('F094 — sectorsAllowedForRole binds sectors to roles', () => {
    // produccion: all 11 sectors (full floor + material types)
    const prodSectors = sectorsAllowedForRole('produccion');
    expect(prodSectors).toContain('warehouse');
    expect(prodSectors).toContain('cutting');
    expect(prodSectors).toContain('cnc');
    expect(prodSectors).toContain('edge_banding');
    expect(prodSectors).toContain('assembly');
    expect(prodSectors).toContain('packaging');
    expect(prodSectors).toContain('shipping');
    expect(prodSectors).toContain('installation');
    expect(prodSectors).toContain('herrajes');
    expect(prodSectors).toContain('tableros');
    expect(prodSectors).toContain('cintillas');
    expect(prodSectors).toHaveLength(11);

    // almacen: 3 material sectors (first-class, no sub-sector nesting)
    const almacenSectors = sectorsAllowedForRole('almacen');
    expect(almacenSectors).toEqual(['herrajes', 'tableros', 'cintillas']);

    // Supervisors: empty (they manage via role, not sector membership)
    expect(sectorsAllowedForRole('admin')).toEqual([]);
    expect(sectorsAllowedForRole('gerente_produccion')).toEqual([]);
    expect(sectorsAllowedForRole('gerente_ventas')).toEqual([]);
    expect(sectorsAllowedForRole('ingeniero')).toEqual([]);
    expect(sectorsAllowedForRole('vendedor')).toEqual([]);
    expect(sectorsAllowedForRole('user')).toEqual([]);
    expect(sectorsAllowedForRole(null)).toEqual([]);
  });
});
