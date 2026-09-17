/**
 * Assembly Projection in Proyectar 3D / WebGL Test Suite (C1 - C12)
 * Issue: #670-C
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import type {
  Agregado,
  AgregadoAssemblyInput,
  Component,
  Hardware,
  MaterialBoard,
  Module,
  Project,
  ProjectItem,
  PublishedAssemblySnapshot,
  ResolvedAssembly,
} from '@granete/domain';
import {
  deriveAssetNormalization,
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
    id: 'mat-melamine-16',
    code: 'MEL-16',
    name: 'White Melamine 16mm',
    widthMm: 1830,
    lengthMm: 2750,
    thicknessMm: 16,
    grainDefault: false,
    boardPrice: 50,
    wastePercent: 10,
    costPerM2: 10,
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
      geometry: { type: 'rectangular' },
      defaultEdges: [],
      optionRoles: ['INTERIOR'],
    } as unknown as Component,
  ],
  materials: catalogMaterials,
  edges: [],
  hardware: catalogHardware,
  optionGroups: [],
  agregados: [catalogAgregado],
};

// --- Test Suites C1 through C12 ---------------------------------------------

describe('Granete #670-C: Proyección de Assemblies en Proyectar 3D / WebGL', () => {
  // C1: Proyección de Assembly básico (N miembros rígidos, M componentes fabricados)
  it('C1: Proyección de Assembly produce N miembros rígidos y M componentes fabricados', () => {
    const assemblies = resolveModuleAssemblies(
      fixtureModule,
      { width: 600, height: 720, depth: 550 },
      catalogInput,
    );

    expect(assemblies).toHaveLength(1);
    const ass = assemblies[0]!;
    expect(ass.agregadoId).toBe('agr-drawer-system');
    expect(ass.rigidMembers).toHaveLength(2);
    expect(ass.fabricatedComponents).toHaveLength(1);

    expect(ass.rigidMembers[0]!.memberId).toBe('runner-left');
    expect(ass.rigidMembers[1]!.memberId).toBe('runner-right');
    expect(ass.fabricatedComponents[0]!.componentId).toBe('comp-bottom-panel');
    expect(ass.isHistorical).toBe(false);
  });

  // C2: Actualización paramétrica 600 → 800 mm usando el resolver real del Incremento A
  it('C2: Actualización paramétrica 600 -> 800mm desplaza miembro derecho exactamente +200mm con escala [1,1,1]', () => {
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

    // Right member X shifts by exactly +200mm (anchored to max X)
    const deltaX =
      right800.effectiveTransform.translationMm[0] - right600.effectiveTransform.translationMm[0];
    expect(deltaX).toBeCloseTo(200, 4);

    // Three.js pose decomposition guarantees scale = [1, 1, 1]
    const poseRight600 = assemblyPoseToThree(right600.effectiveTransform);
    const poseRight800 = assemblyPoseToThree(right800.effectiveTransform);

    expect(poseRight600.scale).toEqual([1, 1, 1]);
    expect(poseRight800.scale).toEqual([1, 1, 1]);
  });

  // C3: Preservación de geometría interna (distancia entre puntos del asset invariable)
  it('C3: Preservación de geometría interna (distancia entre puntos del asset invariante ante escala del mueble)', () => {
    // Two reference points on the runner asset in local space
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
    expect(distIn800 - distIn600).toBeCloseTo(0.0, 6); // Zero geometric drift
  });

  // C4: Regeneración de piezas fabricadas (reconstruidas dimensionalmente, nunca escaladas)
  it('C4: Regeneración de fondo: ancho pasa de 565mm a 765mm dimensionalmente, espesor preservado', () => {
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

    const btm600 = proj600.fabricatedComponents[0]!;
    const btm800 = proj800.fabricatedComponents[0]!;

    // 600 - 35 = 565mm
    expect(btm600.widthMm).toBe(565);
    // 800 - 35 = 765mm
    expect(btm800.widthMm).toBe(765);

    // Transform scale is [1, 1, 1] — geometry box takes dimensions directly
    const pose600 = assemblyPoseToThree(btm600.transform);
    const pose800 = assemblyPoseToThree(btm800.transform);
    expect(pose600.scale).toEqual([1, 1, 1]);
    expect(pose800.scale).toEqual([1, 1, 1]);
  });

  // C5: Selección determinista de variantes
  it('C5: Selección determinista de variantes: profundidad 450 elige nominal 400mm, 550 elige 500mm', () => {
    const res450 = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 450,
      heightMm: 200,
    });
    const res550 = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });

    expect(res450.selectedVariants[0]!.hardwareId).toBe('runner-400');
    expect(res450.selectedVariants[0]!.nominalDimensionMm).toBe(400);

    expect(res550.selectedVariants[0]!.hardwareId).toBe('runner-500');
    expect(res550.selectedVariants[0]!.nominalDimensionMm).toBe(500);
  });

  // C6: Sin mirror por escala negativa (det = +1.0 en todos los miembros rígidos)
  it('C6: Sin mirror por escala negativa (det = +1.0 en todos los miembros rígidos)', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });
    const projected = projectResolvedAssemblyFor3D({
      assembly: resolved,
      placement: { originMm: [100, 200, 300] },
      assemblyInstanceId: 'inst-test',
    });

    for (const member of projected.rigidMembers) {
      const m = assemblyTransformToThreeMatrix4(member.effectiveTransform);
      const det = m.determinant();
      expect(det).toBeCloseTo(1.0, 4);

      const pose = assemblyPoseToThree(member.effectiveTransform);
      expect(pose.scale).toEqual([1, 1, 1]);
    }
  });

  // C7: Dos instancias de assembly en el mismo mueble
  it('C7: Dos instancias de assembly en el mismo mueble resuelven con transforms independientes', () => {
    const multiModule: Module = {
      id: 'mod-2-drawers',
      code: 'MOD-02',
      name: '2-Drawer Cabinet',
      hardwareLines: [],
      agregados: [
        {
          id: 'drawer-stack',
          agregadoId: 'agr-drawer-system',
          quantity: 2,
          layoutDirection: 'vertical',
          gapMm: 10,
          position: { xFormula: '0', yFormula: '0', zFormula: '50' },
          dimensions: { widthFormula: 'PW', heightFormula: '600', depthFormula: 'PD' },
        },
      ],
    };

    const catalogMulti: Module3DCatalogInput = {
      ...catalogInput,
      modules: [multiModule],
    };

    const assemblies = resolveModuleAssemblies(
      multiModule,
      { width: 600, height: 720, depth: 550 },
      catalogMulti,
    );

    expect(assemblies).toHaveLength(2);
    expect(assemblies[0]!.assemblyInstanceId).toBe('drawer-stack-u0');
    expect(assemblies[1]!.assemblyInstanceId).toBe('drawer-stack-u1');

    // Drawer 0 at Z=50, Drawer 1 stacked vertically above
    expect(assemblies[0]!.placement.originMm[2]).toBe(50);
    expect(assemblies[1]!.placement.originMm[2]).toBeGreaterThan(assemblies[0]!.placement.originMm[2]);
  });

  // C8: Composición de transformaciones de mueble (T_furniture * T_assembly * T_member * T_norm)
  it('C8: Composición de transformaciones de mueble: evalúa producto de 4 niveles sin distorsión', () => {
    const furnitureOrigin: [number, number, number] = [1000, 500, 0];
    const furnitureYawDeg = 90; // Kitchen rotated run
    const assemblyPlacement = {
      originMm: [50, 20, 100] as const,
    };
    const memberTransform = {
      translationMm: [0, 10, 5] as const,
      basis: {
        x: [1, 0, 0] as const,
        y: [0, 1, 0] as const,
        z: [0, 0, 1] as const,
      },
    };
    const mountFrame = {
      originMm: [10, 0, 5] as const,
      basis: {
        x: [1, 0, 0] as const,
        y: [0, 1, 0] as const,
        z: [0, 0, 1] as const,
      },
    };

    const mFull = composeFullVisualTransform(
      furnitureOrigin,
      furnitureYawDeg,
      assemblyPlacement,
      memberTransform,
      mountFrame,
    );

    expect(mFull.determinant()).toBeCloseTo(1.0, 4);

    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    mFull.decompose(pos, quat, scale);

    // Scaling is strictly 1.0 on all axes
    expect(scale.x).toBeCloseTo(1.0, 5);
    expect(scale.y).toBeCloseTo(1.0, 5);
    expect(scale.z).toBeCloseTo(1.0, 5);
  });

  // C9: Snapshot histórico congelado (conserva visual pins exactos)
  it('C9: Snapshot histórico congelado preserva visual pins exactos sin re-resolver', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });

    const snapshot = freezePublishedAssemblySnapshot(resolved, 3, (hardwareId) => ({
      assetId: `asset-${hardwareId}`,
      assetRevisionId: `rev-hash-${hardwareId}`,
      sha256: 'a'.repeat(64),
      mountFrame: {
        originMm: [5, 10, 15],
        basis: {
          x: [1, 0, 0],
          y: [0, 1, 0],
          z: [0, 0, 1],
        },
      },
    }));

    const availableAssets = new Set([
      'rev-hash-runner-500',
    ]);

    const projected = projectPublishedAssemblySnapshotFor3D({
      snapshot,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-hist-1',
      availableAssets,
    });

    expect(projected.isHistorical).toBe(true);
    expect(projected.recipeRevision).toBe(3);
    expect(projected.rigidMembers[0]!.renderStatus).toBe('exact');
    expect(projected.rigidMembers[0]!.assetRevisionId).toBe('rev-hash-runner-500');
  });

  // C10: Missing historical asset fails closed (historical_asset_missing)
  it('C10: Missing historical asset falla cerrado (renderStatus = historical_asset_missing, sin fallback a latest)', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });

    const snapshot = freezePublishedAssemblySnapshot(resolved, 1, (hardwareId) => ({
      assetId: `asset-${hardwareId}`,
      assetRevisionId: `rev-hash-${hardwareId}`,
      sha256: 'b'.repeat(64),
    }));

    // availableAssets is EMPTY (asset missing from local store/cache)
    const availableAssets = new Set<string>();

    const projected = projectPublishedAssemblySnapshotFor3D({
      snapshot,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-missing',
      availableAssets,
    });

    expect(projected.rigidMembers[0]!.renderStatus).toBe('historical_asset_missing');
    expect(projected.rigidMembers[0]!.statusDiagnostic).toContain('exact historical asset unavailable');
  });

  // C11: Identidad estable independiente del orden en array
  it('C11: Identidad estable: la identidad de los miembros se basa en memberId, no en el índice del array', () => {
    const resolved = resolveAgregadoAssembly(catalogAgregado, {
      widthMm: 600,
      depthMm: 550,
      heightMm: 200,
    });

    const reversedResolved: ResolvedAssembly = {
      ...resolved,
      rigidMembers: [...resolved.rigidMembers].reverse(),
    };

    const projNormal = projectResolvedAssemblyFor3D({
      assembly: resolved,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-1',
    });

    const projReversed = projectResolvedAssemblyFor3D({
      assembly: reversedResolved,
      placement: { originMm: [0, 0, 0] },
      assemblyInstanceId: 'inst-1',
    });

    const leftFromNormal = projNormal.rigidMembers.find((m) => m.memberId === 'runner-left')!;
    const leftFromReversed = projReversed.rigidMembers.find((m) => m.memberId === 'runner-left')!;

    expect(leftFromNormal.effectiveTransform).toEqual(leftFromReversed.effectiveTransform);
  });

  // C12: Cero lógica de marca en el núcleo del renderizador
  it('C12: Cero lógica de marca en el núcleo del renderizador (sin "merivobox", "blum" en AssemblyMesh.tsx o project3dPreview.ts)', () => {
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
