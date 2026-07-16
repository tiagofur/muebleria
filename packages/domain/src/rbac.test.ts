import { describe, expect, it } from 'vitest';
import {
  isValidUserRole,
  navIdsForRole,
  roleCanAccessCustomers,
  roleCanDeleteProject,
  roleCanExportProduction,
  roleCanMarkProduced,
  roleCanMutateCatalog,
  roleCanMutateModules,
  roleCanMutateProjects,
  roleCanReopenProject,
  roleCanViewPortfolioDashboard,
  roleLabelEs,
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

  it('hides CRM from produccion', () => {
    expect(roleCanAccessCustomers('produccion')).toBe(false);
    expect(navIdsForRole('produccion').has('customers')).toBe(false);
    expect(navIdsForRole('produccion').has('projects')).toBe(true);
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
});
