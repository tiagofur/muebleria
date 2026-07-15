import { describe, expect, it } from 'vitest';
import {
  filterActiveForPicker,
  filterCatalogItems,
  findActiveCodeConflict,
  matchesCodeOrName,
  normalizeCode,
  validateNonNegativeNumber,
  validateRequiredName,
  validateUniqueCode,
} from './catalogHelpers';

const items = [
  { id: '1', code: 'TAB-ARA-BLA', name: 'Arauco Blanco', active: true },
  { id: '2', code: 'TAB-MAD-FRE', name: 'Madera Fresa', active: true },
  { id: '3', code: 'TAB-OLD', name: 'Viejo', active: false },
] as const;

describe('normalizeCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeCode('  tab-ara-bla  ')).toBe('TAB-ARA-BLA');
  });
});

describe('findActiveCodeConflict / validateUniqueCode (CAT-04)', () => {
  it('detects conflict among active items (case-insensitive)', () => {
    const conflict = findActiveCodeConflict('tab-ara-bla', items);
    expect(conflict?.id).toBe('1');
  });

  it('ignores inactive items with same code', () => {
    expect(findActiveCodeConflict('TAB-OLD', items)).toBeUndefined();
    expect(validateUniqueCode('TAB-OLD', items)).toBeNull();
  });

  it('allows same code when editing the same id', () => {
    expect(findActiveCodeConflict('TAB-ARA-BLA', items, '1')).toBeUndefined();
    expect(validateUniqueCode('TAB-ARA-BLA', items, '1')).toBeNull();
  });

  it('returns Spanish error for duplicate active code', () => {
    const err = validateUniqueCode('TAB-MAD-FRE', items);
    expect(err).toMatch(/Ya existe un ítem activo/);
    expect(err).toMatch(/TAB-MAD-FRE/);
  });

  it('rejects empty code', () => {
    expect(validateUniqueCode('   ', items)).toBe('El código es obligatorio.');
  });
});

describe('filterCatalogItems / filterActiveForPicker (CAT-05)', () => {
  it('hides inactive by default in lists', () => {
    const visible = filterCatalogItems(items);
    expect(visible.map((i) => i.id)).toEqual(['1', '2']);
  });

  it('shows inactive when toggled', () => {
    const visible = filterCatalogItems(items, { showInactive: true });
    expect(visible).toHaveLength(3);
  });

  it('status chips: all / active / inactive', () => {
    expect(filterCatalogItems(items, { status: 'all' })).toHaveLength(3);
    expect(filterCatalogItems(items, { status: 'active' }).map((i) => i.id)).toEqual(
      ['1', '2'],
    );
    expect(
      filterCatalogItems(items, { status: 'inactive' }).map((i) => i.id),
    ).toEqual(['3']);
  });

  it('filters by query against code and name', () => {
    const byCode = filterCatalogItems(items, {
      status: 'all',
      query: 'ara',
    });
    expect(byCode.map((i) => i.id)).toEqual(['1']);

    const byName = filterCatalogItems(items, {
      status: 'all',
      query: 'fresa',
    });
    expect(byName.map((i) => i.id)).toEqual(['2']);
  });

  it('matchesCodeOrName is case-insensitive', () => {
    expect(matchesCodeOrName({ code: 'TAB-X', name: 'Blanco' }, 'bla')).toBe(
      true,
    );
    expect(matchesCodeOrName({ code: 'TAB-X', name: 'Blanco' }, 'zzz')).toBe(
      false,
    );
  });

  it('picker excludes inactive by default', () => {
    const options = filterActiveForPicker(items);
    expect(options.every((i) => i.active)).toBe(true);
    expect(options).toHaveLength(2);
  });

  it('picker can include inactive when requested', () => {
    expect(filterActiveForPicker(items, { includeInactive: true })).toHaveLength(
      3,
    );
  });
});

describe('field validators', () => {
  it('requires name', () => {
    expect(validateRequiredName('')).toBe('El nombre es obligatorio.');
    expect(validateRequiredName('  OK  ')).toBeNull();
  });

  it('rejects negative numbers', () => {
    expect(validateNonNegativeNumber(-1, 'Costo')).toMatch(/Costo/);
    expect(validateNonNegativeNumber(0, 'Costo')).toBeNull();
  });

  it('rejects negative wastePercent (Merma)', () => {
    expect(validateNonNegativeNumber(-5, 'Merma')).toMatch(/Merma/);
    expect(validateNonNegativeNumber(0, 'Merma')).toBeNull();
    expect(validateNonNegativeNumber(10, 'Merma')).toBeNull();
  });
});
