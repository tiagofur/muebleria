import { describe, expect, it } from 'vitest';
import {
  isValidUserRole,
  navIdsForRole,
  roleCanAccessCustomers,
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

  it('F049/H06: structures + components nav only for ingeniero/admin (not vendedor)', () => {
    expect(navIdsForRole('ingeniero').has('structures')).toBe(true);
    expect(navIdsForRole('admin').has('structures')).toBe(true);
    expect(navIdsForRole('vendedor').has('structures')).toBe(false);
    expect(navIdsForRole('vendedor').has('showcase')).toBe(true);
    expect(navIdsForRole('vendedor').has('modules')).toBe(false);
    expect(navIdsForRole('ingeniero').has('showcase')).toBe(true);
    expect(navIdsForRole('ingeniero').has('modules')).toBe(true);
    expect(navIdsForRole('produccion').has('structures')).toBe(false);
    expect(navIdsForRole(null).has('structures')).toBe(true);
    expect(navIdsForRole('ingeniero').has('components')).toBe(true);
    expect(navIdsForRole('admin').has('components')).toBe(true);
    expect(navIdsForRole('vendedor').has('components')).toBe(false);
    expect(navIdsForRole(null).has('components')).toBe(true);
  });

  it('labels roles in Spanish de taller', () => {
    expect(roleLabelEs('gerente_ventas')).toBe('Gerente de ventas');
    expect(roleLabelEs('user')).toBe('Sin puesto');
  });

  it('reopen and mark produced permissions (F036)', () => {
    expect(roleCanReopenProject('gerente_ventas')).toBe(true);
    expect(roleCanReopenProject('vendedor')).toBe(false);
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

  it('production queue home is produccion only (F038)', () => {
    expect(roleUsesProductionQueue('produccion')).toBe(true);
    expect(roleUsesProductionQueue('vendedor')).toBe(false);
    expect(roleUsesProductionQueue('ingeniero')).toBe(false);
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
});
