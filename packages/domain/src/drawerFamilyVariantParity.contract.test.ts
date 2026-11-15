import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  effectiveVariantLabel,
  validateAgregadoDrawerSystem,
  validateAgregadoVariantSet,
  type AgregadoDrawerSystem,
  type AgregadoVariantSet,
  type ProductVariant,
} from './agregadoAssembly';

// #1633: paridad TS↔Go de la familia de cajón (etiqueta de altura como dato,
// letra Blum deducida sólo para variantes previas, marcador drawerSystem).
// Autoridad única: contracts/fixtures/drawerFamilyVariantParity.contract.json.
// Espejo Go: backend-go/internal/domain/drawer_family_variant_parity_test.go.

interface DrawerFamilyFixture {
  effectiveLabel: { name: string; variant: ProductVariant; expected: string }[];
  variantSets: { name: string; variantSet: AgregadoVariantSet; valid: boolean; errorContains?: string }[];
  drawerSystems: { name: string; drawerSystem: AgregadoDrawerSystem; valid: boolean; errorContains?: string }[];
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/drawerFamilyVariantParity.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as DrawerFamilyFixture;

describe('#1633 drawer family variant parity', () => {
  it.each(f.effectiveLabel)('effectiveVariantLabel: $name', ({ variant, expected }) => {
    expect(effectiveVariantLabel(variant)).toBe(expected);
  });

  it.each(f.variantSets)('validateAgregadoVariantSet: $name', ({ variantSet, valid, errorContains }) => {
    if (valid) {
      expect(() => validateAgregadoVariantSet(variantSet)).not.toThrow();
    } else {
      expect(() => validateAgregadoVariantSet(variantSet)).toThrow(errorContains);
    }
  });

  it.each(f.drawerSystems)('validateAgregadoDrawerSystem: $name', ({ drawerSystem, valid, errorContains }) => {
    if (valid) {
      expect(() => validateAgregadoDrawerSystem(drawerSystem)).not.toThrow();
    } else {
      expect(() => validateAgregadoDrawerSystem(drawerSystem)).toThrow(errorContains);
    }
  });
});
