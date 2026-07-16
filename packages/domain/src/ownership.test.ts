import { describe, expect, it } from 'vitest';
import {
  canAccessOwnedResource,
  resolveOwnerOnCreate,
  resolveOwnerOnUpdate,
  roleCanAssignOwner,
  roleSeesAllOwners,
} from './ownership';

describe('ownership (F034)', () => {
  it('scopes only vendedor', () => {
    expect(roleSeesAllOwners('vendedor')).toBe(false);
    expect(roleSeesAllOwners('admin')).toBe(true);
    expect(roleCanAssignOwner('admin')).toBe(true);
    expect(roleCanAssignOwner('vendedor')).toBe(false);
  });

  it('forces vendedor owner on create', () => {
    expect(resolveOwnerOnCreate('me', 'vendedor', 'other')).toBe('me');
    expect(resolveOwnerOnCreate('admin', 'admin', 'v2')).toBe('v2');
    expect(resolveOwnerOnCreate('admin', 'admin', '')).toBe('admin');
  });

  it('blocks vendedor reassignment on update', () => {
    expect(resolveOwnerOnUpdate('vendedor', 'me', 'other')).toBe('me');
    expect(resolveOwnerOnUpdate('admin', 'old', 'new')).toBe('new');
  });

  it('access checks', () => {
    expect(canAccessOwnedResource('a', 'admin', 'b')).toBe(true);
    expect(canAccessOwnedResource('a', 'vendedor', 'a')).toBe(true);
    expect(canAccessOwnedResource('a', 'vendedor', 'b')).toBe(false);
  });
});
