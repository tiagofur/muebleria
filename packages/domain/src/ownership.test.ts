import { describe, expect, it } from 'vitest';
import {
  canAccessOwnedResource,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  roleCanAssignOwner,
  roleSeesAllOwners,
} from './ownership';

describe('ownership (F034 + F035)', () => {
  it('scopes only portfolio roles', () => {
    expect(roleSeesAllOwners('vendedor')).toBe(false);
    expect(roleSeesAllOwners('user')).toBe(false);
    expect(roleSeesAllOwners('admin')).toBe(true);
    expect(roleSeesAllOwners('gerente_ventas')).toBe(true);
    expect(roleCanAssignOwner('admin')).toBe(true);
    expect(roleCanAssignOwner('gerente_ventas')).toBe(true);
    expect(roleCanAssignOwner('vendedor')).toBe(false);
  });

  it('forces vendedor owner on create', () => {
    expect(resolveOwnerOnCreate('me', 'vendedor', 'other')).toBe('me');
    expect(resolveOwnerOnCreate('admin', 'admin', 'v2')).toBe('v2');
    expect(resolveOwnerOnCreate('g1', 'gerente_ventas', 'v2')).toBe('v2');
    expect(resolveOwnerOnCreate('admin', 'admin', '')).toBe('admin');
  });

  it('blocks vendedor reassignment on update', () => {
    expect(resolveOwnerOnUpdate('vendedor', 'me', 'other')).toBe('me');
    expect(resolveOwnerOnUpdate('admin', 'old', 'new')).toBe('new');
    expect(resolveOwnerOnUpdate('gerente_ventas', 'old', 'new')).toBe('new');
  });

  it('access checks', () => {
    expect(canAccessOwnedResource('a', 'admin', 'b')).toBe(true);
    expect(canAccessOwnedResource('a', 'vendedor', 'a')).toBe(true);
    expect(canAccessOwnedResource('a', 'vendedor', 'b')).toBe(false);
  });
});
