import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// Fixture de paridad TS↔Go (OC-004): backend-go/internal/domain/rbac_test.go
// afirma contra el mismo contracts/roles.json, así que una divergencia de
// roles rompe CI en algún lado (docs/architecture.md §7).
import rolesContract from '../../../contracts/roles.json';
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
  roleCanAccessEngineeringDashboard,
  roleCanAccessSalesDashboard,
  roleIsScopedBySector,
  roleCanAccessFabricNav,
  roleCanAccessShippingNav,
  roleCanAccessEmbarquesNav,
  sectorsAllowedForRole,
  roleCanAdvanceStation,
  PRODUCT_ROLES,
  USER_ROLES,
  roleCanAccessPurchasingNav,
  roleCanAccessWarehouseDashboard,
  roleCanMarkPicking,
  roleCanManagePurchasing,
  roleCanAppendProjectEvent,
} from './rbac';

describe('rbac (F035 / OC-004)', () => {
  it('matches the shared roles contract and rejects legacy labels', () => {
    const { canonicalRoles, rejectedRoles } = rolesContract;

    expect(USER_ROLES).toEqual(canonicalRoles);
    expect(PRODUCT_ROLES).toEqual(canonicalRoles);

    for (const r of canonicalRoles) {
      expect(isValidUserRole(r)).toBe(true);
    }

    for (const r of rejectedRoles) {
      expect(isValidUserRole(r)).toBe(false);
    }
  });

  it('offers friendly labels for every canonical role (UI single source)', () => {
    for (const r of rolesContract.canonicalRoles) {
      expect(roleLabelEs(r)).not.toBe(r);
      expect(roleLabelEs(r).length).toBeGreaterThan(0);
    }
    for (const r of rolesContract.rejectedRoles) {
      // rejected ids render as-is (raw), never as a curated label
      expect(roleLabelEs(r)).toBe(r);
    }
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
    expect(navIdsForRole('produccion').has('quotes')).toBe(true);
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
    expect(navIdsForRole('vendedor').has('orders')).toBe(false);
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
    expect(navIdsForRole('ingeniero').has('finishes')).toBe(true);
    expect(navIdsForRole('admin').has('finishes')).toBe(true);
    expect(navIdsForRole('vendedor').has('finishes')).toBe(false);
    expect(navIdsForRole('gerente_ventas').has('finishes')).toBe(false);
    expect(navIdsForRole('produccion').has('finishes')).toBe(false);
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
    expect(navIdsForRole('produccion').has('orders')).toBe(true);
    expect(navIdsForRole('admin').has('orders')).toBe(true);
    expect(navIdsForRole('ingeniero').has('orders')).toBe(true);
    expect(navIdsForRole('gerente_ventas').has('orders')).toBe(true);
    expect(navIdsForRole('vendedor').has('orders')).toBe(false);
    // Guest (local mode): does NOT get production nav.
    expect(navIdsForRole(null).has('orders')).toBe(false);
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

  it('almacen never sees costs, even with the flag on (parity pin TS↔Go, F094)', () => {
    expect(roleCanViewCosts('almacen')).toBe(false);
    expect(
      roleCanViewCosts('almacen', { vendedorCanViewCosts: true }),
    ).toBe(false);
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
    expect(navIdsForRole('almacen').has('orders')).toBe(false);
    expect(navIdsForRole('almacen').has('production')).toBe(true);
    // The plant operator keeps the hub and gains the fabric queue.
    expect(navIdsForRole('produccion').has('orders')).toBe(true);
    expect(navIdsForRole('produccion').has('production')).toBe(true);
    // Fase 4.4 — supervisors work the full floor too (all tabs + metrics);
    // commercial roles have no personal fabric queue.
    expect(navIdsForRole('admin').has('production')).toBe(true);
    expect(navIdsForRole('gerente_produccion').has('production')).toBe(true);
    expect(navIdsForRole('vendedor').has('production')).toBe(false);
  });

  it('Fase 4.4 — roleCanAccessFabricNav: scoped operators + supervisors', () => {
    expect(roleCanAccessFabricNav('produccion')).toBe(true);
    expect(roleCanAccessFabricNav('almacen')).toBe(true);
    expect(roleCanAccessFabricNav('admin')).toBe(true);
    expect(roleCanAccessFabricNav('gerente_produccion')).toBe(true);
    expect(roleCanAccessFabricNav('gerente_ventas')).toBe(false);
    expect(roleCanAccessFabricNav('vendedor')).toBe(false);
    expect(roleCanAccessFabricNav('ingeniero')).toBe(false);
    expect(roleCanAccessFabricNav(null)).toBe(false);
  });

  it('Embarques — roleCanAccessEmbarquesNav: admin + gerente + almacen', () => {
    expect(roleCanAccessEmbarquesNav('admin')).toBe(true);
    expect(roleCanAccessEmbarquesNav('gerente_produccion')).toBe(true);
    expect(roleCanAccessEmbarquesNav('almacen')).toBe(true);
    expect(roleCanAccessEmbarquesNav('produccion')).toBe(false);
    expect(roleCanAccessEmbarquesNav('vendedor')).toBe(false);
    expect(roleCanAccessEmbarquesNav(null)).toBe(false);
    expect(navIdsForRole('almacen').has('shipments')).toBe(true);
    expect(navIdsForRole('produccion').has('shipments')).toBe(false);
  });

  it('Instalaciones — roleCanAccessShippingNav: floor + supervisors (not almacen)', () => {
    expect(roleCanAccessShippingNav('admin')).toBe(true);
    expect(roleCanAccessShippingNav('gerente_produccion')).toBe(true);
    expect(roleCanAccessShippingNav('produccion')).toBe(true);
    expect(roleCanAccessShippingNav('almacen')).toBe(false);
    expect(roleCanAccessShippingNav('vendedor')).toBe(false);
    expect(roleCanAccessShippingNav(null)).toBe(false);
    expect(navIdsForRole('gerente_produccion').has('installations')).toBe(true);
    expect(navIdsForRole('vendedor').has('installations')).toBe(false);
    expect(navIdsForRole('almacen').has('installations')).toBe(false);
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

    expect(navIdsForRole('admin').has('warehouse')).toBe(true);
    expect(navIdsForRole('gerente_produccion').has('warehouse')).toBe(true);
    expect(navIdsForRole('almacen').has('warehouse')).toBe(true);
    expect(navIdsForRole('ingeniero').has('warehouse')).toBe(false);
    expect(navIdsForRole('gerente_ventas').has('warehouse')).toBe(false);
    expect(navIdsForRole('vendedor').has('warehouse')).toBe(false);
    expect(navIdsForRole('produccion').has('warehouse')).toBe(false);
    expect(navIdsForRole(null).has('warehouse')).toBe(false);
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

  it('roleCanAccessEngineeringDashboard gates access to admin, ingeniero, gerente_produccion', () => {
    expect(roleCanAccessEngineeringDashboard('admin')).toBe(true);
    expect(roleCanAccessEngineeringDashboard('ingeniero')).toBe(true);
    expect(roleCanAccessEngineeringDashboard('gerente_produccion')).toBe(true);
    expect(roleCanAccessEngineeringDashboard('gerente_ventas')).toBe(false);
    expect(roleCanAccessEngineeringDashboard('vendedor')).toBe(false);
    expect(roleCanAccessEngineeringDashboard('produccion')).toBe(false);
    expect(roleCanAccessEngineeringDashboard('almacen')).toBe(false);
    expect(roleCanAccessEngineeringDashboard('user')).toBe(false);
    expect(roleCanAccessEngineeringDashboard(null)).toBe(false);

    expect(navIdsForRole('ingeniero').has('engineeringDashboard')).toBe(true);
    expect(navIdsForRole('admin').has('engineeringDashboard')).toBe(true);
    expect(navIdsForRole('gerente_produccion').has('engineeringDashboard')).toBe(true);
    expect(navIdsForRole('vendedor').has('engineeringDashboard')).toBe(false);
  });

  it('roleCanAccessWarehouseDashboard gates access to admin, almacen, gerente_produccion', () => {
    expect(roleCanAccessWarehouseDashboard('admin')).toBe(true);
    expect(roleCanAccessWarehouseDashboard('almacen')).toBe(true);
    expect(roleCanAccessWarehouseDashboard('gerente_produccion')).toBe(true);
    expect(roleCanAccessWarehouseDashboard('ingeniero')).toBe(false);
    expect(roleCanAccessWarehouseDashboard('gerente_ventas')).toBe(false);
    expect(roleCanAccessWarehouseDashboard('vendedor')).toBe(false);
    expect(roleCanAccessWarehouseDashboard('produccion')).toBe(false);
    expect(roleCanAccessWarehouseDashboard('user')).toBe(false);
    expect(roleCanAccessWarehouseDashboard(null)).toBe(false);

    expect(navIdsForRole('almacen').has('warehouseDashboard')).toBe(true);
    expect(navIdsForRole('admin').has('warehouseDashboard')).toBe(true);
    expect(navIdsForRole('gerente_produccion').has('warehouseDashboard')).toBe(true);
    expect(navIdsForRole('vendedor').has('warehouseDashboard')).toBe(false);
  });

  // Mirror de backend-go/internal/domain/rbac_test.go
  // (TestRoleCanAppendProjectEvent): cualquier divergencia rompe CI en algún lado.
  it('roleCanAppendProjectEvent gates the lifecycle audit log by role and event type (OC-010..OC-024)', () => {
    // Comercial posee su pipeline + anticipo real.
    expect(roleCanAppendProjectEvent('vendedor', 'quote_won')).toBe(true);
    expect(roleCanAppendProjectEvent('vendedor', 'deposit_received')).toBe(true);
    expect(roleCanAppendProjectEvent('vendedor', 'customer_approved')).toBe(true);
    // Pero NO los gates técnicos ni decisiones con impacto de precio/plazo.
    expect(roleCanAppendProjectEvent('vendedor', 'production_released')).toBe(false);
    expect(roleCanAppendProjectEvent('vendedor', 'change_order_approved')).toBe(false);

    // El gate de liberación es de ingeniería/supervisión de planta.
    expect(roleCanAppendProjectEvent('ingeniero', 'production_released')).toBe(true);
    expect(roleCanAppendProjectEvent('gerente_produccion', 'production_released')).toBe(true);
    expect(roleCanAppendProjectEvent('produccion', 'production_released')).toBe(false);

    // Cada carril decide su aprobación (OC-021).
    expect(roleCanAppendProjectEvent('ingeniero', 'engineering_approved')).toBe(true);
    expect(roleCanAppendProjectEvent('gerente_produccion', 'engineering_approved')).toBe(true);
    expect(roleCanAppendProjectEvent('vendedor', 'engineering_approved')).toBe(false);

    // Hitos físicos por dueño operativo.
    expect(roleCanAppendProjectEvent('produccion', 'production_started')).toBe(true);
    expect(roleCanAppendProjectEvent('almacen', 'materials_ready')).toBe(true);
    expect(roleCanAppendProjectEvent('almacen', 'project_closed')).toBe(false);

    // Decisiones de CO: gerentes/admin.
    expect(roleCanAppendProjectEvent('gerente_ventas', 'change_order_approved')).toBe(true);
    expect(roleCanAppendProjectEvent('gerente_produccion', 'change_order_approved')).toBe(true);

    // Admin todo; user nada; tipos inventados jamás.
    expect(roleCanAppendProjectEvent('admin', 'project_closed')).toBe(true);
    expect(roleCanAppendProjectEvent('user', 'quote_won')).toBe(false);
    expect(roleCanAppendProjectEvent('admin', 'pizza_delivered')).toBe(false);
    expect(roleCanAppendProjectEvent(null, 'quote_won')).toBe(false);
  });
});

// DoD del onboarding de pilotos (F174): quien sigue docs/pilot-onboarding.md
// jamás intenta asignar un rol que la aplicación rechaza. El doc debe listar
// todos los roles canónicos (con backticks, como identificadores) y nunca
// presentar un rol rechazado como asignable.
describe('pilot onboarding doc pins canonical roles', () => {
  const doc = readFileSync(
    new URL('../../../docs/pilot-onboarding.md', import.meta.url),
    'utf8',
  );

  it('documents every canonical role as assignable', () => {
    for (const r of rolesContract.canonicalRoles) {
      expect(doc).toContain(`\`${r}\``);
    }
  });

  it('never offers a rejected role as assignable', () => {
    for (const r of rolesContract.rejectedRoles) {
      expect(doc).not.toContain(`\`${r}\``);
    }
  });
});
