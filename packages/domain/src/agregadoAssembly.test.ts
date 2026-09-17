import { describe, expect, it } from 'vitest';
import {
  type AgregadoRigidMember,
  type AgregadoVariantSet,
  AssemblyVariantNotFoundError,
  validateAgregadoRigidMember,
  validateAgregadoVariantSet,
  validateAssemblyAnchorRule,
  validateRigidMemberSource,
} from './agregadoAssembly';

describe('Agregado Hardware Assembly Contracts & Validators', () => {
  describe('validateRigidMemberSource', () => {
    it('accepts valid fixed source', () => {
      expect(() =>
        validateRigidMemberSource({
          kind: 'fixed',
          fixed: { hardwareId: 'hw-runner-fixed' },
        }),
      ).not.toThrow();
    });

    it('rejects fixed source with missing hardwareId', () => {
      expect(() =>
        validateRigidMemberSource({
          kind: 'fixed',
          fixed: { hardwareId: '' },
        }),
      ).toThrow(/fixed source requires non-empty hardwareId/);
    });

    it('rejects fixed source containing variant payload', () => {
      expect(() =>
        validateRigidMemberSource({
          kind: 'fixed',
          fixed: { hardwareId: 'hw-1' },
          variant: { variantSetId: 'vs-1' },
        }),
      ).toThrow(/fixed source must not contain variant payload/);
    });

    it('accepts valid variant source', () => {
      expect(() =>
        validateRigidMemberSource({
          kind: 'variant',
          variant: { variantSetId: 'vs-depth' },
        }),
      ).not.toThrow();
    });

    it('rejects variant source with missing variantSetId', () => {
      expect(() =>
        validateRigidMemberSource({
          kind: 'variant',
          variant: { variantSetId: '   ' },
        }),
      ).toThrow(/variant source requires non-empty variantSetId/);
    });

    it('rejects variant source containing fixed payload', () => {
      expect(() =>
        validateRigidMemberSource({
          kind: 'variant',
          variant: { variantSetId: 'vs-1' },
          fixed: { hardwareId: 'hw-1' },
        }),
      ).toThrow(/variant source must not contain fixed payload/);
    });
  });

  describe('validateAssemblyAnchorRule', () => {
    it('accepts valid min/max/center references', () => {
      expect(() =>
        validateAssemblyAnchorRule({
          x: { ref: 'min', offsetMm: 0 },
          y: { ref: 'max', offsetMm: -10 },
          z: { ref: 'center', offsetMm: 5 },
        }),
      ).not.toThrow();
    });

    it('rejects invalid reference keyword', () => {
      expect(() =>
        validateAssemblyAnchorRule({
          x: { ref: 'invalid' as any, offsetMm: 0 },
          y: { ref: 'min', offsetMm: 0 },
          z: { ref: 'min', offsetMm: 0 },
        }),
      ).toThrow(/axis x has invalid reference 'invalid'/);
    });
  });

  describe('validateAgregadoRigidMember and BOM roles', () => {
    const validMember: AgregadoRigidMember = {
      memberId: 'side_l',
      role: 'drawer_side_left',
      source: {
        kind: 'fixed',
        fixed: { hardwareId: 'hw-side-l' },
      },
      placement: {
        x: { ref: 'min', offsetMm: 0 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole: 'included_in_kit',
    };

    it('accepts included_in_kit when commercial kit is configured', () => {
      expect(() => validateAgregadoRigidMember(validMember, true)).not.toThrow();
    });

    it('rejects included_in_kit when no commercial kit is configured', () => {
      expect(() => validateAgregadoRigidMember(validMember, false)).toThrow(
        /bomRole 'included_in_kit' is invalid when no commercialKitHardwareId is configured/,
      );
    });

    it('accepts separately_purchased with or without commercial kit', () => {
      const separate = { ...validMember, bomRole: 'separately_purchased' as const };
      expect(() => validateAgregadoRigidMember(separate, false)).not.toThrow();
      expect(() => validateAgregadoRigidMember(separate, true)).not.toThrow();
    });

    it('accepts non_purchasing with or without commercial kit', () => {
      const nonPurchasing = { ...validMember, bomRole: 'non_purchasing' as const };
      expect(() => validateAgregadoRigidMember(nonPurchasing, false)).not.toThrow();
      expect(() => validateAgregadoRigidMember(nonPurchasing, true)).not.toThrow();
    });
  });

  describe('validateAgregadoVariantSet', () => {
    it('accepts valid variant set', () => {
      const vs: AgregadoVariantSet = {
        id: 'vs-drawer-depth',
        dimension: 'depth',
        variants: [
          { nominalDimensionMm: 450, hardwareId: 'hw-runner-450' },
          { nominalDimensionMm: 500, hardwareId: 'hw-runner-500' },
        ],
      };
      expect(() => validateAgregadoVariantSet(vs)).not.toThrow();
    });

    it('rejects variant set with invalid dimension', () => {
      const vs: AgregadoVariantSet = {
        id: 'vs-bad',
        dimension: 'diagonal' as any,
        variants: [{ nominalDimensionMm: 500, hardwareId: 'hw-1' }],
      };
      expect(() => validateAgregadoVariantSet(vs)).toThrow(/invalid dimension 'diagonal'/);
    });

    it('rejects variant with non-positive nominal dimension', () => {
      const vs: AgregadoVariantSet = {
        id: 'vs-bad',
        dimension: 'depth',
        variants: [{ nominalDimensionMm: 0, hardwareId: 'hw-1' }],
      };
      expect(() => validateAgregadoVariantSet(vs)).toThrow(/nominalDimensionMm must be positive/);
    });
  });

  describe('AssemblyVariantNotFoundError', () => {
    it('formats informative error message with clearance and nominals', () => {
      const err = new AssemblyVariantNotFoundError('vs-depth', 400, 3, [450, 500, 550]);
      expect(err.message).toContain("assembly variant not found for variantSetId 'vs-depth'");
      expect(err.message).toContain('requested space 400.0mm');
      expect(err.message).toContain('clearance 3.0mm');
      expect(err.message).toContain('[450, 500, 550]');
      expect(err.variantSetId).toBe('vs-depth');
    });
  });
});
