// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

describe('UsersScreen (F026 admin approval)', () => {
  it('calls admin users endpoints for list/approve/role/reject', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('/admin/users');
    expect(src).toContain('/approve');
    expect(src).toContain('/role');
    expect(src).toContain("method: 'PUT'");
    expect(src).toContain("method: 'DELETE'");
    expect(src).toContain("'user'");
    expect(src).toContain("'admin'");
    expect(src).toContain("'gerente_ventas'");
    expect(src).toContain("'ingeniero'");
    expect(src).toContain("'produccion'");
    expect(src).not.toContain("'disenador'");
    expect(src).not.toContain("'carpintero'");
  });

  it('uses design tokens in users.css (no hardcoded hex)', () => {
    const css = readFileSync(join(here, 'users.css'), 'utf8');
    expect(css).toContain('var(--surface-card)');
    // badge colors now live in common/statusBadge.css (semantic vocabulary)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('renders roles as neutral meta-chip, not semantic badge (§5.2)', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('meta-chip');
    expect(src).not.toContain('users-role-badge');
    // users.css no longer defines the local role badge family
    const css = readFileSync(join(here, 'users.css'), 'utf8');
    expect(css).not.toContain('.users-role-badge');
  });

  it('uses PageLoading for async list load (issue #30)', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('PageLoading');
    expect(src).toContain('users-loading');
    expect(src).not.toMatch(/style=\{\{[^}]*textAlign/);
  });
});

describe('UsersScreen (F166 license management)', () => {
  it('exposes per-user license plan and expiry through the admin endpoint', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('/license');
    expect(src).toContain('license_plan');
    expect(src).toContain('license_expires_at');
    expect(src).toContain("'none'");
    expect(src).toContain("'trial'");
    expect(src).toContain("'pro'");
    expect(src).toContain('Vencimiento');
  });

  it('derives license status client-side without claiming server authority', () => {
    const src = readFileSync(join(here, 'UsersScreen.tsx'), 'utf8');
    expect(src).toContain('licenseStatus');
    expect(src).toContain('Activa');
    expect(src).toContain('Vencida');
  });
});
