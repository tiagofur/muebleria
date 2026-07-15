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
  });

  it('uses design tokens in users.css (no hardcoded hex)', () => {
    const css = readFileSync(join(here, 'users.css'), 'utf8');
    expect(css).toContain('var(--surface-card)');
    expect(css).toContain('var(--warning-');
    expect(css).toContain('var(--success-');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
