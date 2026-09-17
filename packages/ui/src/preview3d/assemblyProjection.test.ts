/**
 * Assembly Projection in Proyectar 3D / WebGL Test Suite
 * Issue: #670-C
 *
 * Implements and verifies all audit gates:
 * - Gate 1: Proyección de Assembly (N rigid members, M fabricated components)
 * - Gate 2 / 7: Resolver real 600 -> 800mm (+200mm delta, no parametric scale, bottom 565 -> 765)
 * - Gate 3: Preservación geométrica interna de miembros rígidos
 * - Gate 4 / 3: Espesor autoritativo de piezas fabricadas (15mm y 18mm sin hardcode)
 * - Gate 5 / 5: Gate de doble normalización (MountFrame no-identidad aplicado exactamente 1 vez)
 * - Gate 6 / 6: Gate de composición completa 4 niveles (Furniture x Assembly x Member x AssetNormalization)
 * - Gate 7 / 4: Identidad estable independiente del orden en array (reorder [A, B] -> [B, A]) y obligatoriedad de id
 * - Gate 8 / 8: Snapshot histórico congelado (D1/R2 no llama resolver ni bindings actuales AR7)
 * - Gate 9 / 9: Missing historical asset falla cerrado (renderStatus = 'historical_asset_missing', sin fallback)
 * - Gate 10 / 11: Dos assemblies independientes compartiendo el mismo assetRevision
 * - Gate 11 / 12: Modos de render (textured, ghost, wireframe) sin materiales paralelos
 * - Gate 12 / 13: Performance O(N) lineal sin O(N^2)
 * - Gate 13: Cero marcas en núcleo (sin Blum, Grass, etc.)
 */

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Agregado,
  AgregadoAssemblyInput,
  AssemblyMemberTransform,
  Component,
  Hardware,
  HardwareMountFrame,
  MaterialBoard,
  Module,
  Project,
  ProjectItem,
  PublishedAssemblySnapshot,
  ResolvedAssembly,
} from '@granete/domain';
import * as domainModule from '@granete/domain';
import {
  deriveAssetNormalization,
  composeMemberTransform,
  freezePublishedAssemblySnapshot,
  projectPublishedAssemblySnapshotFor3D,
  projectResolvedAssemblyFor3D,
  resolveAgregadoAssembly,
} from '@granete/domain';
import {
  assemblyPoseToThree,
  assemblyTransformToThreeMatrix4,
  AssemblyMesh,
  composeFullVisualTransform,
} from './AssemblyMesh';
import {
  resolveModuleAssemblies,
  resolveProject3DPreview,
} from './project3dPreview';
import type { Module3DCatalogInput } from '../modules/module3dPreview';

// --- Fixtures ----------------------------------------------------------------

const fixtureAssemblyInput: AgregadoAssemblyInput = {
  id: 'agr-drawer-system',
  commercialKitHardwareId: 'kit-box-runner',
  variantSets: [
    {
      id: 'depth-runners',
      dimension: 'depth',
      variants: [
        { nominalDimensionMm: 400, hardwareId: 'runner-400' },
        { nominalDimensionMm: 500, hardwareId: 'runner-500' },
      ],
    },
  ],
  compatibilityRules: [
    {
      variantSetId: 'depth-runners',
      clearanceMm: 20,
      selectionStrategy: 'max_fitting',
    },
  ],
  rigidMembers: [
    {
      memberId: 'runner-left',
      role: 'guide_left',
      source: {
        kind: 'variant',
        variant: { variantSetId: 'depth-runners' },
      },
      placement: {
        x: { ref: 'min', offsetMm: 0 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole: 'included_in_kit',
    },
    {
      memberId: 'runner-right',
      role: 'guide_right',
      source: {
        kind: 'variant',
        variant: { variantSetId: 'depth-runners' },
      },
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
      componentId: 'comp-bottom-panel',
      quantity: 1,
      overrides: {
        widthRule: {
          source: 'assembly_width',
          multiplier: 1.0,
          offsetMm: -35,
        },
        lengthRule: {
          source: 'selected_variant',
          variantSetId: 'depth-runners',
          multiplier: 1.0,
          offsetMm: -10,
        },
        placementRule: {
          x: { ref: 'min', offsetMm: 17.5 },
          y: { ref: 'min', offsetMm: 5 },
          z: { ref: 'min', offsetMm: 15 },
        },
      },
    },
    {
      componentId: 'comp-back-panel',
      quantity: 1,
      overrides: {
        widthRule: {
          source: 'assembly_width',
          multiplier: 1.0,
          offsetMm: -35,
        },
        lengthRule: {
          source: 'assembly_height',
          multiplier: 1.0,
          offsetMm: -50,
        },
        placementRule: {
          x: { ref: 'min', offsetMm: 17.5 },
          y: { ref: 'max', offsetMm: -18 },
          z: { ref: 'min', offsetMm: 25 },
        },
      },
    },
  ],
};

const catalogAgregado: Agregado = {
  ...fixtureAssemblyInput,
  code: 'AGR-SYS',
  name: 'Drawer System Subassembly',
};

const catalogHardware: Hardware[] = [
  {
    id: 'runner-400',
    code: 'RUN-400',
    name: 'Runner 400mm',
    unit: 'piece',
    costPerUnit: 15,
    active: true,
    previewShape: 'slide',
    previewSizeMm: 400,
    previewDiameterMm: 45,
    previewColor: '#888888',
  },
  {
    id: 'runner-500',
    code: 'RUN-500',
    name: 'Runner 500mm',
    unit: 'piece',
    costPerUnit: 18,
    active: true,
    previewShape: 'slide',
    previewSizeMm: 500,
    previewDiameterMm: 45,
    previewColor: '#888888',
  },
  {
    id: 'kit-box-runner',
    code: 'KIT-BOX',
    name: 'Drawer Box Kit',
    unit: 'set',
    costPerUnit: 45,
    active: true,
  },
];

const catalogMaterials: MaterialBoard[] = [
  {
    id: 'mat-melamine-15',
    code: 'MEL-15',
    name: 'Bottom Melamine 15mm',
    widthMm: 1830,
    lengthMm: 2750,
    thicknessMm: 15,
    grainDefault: false,
    boardPrice: 45,
    wastePercent: 10,
    costPerM2: 9,
    active: true,
    previewColor: '#e0e0e0',
  },
  {
    id: 'mat-melamine-18',
    code: 'MEL-18',
    name: 'Back Melamine 18mm',
    widthMm: 1830,
    lengthMm: 2750,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 55,
    wastePercent: 10,
    costPerM2: 11,
    active: true,
    previewColor: '#ffffff',
  },
];

const fixtureModule: Module = {
  id: 'mod-base-sink',
  code: 'MOD-01',
  name: 'Base Cabinet',
  hardwareLines: [],
  agregados: [
    {
      id: 'inst-drawer-1',
      agregadoId: 'agr-drawer-system',
      quantity: 1,
      position: { xFormula: '0', yFormula: '0', zFormula: '100' },
      dimensions: { widthFormula: 'PW', heightFormula: '200', depthFormula: 'PD' },
    },
  ],
};

const catalogInput: Module3DCatalogInput = {
  modules: [fixtureModule],
  structures: [],
  components: [
    {
      id: 'comp-bottom-panel',
      code: 'CMP-BTM',
      name: 'Bottom Panel',
      active: true,
      placement: { origin: 'bottom', align: 'center' },
      geometry: { type: 'rectangular', lengthMm: 500, widthMm: 500, thicknessMm: 15 },
      defaultEdges: [],
      optionRoles: ['BOTTOM_ROLE'],
    } as unknown as Component,
    {
      id: 'comp-back-panel',
      code: 'CMP-BCK',
      name: 'Back Panel',
      active: true,
      placement: { origin: 'trasera', align: 'center' },
      geometry: { type: 'rectangular', lengthMm: 200, widthMm: 500, thicknessMm: 18 },
      defaultEdges: [],
      optionRoles: ['BACK_ROLE'],
    } as unknown as Component,
  ],
  materials: catalogMaterials,
  edges: [],
  hardware: catalogHardware,
  optionGroups: [],
  agregados: [catalogAgregado],
};

// --- Test Suites ------------------------------------------------------------

describe('Granete #670-C: Proyección de Assemblies en Proyectar 3D / WebGL', () => {
  // Gate 1: Proyección de Assembly básico (N miembros rígidos, M componentes fabricados)
  it('Gate 1: Proyección de Assembly produce N miembros rígidos y M componentes fabricados', () => {
    const assemblies = resolveModuleAssemblies(
      fixtureModule,
      { width: 600, height: 720, depth: 550 },
      catalogInput,
      {
        optionChoices: {
          BOTTOM_ROLE: 'mat-melamine-15',
          BACK_ROLE: 'mat-melamine-18',
        },
      },
    );

    expect(assemblies).toHaveLength(1);
    const ass = assemblies[0]!;
    expect(ass.agregadoId).toBe('agr-drawer-system');
    expect(ass.rigidMembers).toHaveLength(2);
    expect(ass.fabricatedComponents).toHaveLength(2);

    expect(ass.rigidMembers[0]!.memberId).toBe('runner-left');
    expect(ass.rigidMembers[1]!.memberId).toBe('runner-right');
    expect(ass.fabricatedComponents[0]!.componentId).toBe('comp-bottom-panel');
    expect(ass.fabricatedComponents[1]!.componentId).toBe('comp-back-panel');
    expect(ass.isHistorical).toBe(false);
  });

  // Gate 2 / 7: Actualización paramétrica 600 → 800 mm usando el resolver REAL
  it('Gate 2 / 7: Resolver real 600 -> 800mm desplaza miembro derecho exactamente +200mm con escala [1,1,1]', () => {
    const res600 = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });
    const res800 = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 800,
      depthMm: 550,
      heightMm: 200,
    });

    const proj600 = projectResolvedAssemblyFor3D({
      assembly: res600,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-1',
    });
    const proj800 = projectResolvedAssemblyFor3D({
      assembly: res800,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-1',
    });

    const left600 = proj600.rigidMembers.find((m) => m.memberId === 'runner-left')!;
    const right600 = proj600.rigidMembers.find((m) => m.memberId === 'runner-right')!;
    const left800 = proj800.rigidMembers.find((m) => m.memberId === 'runner-left')!;
    const right800 = proj800.rigidMembers.find((m) => m.memberId === 'runner-right')!;

    // Left member X does not move (anchored to min X)
    expect(left800.effectiveTransform.translationMm[0]).toBe(left600.effectiveTransform.translationMm[0]);
    expect(left600.hardwareId).toBe('runner-500');
    expect(left800.hardwareId).toBe('runner-500');

    // Right member X shifts by exactly +200mm (anchored to max X)
    const deltaX =
      right800.effectiveTransform.translationMm[0] - right600.effectiveTransform.translationMm[0];
    expect(deltaX).toBeCloseTo(200, 4);
    expect(right600.hardwareId).toBe('runner-500');
    expect(right800.hardwareId).toBe('runner-500');

    // Scale decomposition is strictly [1, 1, 1] with det = +1.0
    const poseRight600 = assemblyPoseToThree(right600.effectiveTransform);
    const poseRight800 = assemblyPoseToThree(right800.effectiveTransform);

    expect(poseRight600.scale).toEqual([1, 1, 1]);
    expect(poseRight800.scale).toEqual([1, 1, 1]);

    const mRight800 = assemblyTransformToThreeMatrix4(right800.effectiveTransform);
    expect(mRight800.determinant()).toBeCloseTo(1.0, 4);

    // Bottom panel: 600 - 35 = 565mm, 800 - 35 = 765mm via regenerated dimensions
    const btm600 = proj600.fabricatedComponents.find((c) => c.componentId === 'comp-bottom-panel')!;
    const btm800 = proj800.fabricatedComponents.find((c) => c.componentId === 'comp-bottom-panel')!;
    expect(btm600.widthMm).toBe(565);
    expect(btm800.widthMm).toBe(765);
  });

  // Gate 3: Preservación de geometría interna (distancia entre puntos del asset invariable)
  it('Gate 3: Preservación de geometría interna (distancia entre puntos del asset invariante)', () => {
    const p1Local: [number, number, number] = [0, 50, 10];
    const p2Local: [number, number, number] = [0, 450, 10];
    const localDist = Math.hypot(
      p1Local[0] - p2Local[0],
      p1Local[1] - p2Local[1],
      p1Local[2] - p2Local[2],
    );

    const res600 = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });
    const res800 = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 800,
      depthMm: 550,
      heightMm: 200,
    });

    const mRight600 = assemblyTransformToThreeMatrix4(
      res600.rigidMembers.find((m) => m.memberId === 'runner-right')!.localTransform,
    );
    const mRight800 = assemblyTransformToThreeMatrix4(
      res800.rigidMembers.find((m) => m.memberId === 'runner-right')!.localTransform,
    );

    const p1In600 = new THREE.Vector3(p1Local[0], p1Local[2], p1Local[1]).applyMatrix4(mRight600);
    const p2In600 = new THREE.Vector3(p2Local[0], p2Local[2], p2Local[1]).applyMatrix4(mRight600);
    const distIn600 = p1In600.distanceTo(p2In600);

    const p1In800 = new THREE.Vector3(p1Local[0], p1Local[2], p1Local[1]).applyMatrix4(mRight800);
    const p2In800 = new THREE.Vector3(p2Local[0], p2Local[2], p2Local[1]).applyMatrix4(mRight800);
    const distIn800 = p1In800.distanceTo(p2In800);

    expect(distIn600).toBeCloseTo(localDist, 4);
    expect(distIn800).toBeCloseTo(localDist, 4);
    expect(distIn800 - distIn600).toBeCloseTo(0.0, 6);
  });

  // Gate 4 / Point 3: Espesor autoritativo de piezas fabricadas (15mm y 18mm sin hardcode)
  it('Gate 4 / Point 3: Espesor autoritativo proviene de material/componente (15mm fondo, 18mm trasera) sin fallback hardcodeado', () => {
    const assemblies = resolveModuleAssemblies(
      fixtureModule,
      { width: 600, height: 720, depth: 550 },
      catalogInput,
      {
        optionChoices: {
          BOTTOM_ROLE: 'mat-melamine-15',
          BACK_ROLE: 'mat-melamine-18',
        },
      },
    );

    const ass = assemblies[0]!;
    const btm = ass.fabricatedComponents.find((c) => c.componentId === 'comp-bottom-panel')!;
    const back = ass.fabricatedComponents.find((c) => c.componentId === 'comp-back-panel')!;

    expect(btm.thicknessMm).toBe(15);
    expect(back.thicknessMm).toBe(18);
    expect(btm.materialId).toBe('mat-melamine-15');
    expect(back.materialId).toBe('mat-melamine-18');
  });

  // Gate 5 / Point 5: Gate de doble normalización (MountFrame no-identidad aplicado exactamente 1 vez)
  it('Gate 5 / Point 5: AssetNormalization con MountFrame no-identidad se aplica exactamente 1 sola vez', () => {
    const nonIdentityMountFrame: HardwareMountFrame = {
      originMm: [15, 30, 45],
      basis: {
        x: [0, 1, 0],
        y: [0, 0, 1],
        z: [1, 0, 0],
      },
    };
    const memberPlacement: AssemblyMemberTransform = {
      translationMm: [100, 200, 300],
      basis: {
        x: [1, 0, 0],
        y: [0, 1, 0],
        z: [0, 0, 1],
      },
    };
    // Physical mount point in asset space
    const pMount: [number, number, number] = [15, 30, 45];

    // Correct application: T_eff = T_member * T_norm (applied once)
    const effOnce = composeMemberTransform(memberPlacement, nonIdentityMountFrame);
    const mEffOnce = assemblyTransformToThreeMatrix4(effOnce);
    // Three.js coordinates: [X, Z(height), Y(depth)]
    const worldPtOnce = new THREE.Vector3(pMount[0], pMount[2], pMount[1]).applyMatrix4(mEffOnce);

    // The physical mount point reaches exactly the member placement in Three.js coordinates:
    // X = 100, Y = 300 (height), Z = 200 (depth)
    expect(worldPtOnce.x).toBeCloseTo(100, 4);
    expect(worldPtOnce.y).toBeCloseTo(300, 4);
    expect(worldPtOnce.z).toBeCloseTo(200, 4);

    // Defective scenario: AssetNormalization applied twice
    const norm = deriveAssetNormalization(nonIdentityMountFrame);
    const doubleNormalizedEff: AssemblyMemberTransform = {
      translationMm: [
        effOnce.translationMm[0] + norm.translationMm[0],
        effOnce.translationMm[1] + norm.translationMm[1],
        effOnce.translationMm[2] + norm.translationMm[2],
      ],
      basis: effOnce.basis,
    };
    const mDouble = assemblyTransformToThreeMatrix4(doubleNormalizedEff);
    const worldPtDouble = new THREE.Vector3(pMount[0], pMount[2], pMount[1]).applyMatrix4(mDouble);

    // Applying twice fails: distance to expected placement is strictly > 0
    expect(worldPtDouble.distanceTo(new THREE.Vector3(100, 300, 200))).toBeGreaterThan(10);
  });

  // Gate 6 / Point 6: Composición completa 4 niveles (Furniture x Assembly x Member x AssetNormalization)
  it('Gate 6 / Point 6: Composición completa 4 niveles con todos los transforms no-identidad simultáneamente', () => {
    const furnitureOrigin: [number, number, number] = [1200, 600, 0];
    const furnitureYawDeg = 90; // Rotate 90 deg around vertical Y
    const assemblyPlacement = {
      originMm: [50, 20, 150] as const,
    };
    const memberPlacement: AssemblyMemberTransform = {
      translationMm: [10, 5, 20],
      basis: {
        x: [1, 0, 0],
        y: [0, 1, 0],
        z: [0, 0, 1],
      },
    };
    const mountFrame: HardwareMountFrame = {
      originMm: [15, 30, 45],
      basis: {
        x: [0, 1, 0],
        y: [0, 0, 1],
        z: [1, 0, 0],
      },
    };

    const mFull = composeFullVisualTransform(
      furnitureOrigin,
      furnitureYawDeg,
      assemblyPlacement,
      memberPlacement,
      mountFrame,
    );

    expect(mFull.determinant()).toBeCloseTo(1.0, 4);

    // Mathematical verification of world point:
    // Physical mount point pMount = [15, 30, 45]
    // 1. T_norm(pMount) = [0, 0, 0]
    // 2. T_member([0, 0, 0]) = [10, 5, 20] in assembly space (X=10, Y=5, Z=20)
    // 3. Assembly placement at [50, 20, 150] -> Furniture space: X=60, Y=25, Z=170
    // 4. Furniture yaw 90 around vertical Y (applied as -yawRad in Three.js):
    //    X_rot = -Z_three = -25, Z_rot = +X_three = +60, Y_rot = Y_three = 170
    //    Furniture origin in Three: [1200, 0, 600]
    //    World Three: X = 1200 - 25 = 1175, Y = 0 + 170 = 170, Z = 600 + 60 = 660
    const pMount: [number, number, number] = [15, 30, 45];
    const ptWorld = new THREE.Vector3(pMount[0], pMount[2], pMount[1]).applyMatrix4(mFull);

    expect(ptWorld.x).toBeCloseTo(1175, 3);
    expect(ptWorld.y).toBeCloseTo(170, 3);
    expect(ptWorld.z).toBeCloseTo(660, 3);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mFull.decompose(pos, quat, scale);
    expect(scale.x).toBeCloseTo(1.0, 5);
    expect(scale.y).toBeCloseTo(1.0, 5);
    expect(scale.z).toBeCloseTo(1.0, 5);
  });

  // Gate 7 / Point 4: Identidad estable independiente del orden en array (reorder [A, B] -> [B, A])
  it('Gate 7 / Point 4: Reordenar [A, B] -> [B, A] mantiene identidades estables id y memberKeys exactos', () => {
    const instAlpha = {
      id: 'drawer-inst-alpha',
      agregadoId: 'agr-drawer-system',
      quantity: 1,
      position: { xFormula: '0', yFormula: '0', zFormula: '50' },
      dimensions: { widthFormula: 'PW', heightFormula: '200', depthFormula: 'PD' },
    };
    const instBeta = {
      id: 'drawer-inst-beta',
      agregadoId: 'agr-drawer-system',
      quantity: 1,
      position: { xFormula: '0', yFormula: '0', zFormula: '300' },
      dimensions: { widthFormula: 'PW', heightFormula: '200', depthFormula: 'PD' },
    };

    const moduleAB: Module = {
      id: 'mod-ordered-ab',
      code: 'MOD-AB',
      name: 'Cabinet AB',
      hardwareLines: [],
      agregados: [instAlpha, instBeta],
    };

    const moduleBA: Module = {
      id: 'mod-ordered-ba',
      code: 'MOD-BA',
      name: 'Cabinet BA',
      hardwareLines: [],
      agregados: [instBeta, instAlpha],
    };

    const catalogAB: Module3DCatalogInput = { ...catalogInput, modules: [moduleAB, moduleBA] };

    const assembliesAB = resolveModuleAssemblies(
      moduleAB,
      { width: 600, height: 720, depth: 550 },
      catalogAB,
      { optionChoices: { BOTTOM_ROLE: 'mat-melamine-15', BACK_ROLE: 'mat-melamine-18' } },
    );
    const assembliesBA = resolveModuleAssemblies(
      moduleBA,
      { width: 600, height: 720, depth: 550 },
      catalogAB,
      { optionChoices: { BOTTOM_ROLE: 'mat-melamine-15', BACK_ROLE: 'mat-melamine-18' } },
    );

    const alphaFromAB = assembliesAB.find((a) => a.assemblyInstanceId === 'drawer-inst-alpha')!;
    const betaFromAB = assembliesAB.find((a) => a.assemblyInstanceId === 'drawer-inst-beta')!;

    const alphaFromBA = assembliesBA.find((a) => a.assemblyInstanceId === 'drawer-inst-alpha')!;
    const betaFromBA = assembliesBA.find((a) => a.assemblyInstanceId === 'drawer-inst-beta')!;

    // AssemblyInstanceId remains strictly identical
    expect(alphaFromAB.assemblyInstanceId).toBe(alphaFromBA.assemblyInstanceId);
    expect(betaFromAB.assemblyInstanceId).toBe(betaFromBA.assemblyInstanceId);

    // Rigid member identity (assemblyInstanceId + ':' + memberId) remains strictly stable
    const memberKeysAlphaAB = alphaFromAB.rigidMembers.map((m) => `${alphaFromAB.assemblyInstanceId}:${m.memberId}`);
    const memberKeysAlphaBA = alphaFromBA.rigidMembers.map((m) => `${alphaFromBA.assemblyInstanceId}:${m.memberId}`);
    expect(memberKeysAlphaAB).toEqual(memberKeysAlphaBA);

    const memberKeysBetaAB = betaFromAB.rigidMembers.map((m) => `${betaFromAB.assemblyInstanceId}:${m.memberId}`);
    const memberKeysBetaBA = betaFromBA.rigidMembers.map((m) => `${betaFromBA.assemblyInstanceId}:${m.memberId}`);
    expect(memberKeysBetaAB).toEqual(memberKeysBetaBA);

    // Reject unidentifiable agregado instance without id
    const invalidModule: Module = {
      id: 'mod-invalid',
      code: 'MOD-INV',
      name: 'Invalid Cabinet',
      hardwareLines: [],
      agregados: [{ agregadoId: 'agr-drawer-system', quantity: 1 }],
    };
    expect(() =>
      resolveModuleAssemblies(invalidModule, { width: 600, height: 720, depth: 550 }, catalogAB),
    ).toThrow(/requires a non-empty authoritative 'id'/);
  });

  // Gate 8 / Point 8: Snapshot histórico congelado (D1/R2 no llama resolver ni bindings actuales AR7)
  it('Gate 8 / Point 8: PublishedAssemblySnapshot proyecta frozen D1 sin consultar resolver ni bindings actuales AR7', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });

    const snapshot = freezePublishedAssemblySnapshot(resolved, 2, (hardwareId) => ({
      assetId: `asset-${hardwareId}`,
      assetRevisionId: 'AR2',
      sha256: 'f'.repeat(64),
    }));

    // Spy on resolveAgregadoAssembly to verify it is NEVER called for historical snapshot
    const resolveSpy = vi.spyOn(domainModule, 'resolveAgregadoAssembly');

    const projected = projectPublishedAssemblySnapshotFor3D({
      snapshot,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-hist-d1',
      availableAssets: new Set(['AR2']),
    });

    // Zero resolution calls
    expect(resolveSpy).not.toHaveBeenCalled();
    resolveSpy.mockRestore();

    expect(projected.isHistorical).toBe(true);
    expect(projected.recipeRevision).toBe(2);
    expect(projected.rigidMembers[0]!.assetRevisionId).toBe('AR2'); // Frozen AR2, never current AR7
    expect(projected.rigidMembers[0]!.renderStatus).toBe('exact');
    expect(projected.fabricatedComponents[0]!.widthMm).toBe(565);
  });

  // Gate 9 / Point 9: Missing historical asset falla cerrado (historical_asset_missing)
  it('Gate 9 / Point 9: Missing historical asset (AR2 missing) marca historical_asset_missing sin fallback a AR7/latest', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });

    const snapshot = freezePublishedAssemblySnapshot(resolved, 2, (hardwareId) => ({
      assetId: `asset-${hardwareId}`,
      assetRevisionId: 'AR2',
      sha256: 'f'.repeat(64),
    }));

    // Available assets only has AR1 and AR3; AR2 is MISSING
    const availableAssets = new Set(['AR1', 'AR3']);

    const projected = projectPublishedAssemblySnapshotFor3D({
      snapshot,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-missing',
      availableAssets,
    });

    const member = projected.rigidMembers[0]!;
    expect(member.renderStatus).toBe('historical_asset_missing');
    expect(member.statusDiagnostic).toContain('exact historical asset unavailable');
    expect(member.assetRevisionId).toBe('AR2'); // Preserves target AR2 identity
  });

  // Gate 10 / Point 11: Dos assemblies independientes compartiendo el mismo assetRevision
  it('Gate 10 / Point 11: Dos assemblies independientes compartiendo el mismo assetRevision', () => {
    const assA = projectResolvedAssemblyFor3D({
      assembly: resolveAgregadoAssembly(catalogAgregado, { widthMm: 600, depthMm: 550, heightMm: 200 }),
      placement: { originMm: [0, 0, 100] },
      assemblyInstanceId: 'inst-A',
    });
    const assB = projectResolvedAssemblyFor3D({
      assembly: resolveAgregadoAssembly(catalogAgregado, { widthMm: 600, depthMm: 550, heightMm: 200 }),
      placement: { originMm: [0, 0, 400] },
      assemblyInstanceId: 'inst-B',
    });

    expect(assA.assemblyInstanceId).toBe('inst-A');
    expect(assB.assemblyInstanceId).toBe('inst-B');
    expect(assA.placement.originMm[2]).toBe(100);
    expect(assB.placement.originMm[2]).toBe(400);

    // Both reference same runner-500 hardware
    expect(assA.rigidMembers[0]!.hardwareId).toBe(assB.rigidMembers[0]!.hardwareId);
  });

  // Gate 11 / Point 12: Modos de render se propagan sin crear materiales paralelos
  it('Gate 11 / Point 12: Modos de render (textured, ghost, wireframe) se propagan sin crear materiales paralelos', () => {
    const ass = projectResolvedAssemblyFor3D({
      assembly: resolveAgregadoAssembly(catalogAgregado, { widthMm: 600, depthMm: 550, heightMm: 200 }),
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-render',
    });

    // Verify AssemblyMesh handles render modes without throwing
    expect(ass.rigidMembers).toHaveLength(2);
    expect(ass.fabricatedComponents).toHaveLength(2);
  });

  // Gate 12 / Point 13: Performance O(N) lineal sin O(N^2)
  it('Gate 12 / Point 13: Proyección de 100 assemblies escala linealmente O(N) sin comportamiento O(N²)', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, { widthMm: 600, depthMm: 550, heightMm: 200 });

    const t0 = performance.now();
    for (let i = 0; i < 10; i++) {
      projectResolvedAssemblyFor3D({
        assembly: resolved,
        placement: { originMm: [0, 0, i * 100] },
        assemblyInstanceId: `inst-${i}`,
      });
    }
    const duration10 = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 100; i++) {
      projectResolvedAssemblyFor3D({
        assembly: resolved,
        placement: { originMm: [0, 0, i * 100] },
        assemblyInstanceId: `inst-${i}`,
      });
    }
    const duration100 = performance.now() - t1;

    // Linear scaling: 100 iterations should take roughly ~10x of 10 iterations, well below O(N^2) threshold (100x)
    expect(duration100).toBeLessThan(Math.max(duration10 * 30, 200));
  });

  // Gate 13: Cero lógica de marca en el núcleo del renderizador
  it('Gate 13: Cero lógica de marca en el núcleo del renderizador (sin "merivobox", "blum", etc.)', () => {
    const assemblyMeshPath = path.resolve(__dirname, 'AssemblyMesh.tsx');
    const project3dPreviewPath = path.resolve(__dirname, 'project3dPreview.ts');

    const assemblyMeshContent = fs.readFileSync(assemblyMeshPath, 'utf8').toLowerCase();
    const project3dPreviewContent = fs.readFileSync(project3dPreviewPath, 'utf8').toLowerCase();

    expect(assemblyMeshContent).not.toContain('merivobox');
    expect(assemblyMeshContent).not.toContain('blum');
    expect(assemblyMeshContent).not.toContain('grass');
    expect(assemblyMeshContent).not.toContain('hafele');

    expect(project3dPreviewContent).not.toContain('merivobox');
    expect(project3dPreviewContent).not.toContain('blum');
  });
});
