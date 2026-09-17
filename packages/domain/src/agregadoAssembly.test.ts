import { describe, expect, it } from 'vitest';
import {
  type AgregadoAssemblyInput,
  type AgregadoRigidMember,
  type AgregadoVariantSet,
  type AssemblyDimensionRule,
  type ResolvedAssemblySnapshot,
  AssemblyVariantNotFoundError,
  attachVisualPins,
  deriveHardwareBasisFromEuler,
  evaluateDimensionRule,
  resolveAgregadoAssembly,
  validateAgregadoAssemblyDefinition,
  validateAgregadoRigidMember,
  validateAgregadoVariantSet,
  validateAssemblyAnchorRule,
  validateHardwareBasis,
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

  describe('evaluateDimensionRule and Multiplier Contract (R1, R9)', () => {
    const params = { widthMm: 600, depthMm: 550, heightMm: 200 };
    const selectedVariants = new Map([
      ['vs-depth', { variantSetId: 'vs-depth', hardwareId: 'hw-500', nominalDimensionMm: 500 }],
    ]);

    it('omitted multiplier defaults to 1.0 (R9)', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        offsetMm: -35,
      };
      expect(evaluateDimensionRule(rule, params, selectedVariants)).toBe(565);
    });

    it('explicit 0.0 multiplier behaves as mathematical 0.0 (R9)', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        multiplier: 0.0,
        offsetMm: 50.0,
      };
      // base * 0.0 + 50.0 = 50.0
      expect(evaluateDimensionRule(rule, params, selectedVariants)).toBe(50.0);
    });

    it('explicit fractional multiplier behaves mathematically (R9)', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        multiplier: 0.5,
        offsetMm: -35.0,
      };
      // 600 * 0.5 - 35 = 265
      expect(evaluateDimensionRule(rule, params, selectedVariants)).toBe(265.0);
    });

    it('rejects non-finite multiplier (R9)', () => {
      const rule: AssemblyDimensionRule = {
        source: 'assembly_width',
        multiplier: Number.NaN,
        offsetMm: 10,
      };
      expect(() => evaluateDimensionRule(rule, params, selectedVariants)).toThrow(
        /non-finite multiplier/,
      );
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

  describe('validateAgregadoAssemblyDefinition (R7, R8)', () => {
    const validAssembly: AgregadoAssemblyInput = {
      id: 'agr-test',
      revision: 7,
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
      components: [
        {
          componentId: 'comp-bottom-board',
          quantity: 1,
          overrides: {
            lengthRule: { source: 'selected_variant', variantSetId: 'vs-depth', offsetMm: -10 },
            widthRule: { source: 'assembly_width', offsetMm: -35 },
            placementRule: {
              x: { ref: 'min', offsetMm: 17.5 },
              y: { ref: 'min', offsetMm: 10 },
              z: { ref: 'min', offsetMm: 16 },
            },
          },
        },
      ],
    };

    it('accepts fully valid assembly definition with positive revision (R7)', () => {
      expect(() => validateAgregadoAssemblyDefinition(validAssembly)).not.toThrow();
    });

    it('fails closed when revision is missing or non-positive (R7)', () => {
      expect(() => validateAgregadoAssemblyDefinition({ ...validAssembly, revision: 0 })).toThrow(
        /requires authoritative positive revision/,
      );
      expect(() => validateAgregadoAssemblyDefinition({ ...validAssembly, revision: undefined })).toThrow(
        /requires authoritative positive revision/,
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
  });

  describe('resolveAgregadoAssembly & Regression Tests (R7, R8)', () => {
    const fixtureAssembly: AgregadoAssemblyInput = {
      id: 'blum-merivobox-test',
      revision: 7,
      commercialKitHardwareId: 'hw-merivobox-kit',
      variantSets: [
        {
          id: 'depth-set',
          dimension: 'depth',
          variants: [
            { nominalDimensionMm: 450, hardwareId: 'hw-side-450' },
            { nominalDimensionMm: 500, hardwareId: 'hw-side-500' },
            { nominalDimensionMm: 550, hardwareId: 'hw-side-550' },
          ],
        },
      ],
      compatibilityRules: [
        {
          variantSetId: 'depth-set',
          clearanceMm: 3,
          selectionStrategy: 'max_fitting',
        },
      ],
      rigidMembers: [
        {
          memberId: 'side_left',
          role: 'side_left',
          source: { kind: 'variant', variant: { variantSetId: 'depth-set' } },
          placement: {
            x: { ref: 'min', offsetMm: 0 },
            y: { ref: 'min', offsetMm: 0 },
            z: { ref: 'min', offsetMm: 0 },
          },
          bomRole: 'included_in_kit',
        },
        {
          memberId: 'side_right',
          role: 'side_right',
          source: { kind: 'variant', variant: { variantSetId: 'depth-set' } },
          placement: {
            x: { ref: 'max', offsetMm: 0 },
            y: { ref: 'min', offsetMm: 0 },
            z: { ref: 'min', offsetMm: 0 },
          },
          bomRole: 'included_in_kit',
        },
      ],
      components: [
        {
          componentId: 'comp-drawer-bottom',
          quantity: 1,
          overrides: {
            lengthRule: { source: 'selected_variant', variantSetId: 'depth-set', offsetMm: -10 },
            widthRule: { source: 'assembly_width', offsetMm: -35 },
            placementRule: {
              x: { ref: 'min', offsetMm: 17.5 },
              y: { ref: 'min', offsetMm: 10 },
              z: { ref: 'min', offsetMm: 16 },
            },
          },
        },
      ],
    };

    it('R7: recipe revision 7 produces snapshot revision 7', () => {
      const snapshot = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 600,
        depthMm: 550,
        heightMm: 200,
      });
      expect(snapshot.agregadoRevisionNumber).toBe(7);
      expect(snapshot.agregadoId).toBe('blum-merivobox-test');
    });

    it('R7: recipe revision missing/zero fails closed', () => {
      const bad = { ...fixtureAssembly, revision: 0 };
      expect(() =>
        resolveAgregadoAssembly(bad, { widthMm: 600, depthMm: 550, heightMm: 200 }),
      ).toThrow(/requires authoritative positive revision/);
    });

    it('R7: explicit param revision override is respected', () => {
      const snapshot = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 600,
        depthMm: 550,
        heightMm: 200,
        recipeRevisionNumber: 42,
      });
      expect(snapshot.agregadoRevisionNumber).toBe(42);
    });

    it('R8: parametric bottom produces ONE authoritative fabricated component, not two', () => {
      const snapshot = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 600,
        depthMm: 550,
        heightMm: 200,
      });

      // Exactly 1 fabricated piece
      expect(snapshot.fabricatedComponents).toHaveLength(1);
      const bottom = snapshot.fabricatedComponents[0]!;
      expect(bottom.componentId).toBe('comp-drawer-bottom');
      expect(bottom.quantity).toBe(1);

      // Width: 600 - 35 = 565mm
      expect(bottom.widthMm).toBe(565);
      // Length: 500 (selected variant for depth 550 - clearance 3 = 547 => 500) - 10 = 490mm
      expect(bottom.lengthMm).toBe(490);
      expect(bottom.transform.translationMm).toEqual([17.5, 10, 16]);
    });

    it('width expansion shifts right member only, left member unchanged (zero scale)', () => {
      const snap600 = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 600,
        depthMm: 550,
        heightMm: 200,
      });
      const snap800 = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 800,
        depthMm: 550,
        heightMm: 200,
      });

      const left600 = snap600.rigidMembers.find((m) => m.memberId === 'side_left')!;
      const left800 = snap800.rigidMembers.find((m) => m.memberId === 'side_left')!;
      expect(left600.localTransform.translationMm[0]).toBe(0);
      expect(left800.localTransform.translationMm[0]).toBe(0);

      const right600 = snap600.rigidMembers.find((m) => m.memberId === 'side_right')!;
      const right800 = snap800.rigidMembers.find((m) => m.memberId === 'side_right')!;
      expect(right600.localTransform.translationMm[0]).toBe(600);
      expect(right800.localTransform.translationMm[0]).toBe(800);
    });
  });

  describe('attachVisualPins fail-closed (R10)', () => {
    const baseSnapshot: ResolvedAssemblySnapshot = {
      agregadoId: 'agr-test',
      agregadoRevisionNumber: 7,
      resolvedDimensionsMm: [600, 550, 200],
      selectedVariants: [],
      rigidMembers: [
        {
          memberId: 'side_left',
          role: 'side',
          hardwareId: 'hw-side-500',
          localTransform: {
            translationMm: [0, 0, 0],
            basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
          },
          bomRole: 'included_in_kit',
        },
      ],
      fabricatedComponents: [],
      bomItems: [],
    };

    it('empty revisionId fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseSnapshot, () => ({
          assetId: 'asset-1',
          assetRevisionId: '', // EMPTY
          sha256: 'abc123sha',
        })),
      ).toThrow(/returned empty assetRevisionId: fail closed/);
    });

    it('empty assetId fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseSnapshot, () => ({
          assetId: '', // EMPTY
          assetRevisionId: 'rev-1',
          sha256: 'abc123sha',
        })),
      ).toThrow(/returned empty assetId: fail closed/);
    });

    it('empty sha256 fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseSnapshot, () => ({
          assetId: 'asset-1',
          assetRevisionId: 'rev-1',
          sha256: '   ', // EMPTY
        })),
      ).toThrow(/returned empty sha256: fail closed/);
    });

    it('invalid mountFrame basis fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseSnapshot, () => ({
          assetId: 'asset-1',
          assetRevisionId: 'rev-1',
          sha256: 'abc123sha',
          mountFrame: {
            originMm: [0, 0, 0],
            basis: {
              x: [1, 0, 0],
              y: [0, 1, 0],
              z: [0, 0, -1], // Mirrored/left-handed det = -1
            },
          },
        })),
      ).toThrow(/must be right-handed with det=\+1/);
    });

    it('complete valid metadata succeeds (R10)', () => {
      const pinned = attachVisualPins(baseSnapshot, () => ({
        assetId: 'asset-123',
        assetRevisionId: 'rev-456',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        mountFrame: {
          originMm: [10, 20, 30],
          basis: {
            x: [1, 0, 0],
            y: [0, 1, 0],
            z: [0, 0, 1],
          },
        },
      }));

      const m = pinned.rigidMembers[0]!;
      expect(m.assetId).toBe('asset-123');
      expect(m.assetRevisionId).toBe('rev-456');
      expect(m.sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(m.mountFrame?.originMm).toEqual([10, 20, 30]);
    });
  });
});
