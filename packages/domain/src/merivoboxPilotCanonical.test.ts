import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  type AgregadoAssemblyInput,
  resolveAgregadoAssembly,
  resolveModuleAgregadoAssemblies,
} from './agregadoAssembly';
import type { Agregado, Component, MaterialBoard, Module } from './types';

// --- Canonical pilot contract (#670-E review R9/R10/R12) ----------------------
//
// Single numeric authority: contracts/fixtures/merivobox-pilot-canonical.json.
// Go domain/engine, TS domain, Proyectar WebGL and SketchUp TestUp/evidence all
// resolve against these values. This suite proves the TS side and compares the
// committed SketchUp host evidence against the same canonical numbers, so the
// two renderers can never drift into "slightly different MERIVOBOX pilots".

const contractPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
  'contracts',
  'fixtures',
  'merivobox-pilot-canonical.json',
);
const hostEvidencePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../..',
  'progress',
  'host_smoke_670_e_merivobox_pilot_evidence.json',
);

interface CanonicalBoard {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly thicknessMm: number;
}

interface CanonicalContract {
  readonly configuration: {
    readonly outerWidthMm: number;
    readonly leftPanelThicknessMm: number;
    readonly rightPanelThicknessMm: number;
    readonly derivedLwMm: number;
    readonly assemblyHeightMm: number;
    readonly carcaseDepthMm: number;
    readonly selectedNominalDepthMm: number;
    readonly mutatedOuterWidthMm: number;
    readonly mutatedDerivedLwMm: number;
    readonly variantASpaceDepthMm: number;
    readonly variantASelectedNominalDepthMm: number;
  };
  readonly materialAuthority: {
    readonly optionRole: string;
    readonly materialId: string;
    readonly materialThicknessMm: number;
    readonly nominalGeometryThicknessMm: number;
  };
  readonly hardware: {
    readonly variantSetId: string;
    readonly variantA: { readonly nominalDepthMm: number; readonly hardwareId: string };
    readonly variantB: { readonly nominalDepthMm: number; readonly hardwareId: string };
    readonly commercialKitHardwareId: string;
  };
  readonly provenance: { readonly clearanceMm: number };
  readonly expectedFabricatedMm: {
    readonly w600Nl500: { readonly bottom: CanonicalBoard; readonly back: CanonicalBoard };
    readonly w800Nl500: { readonly bottom: CanonicalBoard; readonly back: CanonicalBoard };
    readonly w600Nl450: { readonly bottom: CanonicalBoard; readonly back: CanonicalBoard };
    readonly rightMembersDeltaMm: number;
  };
}

const canonical = JSON.parse(readFileSync(contractPath, 'utf8')) as CanonicalContract;

function createCanonicalPilotFixture(): AgregadoAssemblyInput {
  return {
    id: 'agr-merivobox-m',
    commercialKitHardwareId: canonical.hardware.commercialKitHardwareId,
    variantSets: [
      {
        id: canonical.hardware.variantSetId,
        dimension: 'depth',
        variants: [
          { nominalDimensionMm: canonical.hardware.variantA.nominalDepthMm, hardwareId: canonical.hardware.variantA.hardwareId },
          { nominalDimensionMm: canonical.hardware.variantB.nominalDepthMm, hardwareId: canonical.hardware.variantB.hardwareId },
        ],
      },
    ],
    compatibilityRules: [
      {
        variantSetId: canonical.hardware.variantSetId,
        clearanceMm: canonical.provenance.clearanceMm, // REAL_VERIFIED: Blum KA-160/24-ES
        selectionStrategy: 'max_fitting',
      },
    ],
    rigidMembers: [
      {
        memberId: 'side-left',
        role: 'side_left',
        source: { kind: 'variant', variant: { variantSetId: canonical.hardware.variantSetId } },
        placement: {
          x: { ref: 'min', offsetMm: 0 },
          y: { ref: 'min', offsetMm: 0 },
          z: { ref: 'min', offsetMm: 0 },
        },
        bomRole: 'included_in_kit',
      },
      {
        memberId: 'side-right',
        role: 'side_right',
        source: { kind: 'variant', variant: { variantSetId: canonical.hardware.variantSetId } },
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
        componentId: 'comp-bottom',
        quantity: 1,
        overrides: {
          widthRule: { source: 'assembly_width', multiplier: 1.0, offsetMm: -58 }, // REAL_VERIFIED: LW - 58
          lengthRule: {
            source: 'selected_variant',
            variantSetId: canonical.hardware.variantSetId,
            multiplier: 1.0,
            offsetMm: -16,
          }, // REAL_VERIFIED: NL - 16
          placementRule: {
            x: { ref: 'min', offsetMm: 29 },
            y: { ref: 'min', offsetMm: 16 },
            z: { ref: 'min', offsetMm: 16 },
          },
        },
      },
      {
        componentId: 'comp-back',
        quantity: 1,
        overrides: {
          widthRule: { source: 'assembly_width', multiplier: 1.0, offsetMm: -58 }, // REAL_VERIFIED: LW - 58
          lengthRule: { source: 'assembly_height', multiplier: 0.0, offsetMm: 69 }, // REAL_VERIFIED: 69mm height
          placementRule: {
            x: { ref: 'min', offsetMm: 29 },
            y: { ref: 'max', offsetMm: -16 },
            z: { ref: 'min', offsetMm: 32 },
          },
        },
      },
    ],
  };
}

describe('#670-E R12: canonical MERIVOBOX pilot parity (TS domain vs canonical contract)', () => {
  it('derives LW from the furniture chain: outerWidth - real carcase panel thicknesses (never passes outer W to the resolver)', () => {
    const { outerWidthMm, leftPanelThicknessMm, rightPanelThicknessMm, derivedLwMm } = canonical.configuration;
    const computedLw = outerWidthMm - leftPanelThicknessMm - rightPanelThicknessMm;
    expect(computedLw).toBe(derivedLwMm);
    expect(derivedLwMm).not.toBe(outerWidthMm);
  });

  it('resolves the canonical configuration (outer W600, panels 15/15 -> LW570, depth 530 -> NL 500) to the canonical fabricated dimensions', () => {
    const fixture = createCanonicalPilotFixture();
    const c = canonical.configuration;

    const resolved = resolveAgregadoAssembly(fixture, {
      widthMm: c.derivedLwMm,
      depthMm: c.carcaseDepthMm,
      heightMm: c.assemblyHeightMm,
    });

    expect(resolved.selectedVariants).toEqual([
      {
        variantSetId: canonical.hardware.variantSetId,
        hardwareId: canonical.hardware.variantB.hardwareId,
        nominalDimensionMm: c.selectedNominalDepthMm,
      },
    ]);
    expect(resolved.commercialKitHardwareId).toBe(canonical.hardware.commercialKitHardwareId);

    const bottom = resolved.fabricatedComponents.find((x) => x.componentId === 'comp-bottom')!;
    const back = resolved.fabricatedComponents.find((x) => x.componentId === 'comp-back')!;
    expect(bottom.widthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.bottom.widthMm);
    expect(bottom.lengthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.bottom.lengthMm);
    expect(back.widthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.back.widthMm);
    expect(back.lengthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.back.lengthMm);
  });

  it('mutating outer W600 -> W800 (LW 570 -> 770) moves right members exactly the canonical delta without scaling', () => {
    const fixture = createCanonicalPilotFixture();
    const c = canonical.configuration;

    const res600 = resolveAgregadoAssembly(fixture, {
      widthMm: c.derivedLwMm,
      depthMm: c.carcaseDepthMm,
      heightMm: c.assemblyHeightMm,
    });
    const res800 = resolveAgregadoAssembly(fixture, {
      widthMm: c.mutatedDerivedLwMm,
      depthMm: c.carcaseDepthMm,
      heightMm: c.assemblyHeightMm,
    });

    const right600 = res600.rigidMembers.find((m) => m.memberId === 'side-right')!;
    const right800 = res800.rigidMembers.find((m) => m.memberId === 'side-right')!;
    expect(right800.localTransform.translationMm[0] - right600.localTransform.translationMm[0])
      .toBe(canonical.expectedFabricatedMm.rightMembersDeltaMm);

    const bottom800 = res800.fabricatedComponents.find((x) => x.componentId === 'comp-bottom')!;
    const back800 = res800.fabricatedComponents.find((x) => x.componentId === 'comp-back')!;
    expect(bottom800.widthMm).toBe(canonical.expectedFabricatedMm.w800Nl500.bottom.widthMm);
    expect(back800.widthMm).toBe(canonical.expectedFabricatedMm.w800Nl500.back.widthMm);
  });

  it('variant A space depth selects NL 450 with the canonical bottom length', () => {
    const fixture = createCanonicalPilotFixture();
    const c = canonical.configuration;

    const resA = resolveAgregadoAssembly(fixture, {
      widthMm: c.derivedLwMm,
      depthMm: c.variantASpaceDepthMm,
      heightMm: c.assemblyHeightMm,
    });

    expect(resA.selectedVariants[0]!.nominalDimensionMm).toBe(c.variantASelectedNominalDepthMm);
    const bottomA = resA.fabricatedComponents.find((x) => x.componentId === 'comp-bottom')!;
    expect(bottomA.lengthMm).toBe(canonical.expectedFabricatedMm.w600Nl450.bottom.lengthMm);
    expect(bottomA.widthMm).toBe(canonical.expectedFabricatedMm.w600Nl450.bottom.widthMm);
  });

  it('R9: fabricated thickness authority is the bound MaterialBoard, not component geometry defaults', () => {
    const recipe = createCanonicalPilotFixture();
    const fixture: Agregado = { ...recipe, code: 'MBX-M', name: 'Blum MERIVOBOX Height M' };
    const c = canonical.configuration;
    const mat = canonical.materialAuthority;

    const module: Module = {
      id: 'mod-merivobox-canonical',
      code: 'MBX-CANONICAL',
      name: 'MERIVOBOX Canonical Pilot Module',
      hardwareLines: [],
      agregados: [
        {
          id: 'inst-merivobox-canonical-1',
          agregadoId: 'agr-merivobox-m',
          quantity: 1,
          position: { xFormula: `${c.leftPanelThicknessMm}`, yFormula: '0', zFormula: '100' },
          // Furniture authority derives the cavity LW from outer W and the real
          // carcase panels; the resolver only ever receives LW.
          dimensions: {
            widthFormula: `PW - ${c.leftPanelThicknessMm + c.rightPanelThicknessMm}`,
            heightFormula: `${c.assemblyHeightMm}`,
            depthFormula: 'PD',
          },
        },
      ],
    };

    // Nominal geometry thickness deliberately conflicts with the bound material
    // (canonical contract): only the MaterialBoard can produce the expected 16.
    const components = [
      {
        id: 'comp-bottom',
        code: 'CMP-BTM',
        name: 'MERIVOBOX Bottom Board',
        active: true,
        placement: 'base',
        geometry: {
          kind: 'rectangular_board',
          lengthMm: 500,
          widthMm: 500,
          thicknessMm: mat.nominalGeometryThicknessMm,
        },
        defaultEdges: [],
        optionRoles: [mat.optionRole],
      },
      {
        id: 'comp-back',
        code: 'CMP-BCK',
        name: 'MERIVOBOX Back Board',
        active: true,
        placement: 'trasera',
        geometry: {
          kind: 'rectangular_board',
          lengthMm: 500,
          widthMm: 69,
          thicknessMm: mat.nominalGeometryThicknessMm,
        },
        defaultEdges: [],
        optionRoles: [mat.optionRole],
      },
    ] as unknown as Component[];

    const material: MaterialBoard = {
      id: mat.materialId,
      code: 'TAB-MBX-16',
      name: 'Tablero MERIVOBOX 16mm',
      widthMm: 1830,
      lengthMm: 2440,
      thicknessMm: mat.materialThicknessMm,
      grainDefault: false,
      boardPrice: 105,
      wastePercent: 10,
      costPerM2: 9,
      active: true,
    };

    const resolved = resolveModuleAgregadoAssemblies(
      module,
      { width: c.outerWidthMm, height: 720, depth: c.carcaseDepthMm },
      {
        agregados: [fixture],
        components,
        materials: [material],
        hardware: [],
      },
      { optionChoices: { [mat.optionRole]: mat.materialId } },
    );

    expect(resolved).toHaveLength(1);
    const assembly = resolved[0]!.resolvedAssembly!;
    const bottom = assembly.fabricatedComponents.find((x) => x.componentId === 'comp-bottom')!;
    const back = assembly.fabricatedComponents.find((x) => x.componentId === 'comp-back')!;

    // Material authority wins over the conflicting nominal geometry default.
    expect(bottom.thicknessMm).toBe(mat.materialThicknessMm);
    expect(back.thicknessMm).toBe(mat.materialThicknessMm);
    expect(bottom.thicknessMm).not.toBe(mat.nominalGeometryThicknessMm);
    expect(bottom.materialId).toBe(mat.materialId);
    expect(back.materialId).toBe(mat.materialId);

    // The module resolution chain also reproduces the canonical fabricated dims.
    expect(bottom.widthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.bottom.widthMm);
    expect(bottom.lengthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.bottom.lengthMm);
    expect(back.widthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.back.widthMm);
    expect(back.lengthMm).toBe(canonical.expectedFabricatedMm.w600Nl500.back.lengthMm);
  });

  it('R9/R12 cross-renderer parity: committed SketchUp host evidence matches the canonical fabricated dimensions', () => {
    const evidence = JSON.parse(readFileSync(hostEvidencePath, 'utf8')) as {
      tests: Record<string, { status?: string } & Record<string, unknown>>;
      w600_to_w800_delta: Record<string, unknown>;
      variant_switch_nl450_to_nl500: Record<string, unknown>;
    };

    for (const [key, block] of Object.entries(evidence.tests)) {
      expect(block.status, `host evidence '${key}' must be pass`).toBe('pass');
    }

    const e1 = evidence.tests['e1_e2_insert_w600']! as Record<string, { width_mm: number; length_mm: number; thickness_mm: number }>;
    const expected600 = canonical.expectedFabricatedMm.w600Nl500;

    // Proyectar (TS resolution above) and SketchUp (host-measured evidence)
    // must fabricate exactly the same panels for the canonical configuration.
    const hostBottom = e1.bottom_panel!;
    const hostBack = e1.back_panel!;
    // Host-measured inches->mm readback carries float noise; parity is exact
    // to the micron, not to the last IEEE-754 bit.
    expect(hostBottom.width_mm).toBeCloseTo(expected600.bottom.widthMm, 6);
    expect(hostBottom.length_mm).toBeCloseTo(expected600.bottom.lengthMm, 6);
    expect(hostBottom.thickness_mm).toBeCloseTo(expected600.bottom.thicknessMm, 6);
    expect(hostBack.width_mm).toBeCloseTo(expected600.back.widthMm, 6);
    expect(hostBack.length_mm).toBeCloseTo(expected600.back.lengthMm, 6);
    expect(hostBack.thickness_mm).toBeCloseTo(expected600.back.thicknessMm, 6);

    const w800 = evidence.w600_to_w800_delta as {
      bottom: { width_mm_before: number; width_mm_after: number; delta_width_mm: number; length_mm: number; thickness_mm: number };
      back: { width_mm_before: number; width_mm_after: number; length_mm: number; thickness_mm: number };
      side_right: { delta_mm: number };
    };
    const expected800 = canonical.expectedFabricatedMm.w800Nl500;
    expect(w800.bottom.width_mm_after).toBeCloseTo(expected800.bottom.widthMm, 6);
    expect(w800.bottom.width_mm_before).toBeCloseTo(expected600.bottom.widthMm, 6);
    expect(w800.bottom.delta_width_mm).toBeCloseTo(canonical.expectedFabricatedMm.rightMembersDeltaMm, 6);
    expect(w800.bottom.length_mm).toBeCloseTo(expected800.bottom.lengthMm, 6);
    expect(w800.bottom.thickness_mm).toBeCloseTo(expected800.bottom.thicknessMm, 6);
    expect(w800.back.width_mm_after).toBeCloseTo(expected800.back.widthMm, 6);
    expect(w800.back.thickness_mm).toBeCloseTo(expected800.back.thicknessMm, 6);
    expect(w800.side_right.delta_mm).toBeCloseTo(canonical.expectedFabricatedMm.rightMembersDeltaMm, 6);

    const variantSwitch = evidence.variant_switch_nl450_to_nl500 as {
      bottom_length_450_mm: number;
      bottom_length_500_mm: number;
    };
    expect(variantSwitch.bottom_length_450_mm).toBeCloseTo(canonical.expectedFabricatedMm.w600Nl450.bottom.lengthMm, 6);
    expect(variantSwitch.bottom_length_500_mm).toBeCloseTo(expected600.bottom.lengthMm, 6);
  });
});
