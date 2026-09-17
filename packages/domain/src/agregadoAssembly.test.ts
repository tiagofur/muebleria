import { describe, expect, it } from 'vitest';
import {
  type AgregadoAssemblyInput,
  type AgregadoRigidMember,
  type AgregadoVariantSet,
  type AssemblyDimensionRule,
  AssemblyVariantNotFoundError,
  deriveHardwareBasisFromEuler,
  evaluateDimensionRule,
  validateAgregadoAssemblyDefinition,
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

  describe('validateAssemblyAnchorRule & deriveHardwareBasisFromEuler (R2)', () => {
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

    it('rejects non-finite offset', () => {
      expect(() =>
        validateAssemblyAnchorRule({
          x: { ref: 'min', offsetMm: Number.NaN },
          y: { ref: 'min', offsetMm: 0 },
          z: { ref: 'min', offsetMm: 0 },
        }),
      ).toThrow(/axis x has non-finite or out-of-bounds offsetMm/);
    });

    it('computes orthonormal basis from finite Euler angles (det = +1.0)', () => {
      const basis = deriveHardwareBasisFromEuler({ x: 0, y: 90, z: 0 });
      // det = X · (Y x Z)
      const crossYZ: [number, number, number] = [
        basis.y[1] * basis.z[2] - basis.y[2] * basis.z[1],
        basis.y[2] * basis.z[0] - basis.y[0] * basis.z[2],
        basis.y[0] * basis.z[1] - basis.y[1] * basis.z[0],
      ];
      const det =
        basis.x[0] * crossYZ[0] + basis.x[1] * crossYZ[1] + basis.x[2] * crossYZ[2];
      expect(Math.abs(det - 1.0)).toBeLessThan(1e-6);
    });

    it('rejects non-finite rotation angles', () => {
      expect(() =>
        deriveHardwareBasisFromEuler({ x: Number.NaN, y: 0, z: 0 }),
      ).toThrow(/rotation angles must be finite/);
    });
  });

  describe('evaluateDimensionRule (R1)', () => {
    const params = { widthMm: 600, depthMm: 550, heightMm: 200 };
    const selectedVariants = new Map([
      ['vs-depth', { variantSetId: 'vs-depth', hardwareId: 'hw-500', nominalDimensionMm: 500 }],
    ]);

    it('evaluates assembly_width: W=600 with offset -35 -> 565mm', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        offsetMm: -35,
      };
      expect(evaluateDimensionRule(rule, params, selectedVariants)).toBe(565);
    });

    it('evaluates assembly_width: W=800 with offset -35 -> 765mm', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        offsetMm: -35,
      };
      expect(evaluateDimensionRule(rule, { ...params, widthMm: 800 }, selectedVariants)).toBe(765);
    });

    it('evaluates selected_variant: 500 with offset -10 -> 490mm', () => {
      const rule: AssemblyDimensionRule = {
        source: 'selected_variant',
        variantSetId: 'vs-depth',
        offsetMm: -10,
      };
      expect(evaluateDimensionRule(rule, params, selectedVariants)).toBe(490);
    });

    it('throws when selected_variant is missing variantSetId', () => {
      const rule: AssemblyDimensionRule = {
        source: 'selected_variant',
        offsetMm: 0,
      };
      expect(() => evaluateDimensionRule(rule, params, selectedVariants)).toThrow(
        /requires variantSetId/,
      );
    });

    it('throws when dimension evaluates to negative value', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        offsetMm: -700, // 600 - 700 = -100
      };
      expect(() => evaluateDimensionRule(rule, params, selectedVariants)).toThrow(
        /evaluated to non-positive dimension/,
      );
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
      expect(() => validateAgregadoVariantSet(vs)).toThrow(/nominalDimensionMm must be finite and positive/);
    });

    it('rejects duplicate nominalDimensionMm inside same variant set', () => {
      const vs: AgregadoVariantSet = {
        id: 'vs-dup',
        dimension: 'depth',
        variants: [
          { nominalDimensionMm: 500, hardwareId: 'hw-1' },
          { nominalDimensionMm: 500, hardwareId: 'hw-2' },
        ],
      };
      expect(() => validateAgregadoVariantSet(vs)).toThrow(/duplicate nominalDimensionMm: 500/);
    });
  });

  describe('validateAgregadoAssemblyDefinition (R5)', () => {
    const validAssembly: AgregadoAssemblyInput = {
      id: 'agr-test',
      commercialKitHardwareId: 'hw-kit',
      variantSets: [
        {
          id: 'vs-depth',
          dimension: 'depth',
          variants: [{ nominalDimensionMm: 500, hardwareId: 'hw-500' }],
        },
      ],
      compatibilityRules: [
        {
          variantSetId: 'vs-depth',
          clearanceMm: 3,
          selectionStrategy: 'max_fitting',
        },
      ],
      rigidMembers: [
        {
          memberId: 'side_l',
          role: 'side',
          source: { kind: 'variant', variant: { variantSetId: 'vs-depth' } },
          placement: {
            x: { ref: 'min', offsetMm: 0 },
            y: { ref: 'min', offsetMm: 0 },
            z: { ref: 'min', offsetMm: 0 },
          },
          bomRole: 'included_in_kit',
        },
      ],
      fabricatedMembers: [
        {
          memberId: 'bottom_board',
          slotId: 'bottom',
          name: 'Bottom Board',
          thicknessMm: 16,
          lengthRule: { source: 'selected_variant', variantSetId: 'vs-depth', offsetMm: -10 },
          widthRule: { source: 'assembly_width', offsetMm: -35 },
          placement: {
            x: { ref: 'min', offsetMm: 17.5 },
            y: { ref: 'min', offsetMm: 10 },
            z: { ref: 'min', offsetMm: 16 },
          },
        },
      ],
    };

    it('accepts fully valid assembly definition', () => {
      expect(() => validateAgregadoAssemblyDefinition(validAssembly)).not.toThrow();
    });

    it('rejects duplicate memberId between rigid and fabricated', () => {
      const dup = {
        ...validAssembly,
        fabricatedMembers: [
          {
            ...validAssembly.fabricatedMembers![0]!,
            memberId: 'side_l', // duplicate of rigid memberId
          },
        ],
      };
      expect(() => validateAgregadoAssemblyDefinition(dup)).toThrow(
        /duplicate memberId 'side_l'/,
      );
    });

    it('rejects duplicate variantSetId', () => {
      const dup = {
        ...validAssembly,
        variantSets: [...validAssembly.variantSets!, validAssembly.variantSets![0]!],
      };
      expect(() => validateAgregadoAssemblyDefinition(dup)).toThrow(
        /duplicate variantSetId 'vs-depth'/,
      );
    });

    it('rejects compatibility rule referencing non-existent variantSetId', () => {
      const bad = {
        ...validAssembly,
        compatibilityRules: [
          { variantSetId: 'vs-ghost', clearanceMm: 3, selectionStrategy: 'max_fitting' as const },
        ],
      };
      expect(() => validateAgregadoAssemblyDefinition(bad)).toThrow(
        /references non-existent variantSetId 'vs-ghost'/,
      );
    });

    it('rejects multiple compatibility rules for same variantSetId', () => {
      const bad = {
        ...validAssembly,
        compatibilityRules: [
          validAssembly.compatibilityRules![0]!,
          validAssembly.compatibilityRules![0]!,
        ],
      };
      expect(() => validateAgregadoAssemblyDefinition(bad)).toThrow(
        /multiple ambiguous compatibility rules/,
      );
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
