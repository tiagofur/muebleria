import { describe, expect, it } from 'vitest';
import {
  type AgregadoAssemblyInput,
  type AgregadoRigidMember,
  type AgregadoVariantSet,
  type AssemblyDimensionRule,
  type HardwareMountFrame,
  type PublishedAssemblySnapshot,
  type ResolvedAssembly,
  AssemblyVariantNotFoundError,
  applyAssetNormalization,
  applyAssetNormalizationVector,
  applyAssemblyBasis,
  attachVisualPins,
  composeMemberTransform,
  deriveAssetNormalization,
  deriveHardwareBasisFromEuler,
  evaluateDimensionRule,
  freezePublishedAssemblySnapshot,
  multiplyAssemblyBases,
  projectPublishedAssemblySnapshotFor3D,
  projectResolvedAssemblyFor3D,
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

  describe('validateAgregadoAssemblyDefinition (R8)', () => {
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

    it('accepts fully valid assembly definition', () => {
      expect(() => validateAgregadoAssemblyDefinition(validAssembly)).not.toThrow();
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

  describe('resolveAgregadoAssembly & Regression Tests (R8, R11, R12, R13)', () => {
    const fixtureAssembly: AgregadoAssemblyInput = {
      id: 'blum-merivobox-test',
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

    it('R11: pure mechanical resolution produces ResolvedAssembly without revision or visual pins', () => {
      const resolved = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 600,
        depthMm: 550,
        heightMm: 200,
      });
      expect(resolved.agregadoId).toBe('blum-merivobox-test');
      expect((resolved as any).agregadoRevisionNumber).toBeUndefined();
      for (const m of resolved.rigidMembers) {
        expect(m.assetId).toBeUndefined();
      }
    });

    it('R12: recipe re-evaluation with W=800 produces new ResolvedFabricatedComponent and does not mutate previous', () => {
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

      // Bottom in 600: width = 600 - 35 = 565mm
      expect(snap600.fabricatedComponents[0]!.widthMm).toBe(565);
      // Bottom in 800: width = 800 - 35 = 765mm
      expect(snap800.fabricatedComponents[0]!.widthMm).toBe(765);
      // snap600 was NOT mutated
      expect(snap600.fabricatedComponents[0]!.widthMm).toBe(565);
    });

    it('R13: freezePublishedAssemblySnapshot fails closed if revision is missing/non-positive or visual lookup is falsy', () => {
      const resolved = resolveAgregadoAssembly(fixtureAssembly, {
        widthMm: 600,
        depthMm: 550,
        heightMm: 200,
      });

      const mockLookup = (hwId: string) => ({
        assetId: `asset-${hwId}`,
        assetRevisionId: 'rev-1',
        sha256: `sha-${hwId}`,
      });

      // revision <= 0
      expect(() => freezePublishedAssemblySnapshot(resolved, 0, mockLookup)).toThrow(
        /publication freeze requires authoritative positive recipe revision/,
      );

      // nil visual authority
      expect(() => freezePublishedAssemblySnapshot(resolved, 7, null as any)).toThrow(
        /publication freeze requires #668 visual asset authority/,
      );

      // valid freeze succeeds with exact revision and visual pins
      const frozen = freezePublishedAssemblySnapshot(resolved, 7, mockLookup);
      expect(frozen.agregadoRevisionNumber).toBe(7);
      expect(frozen.rigidMembers[0]!.assetId).toBe('asset-hw-side-500');
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
    const baseAssembly: ResolvedAssembly = {
      agregadoId: 'agr-test',
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
        attachVisualPins(baseAssembly, () => ({
          assetId: 'asset-1',
          assetRevisionId: '', // EMPTY
          sha256: 'abc123sha',
        })),
      ).toThrow(/returned empty assetRevisionId: fail closed/);
    });

    it('empty assetId fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseAssembly, () => ({
          assetId: '', // EMPTY
          assetRevisionId: 'rev-1',
          sha256: 'abc123sha',
        })),
      ).toThrow(/returned empty assetId: fail closed/);
    });

    it('empty sha256 fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseAssembly, () => ({
          assetId: 'asset-1',
          assetRevisionId: 'rev-1',
          sha256: '   ', // EMPTY
        })),
      ).toThrow(/returned empty sha256: fail closed/);
    });

    it('invalid mountFrame basis fails closed (R10)', () => {
      expect(() =>
        attachVisualPins(baseAssembly, () => ({
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
      const pinned = attachVisualPins(baseAssembly, () => ({
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

  describe('deriveAssetNormalization and Canonical #668 Parity', () => {
    // Exact Go & Ruby cross-language fixture
    const crossLangMountFrame: HardwareMountFrame = {
      originMm: [15.0, 30.0, 45.0],
      basis: {
        x: [0.0, 1.0, 0.0],
        y: [0.0, 0.0, 1.0],
        z: [1.0, 0.0, 0.0],
      },
    };

    it('matches Go/Ruby exact fixture: origin maps to [0, 0, 0]', () => {
      const norm = deriveAssetNormalization(crossLangMountFrame);
      const canonicalOrigin = applyAssetNormalization(norm, crossLangMountFrame.originMm);

      expect(Math.abs(canonicalOrigin[0])).toBeLessThan(1e-6);
      expect(Math.abs(canonicalOrigin[1])).toBeLessThan(1e-6);
      expect(Math.abs(canonicalOrigin[2])).toBeLessThan(1e-6);
    });

    it('matches Go/Ruby exact fixture: primary and normal axes map to canonical +X and +Z', () => {
      const norm = deriveAssetNormalization(crossLangMountFrame);

      const pAxis = applyAssetNormalizationVector(norm, crossLangMountFrame.basis.x);
      expect(Math.abs(pAxis[0] - 1.0)).toBeLessThan(1e-6);
      expect(Math.abs(pAxis[1])).toBeLessThan(1e-6);
      expect(Math.abs(pAxis[2])).toBeLessThan(1e-6);

      const pNorm = applyAssetNormalizationVector(norm, crossLangMountFrame.basis.z);
      expect(Math.abs(pNorm[0])).toBeLessThan(1e-6);
      expect(Math.abs(pNorm[1])).toBeLessThan(1e-6);
      expect(Math.abs(pNorm[2] - 1.0)).toBeLessThan(1e-6);
    });

    it('preserves exact distance between arbitrary 3D points (rigid transform invariant)', () => {
      const norm = deriveAssetNormalization(crossLangMountFrame);
      const pt1: [number, number, number] = [10.0, 50.0, 20.0];
      const pt2: [number, number, number] = [80.0, -20.0, 95.0];

      const dx = pt2[0] - pt1[0];
      const dy = pt2[1] - pt1[1];
      const dz = pt2[2] - pt1[2];
      const distRaw = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const c1 = applyAssetNormalization(norm, pt1);
      const c2 = applyAssetNormalization(norm, pt2);
      const cdx = c2[0] - c1[0];
      const cdy = c2[1] - c1[1];
      const cdz = c2[2] - c1[2];
      const distCanonical = Math.sqrt(cdx * cdx + cdy * cdy + cdz * cdz);

      expect(Math.abs(distRaw - distCanonical)).toBeLessThan(1e-6);
    });

    it('rejects mirrored (left-handed, det = -1) mount frame basis', () => {
      const mirrored: HardwareMountFrame = {
        originMm: [0, 0, 0],
        basis: {
          x: [1, 0, 0],
          y: [0, 1, 0],
          z: [0, 0, -1],
        },
      };
      expect(() => deriveAssetNormalization(mirrored)).toThrow(/must be right-handed with det=\+1/);
    });

    it('rejects non-finite coordinates in mount frame origin', () => {
      const badOrigin: HardwareMountFrame = {
        originMm: [Number.NaN, 0, 0],
        basis: {
          x: [1, 0, 0],
          y: [0, 1, 0],
          z: [0, 0, 1],
        },
      };
      expect(() => deriveAssetNormalization(badOrigin)).toThrow(/must be finite/);
    });
  });

  describe('composeMemberTransform and Transform Composition', () => {
    it('returns member transform unchanged when no mountFrame is supplied', () => {
      const memberTransform = {
        translationMm: [100, 200, 300] as const,
        basis: {
          x: [1, 0, 0] as const,
          y: [0, 1, 0] as const,
          z: [0, 0, 1] as const,
        },
      };
      const composed = composeMemberTransform(memberTransform);
      expect(composed.translationMm).toEqual([100, 200, 300]);
      expect(composed.basis).toEqual(memberTransform.basis);
    });

    it('composes T_member * T_norm such that mount origin lands exactly on member nominal translation', () => {
      const mountFrame: HardwareMountFrame = {
        originMm: [25.0, -10.0, 8.0],
        basis: {
          x: [0.0, 1.0, 0.0],
          y: [-1.0, 0.0, 0.0],
          z: [0.0, 0.0, 1.0],
        },
      };
      const memberTransform = {
        translationMm: [300.0, 400.0, 500.0] as const,
        basis: {
          x: [1.0, 0.0, 0.0] as const,
          y: [0.0, 1.0, 0.0] as const,
          z: [0.0, 0.0, 1.0] as const,
        },
      };

      const composed = composeMemberTransform(memberTransform, mountFrame);

      // In asset space, point at mount origin [25, -10, 8]
      // In assembly space: composed.translation + composed.basis * point
      const pAsset = mountFrame.originMm;
      const rotP = applyAssemblyBasis(composed.basis, pAsset);
      const pAssembly: readonly [number, number, number] = [
        composed.translationMm[0] + rotP[0],
        composed.translationMm[1] + rotP[1],
        composed.translationMm[2] + rotP[2],
      ];

      expect(Math.abs(pAssembly[0] - 300.0)).toBeLessThan(1e-4);
      expect(Math.abs(pAssembly[1] - 400.0)).toBeLessThan(1e-4);
      expect(Math.abs(pAssembly[2] - 500.0)).toBeLessThan(1e-4);
    });

    it('double application of normalization breaks position (negative test)', () => {
      const mountFrame: HardwareMountFrame = {
        originMm: [25.0, -10.0, 8.0],
        basis: {
          x: [0.0, 1.0, 0.0],
          y: [-1.0, 0.0, 0.0],
          z: [0.0, 0.0, 1.0],
        },
      };
      const memberTransform = {
        translationMm: [300.0, 400.0, 500.0] as const,
        basis: {
          x: [1.0, 0.0, 0.0] as const,
          y: [0.0, 1.0, 0.0] as const,
          z: [0.0, 0.0, 1.0] as const,
        },
      };

      const composedOnce = composeMemberTransform(memberTransform, mountFrame);
      // Double normalize!
      const composedTwice = composeMemberTransform(composedOnce, mountFrame);

      const pAsset = mountFrame.originMm;
      const rotP = applyAssemblyBasis(composedTwice.basis, pAsset);
      const pAssemblyDouble: readonly [number, number, number] = [
        composedTwice.translationMm[0] + rotP[0],
        composedTwice.translationMm[1] + rotP[1],
        composedTwice.translationMm[2] + rotP[2],
      ];

      // Double normalization does NOT land on nominal [300, 400, 500]
      expect(Math.abs(pAssemblyDouble[0] - 300.0)).toBeGreaterThan(1.0);
    });
  });

  describe('3D Projection: projectResolvedAssemblyFor3D & projectPublishedAssemblySnapshotFor3D', () => {
    const mockResolved: ResolvedAssembly = {
      agregadoId: 'agr-drawer-system',
      resolvedDimensionsMm: [600, 550, 200],
      selectedVariants: [
        { variantSetId: 'vs-depth', hardwareId: 'hw-runner-500', nominalDimensionMm: 500 },
      ],
      rigidMembers: [
        {
          memberId: 'side_left',
          role: 'side',
          hardwareId: 'hw-side-500',
          bomRole: 'included_in_kit',
          localTransform: {
            translationMm: [0, 0, 0],
            basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
          },
        },
        {
          memberId: 'side_right',
          role: 'side',
          hardwareId: 'hw-side-500',
          bomRole: 'included_in_kit',
          localTransform: {
            translationMm: [600, 0, 0],
            basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
          },
        },
      ],
      fabricatedComponents: [
        {
          componentId: 'comp-bottom',
          quantity: 1,
          lengthMm: 490,
          widthMm: 565,
          transform: {
            translationMm: [17.5, 10, 16],
            basis: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
          },
        },
      ],
      bomItems: [],
    };

    it('projectResolvedAssemblyFor3D projects live preview without scaling rigid members', () => {
      const projected = projectResolvedAssemblyFor3D({
        assembly: mockResolved,
        placement: { originMm: [100, 200, 300] },
        assemblyInstanceId: 'inst-drawer-1',
      });

      expect(projected.assemblyInstanceId).toBe('inst-drawer-1');
      expect(projected.isHistorical).toBe(false);
      expect(projected.recipeRevision).toBeUndefined();
      expect(projected.rigidMembers).toHaveLength(2);

      for (const m of projected.rigidMembers) {
        expect(m.renderStatus).toBe('proxy');
        // Rigorous invariant: ProjectedRigidMember has NO scale property
        expect((m as any).scale).toBeUndefined();
        // Effective basis has det = +1
        const b = m.effectiveTransform.basis;
        const det = b.x[0] * (b.y[1] * b.z[2] - b.y[2] * b.z[1]) +
                    b.x[1] * (b.y[2] * b.z[0] - b.y[0] * b.z[2]) +
                    b.x[2] * (b.y[0] * b.z[1] - b.y[1] * b.z[0]);
        expect(Math.abs(det - 1.0)).toBeLessThan(1e-6);
      }

      expect(projected.fabricatedComponents[0]!.widthMm).toBe(565);
    });

    it('projectResolvedAssemblyFor3D rejects PublishedAssemblySnapshot to enforce explicit entrypoints', () => {
      const snapshotLike = {
        ...mockResolved,
        agregadoRevisionNumber: 3,
      } as any;

      expect(() =>
        projectResolvedAssemblyFor3D({
          assembly: snapshotLike,
          placement: { originMm: [0, 0, 0] },
          assemblyInstanceId: 'inst-1',
        }),
      ).toThrow(/use projectPublishedAssemblySnapshotFor3D for historical snapshots/);
    });

    it('projectPublishedAssemblySnapshotFor3D reports exact when asset is available in store', () => {
      const snapshot: PublishedAssemblySnapshot = {
        ...mockResolved,
        agregadoRevisionNumber: 4,
        rigidMembers: mockResolved.rigidMembers.map((m) => ({
          ...m,
          assetId: 'ast-1',
          assetRevisionId: 'rev-ar-2',
          sha256: 'sha-2',
        })),
      };

      const availableAssets = new Set(['rev-ar-2']);
      const projected = projectPublishedAssemblySnapshotFor3D({
        snapshot,
        placement: { originMm: [0, 0, 0] },
        assemblyInstanceId: 'hist-drawer-1',
        availableAssets,
      });

      expect(projected.isHistorical).toBe(true);
      expect(projected.recipeRevision).toBe(4);
      expect(projected.rigidMembers[0]!.renderStatus).toBe('exact');
      expect(projected.rigidMembers[0]!.assetRevisionId).toBe('rev-ar-2');
    });

    it('projectPublishedAssemblySnapshotFor3D fails closed with historical_asset_missing when exact asset is missing (no fallback)', () => {
      const snapshot: PublishedAssemblySnapshot = {
        ...mockResolved,
        agregadoRevisionNumber: 4,
        rigidMembers: mockResolved.rigidMembers.map((m) => ({
          ...m,
          assetId: 'ast-1',
          assetRevisionId: 'rev-ar-2',
          sha256: 'sha-2',
        })),
      };

      // Only rev-ar-5 is available in catalog, NOT the historical rev-ar-2
      const availableAssets = new Set(['rev-ar-5']);
      const projected = projectPublishedAssemblySnapshotFor3D({
        snapshot,
        placement: { originMm: [0, 0, 0] },
        assemblyInstanceId: 'hist-drawer-1',
        availableAssets,
      });

      expect(projected.rigidMembers[0]!.renderStatus).toBe('historical_asset_missing');
      expect(projected.rigidMembers[0]!.statusDiagnostic).toContain('exact historical asset unavailable (rev: rev-ar-2)');
      // MUST NOT fall back to rev-ar-5!
      expect(projected.rigidMembers[0]!.assetRevisionId).toBe('rev-ar-2');
    });

    it('projectPublishedAssemblySnapshotFor3D rejects invalid or non-positive recipeRevision', () => {
      const badSnapshot = {
        ...mockResolved,
        agregadoRevisionNumber: 0,
      } as any;

      expect(() =>
        projectPublishedAssemblySnapshotFor3D({
          snapshot: badSnapshot,
          placement: { originMm: [0, 0, 0] },
          assemblyInstanceId: 'hist-1',
        }),
      ).toThrow(/recipeRevision must be positive integer/);
    });
  });
});

