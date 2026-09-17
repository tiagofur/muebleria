import { type ReactNode } from 'react';
import * as THREE from 'three';
import type {
  AssemblyMemberTransform,
  Hardware,
  HardwareMountFrame,
  ProjectedAssembly,
  ProjectedFabricatedComponent,
  ProjectedRigidMember,
} from '@granete/domain';
import {
  composeMemberTransform,
  deriveHardwareBasisFromEuler,
} from '@granete/domain';
import { HardwareMesh } from './HardwareMesh';
import { BoardMesh } from './BoardMesh';
import type { BoardColorMode, BoardPartVisual, MaterialColorLookup, MaterialSurfaceMode, MaterialTextureLookup } from './boardPartVisual';
import { DEFAULT_SCENE_LIGHTING_MODE, type SceneLightingMode } from './sceneLighting';

// --- Pure 3D Transform Mapping Helpers (Workshop <-> Three.js) ----------------

/**
 * Maps a Workshop coordinate transform (X: width, Y: depth, Z: height)
 * into Three.js frame (Three X: width, Three Y: height, Three Z: depth).
 *
 * Coordinate transformation matrix S:
 * S = [ 1 0 0 ]
 *     [ 0 0 1 ]
 *     [ 0 1 0 ]
 * Since det(S) = -1 and S = S^T = S^(-1):
 * M_three = S * M_ws * S
 * det(M_three) = det(S) * det(M_ws) * det(S) = (-1) * (+1) * (-1) = +1.0.
 * Zero shear, zero scaling, right-handedness preserved.
 */
export function assemblyTransformToThreeMatrix4(
  transform: AssemblyMemberTransform,
): THREE.Matrix4 {
  const {
    translationMm: [tx, ty, tz],
    basis: { x, y, z },
  } = transform;

  // Columns in Workshop are x, y, z.
  // After conjugation by S (swapping rows 1 and 2, and columns 1 and 2):
  // Row 0: [x_0, z_0, y_0, tx]
  // Row 1: [x_2, z_2, y_2, tz]
  // Row 2: [x_1, z_1, y_1, ty]
  // Row 3: [0,   0,   0,   1 ]
  const m = new THREE.Matrix4();
  m.set(
    x[0], z[0], y[0], tx,
    x[2], z[2], y[2], tz,
    x[1], z[1], y[1], ty,
    0,    0,    0,    1,
  );
  return m;
}

export type ThreePose = {
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly euler: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
};

export function assemblyPoseToThree(transform: AssemblyMemberTransform): ThreePose {
  const m = assemblyTransformToThreeMatrix4(transform);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  m.decompose(pos, quat, scale);
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');

  return {
    position: [pos.x, pos.y, pos.z],
    quaternion: [quat.x, quat.y, quat.z, quat.w],
    euler: [euler.x, euler.y, euler.z],
    scale: [scale.x, scale.y, scale.z],
  };
}

/**
 * Computes 4-level composition: T_furniture * T_assembly * T_member * T_norm.
 * Pure mathematical helper for C8 verification.
 */
export function composeFullVisualTransform(
  furnitureOriginMm: readonly [number, number, number],
  furnitureYawDeg: number,
  assemblyPlacement: {
    readonly originMm: readonly [number, number, number];
    readonly rotationDeg?: { readonly x?: number; readonly y?: number; readonly z?: number };
  },
  memberTransform: AssemblyMemberTransform,
  mountFrame?: HardwareMountFrame,
): THREE.Matrix4 {
  // 1. Furniture Matrix
  const mFurn = new THREE.Matrix4();
  const yawRad = ((furnitureYawDeg || 0) * Math.PI) / 180;
  mFurn.makeRotationY(-yawRad);
  mFurn.setPosition(furnitureOriginMm[0], furnitureOriginMm[2], furnitureOriginMm[1]);

  // 2. Assembly Placement Matrix
  const mAss = new THREE.Matrix4();
  if (assemblyPlacement.rotationDeg) {
    const basis = deriveHardwareBasisFromEuler(assemblyPlacement.rotationDeg);
    mAss.copy(
      assemblyTransformToThreeMatrix4({
        translationMm: assemblyPlacement.originMm,
        basis,
      }),
    );
  } else {
    mAss.setPosition(
      assemblyPlacement.originMm[0],
      assemblyPlacement.originMm[2],
      assemblyPlacement.originMm[1],
    );
  }

  // 3. Effective Member Transform (T_member * T_norm)
  const effMember = composeMemberTransform(memberTransform, mountFrame);
  const mMember = assemblyTransformToThreeMatrix4(effMember);

  // Full product
  return mFurn.clone().multiply(mAss).multiply(mMember);
}

// --- Component Definition ---------------------------------------------------

export type AssemblyMeshProps = {
  readonly assembly: ProjectedAssembly;
  readonly hardwareCatalog?: Readonly<Map<string, Hardware>> | readonly Hardware[];
  readonly lightingMode?: SceneLightingMode;
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly selected?: boolean;
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly surfaceMode?: MaterialSurfaceMode;
  readonly onSelectMember?: (memberId: string) => void;
  readonly onSelectFabricated?: (componentId: string) => void;
};

function resolveHardwareCatalogMap(
  catalog?: Readonly<Map<string, Hardware>> | readonly Hardware[],
): Readonly<Map<string, Hardware>> {
  if (!catalog) return new Map();
  if (catalog instanceof Map) return catalog as Readonly<Map<string, Hardware>>;
  if (Array.isArray(catalog)) {
    const map = new Map<string, Hardware>();
    for (const h of catalog) {
      map.set(h.id, h);
    }
    return map;
  }
  return catalog as Readonly<Map<string, Hardware>>;
}

export function AssemblyMesh({
  assembly,
  hardwareCatalog,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  showWireframe = false,
  showOutlines = false,
  selected = false,
  onSelectMember,
  onSelectFabricated,
}: AssemblyMeshProps): ReactNode {
  const hwMap = resolveHardwareCatalogMap(hardwareCatalog);

  // Assembly root pose in Three.js coordinates
  const [ox, oy, oz] = assembly.placement.originMm;
  const rootPos: [number, number, number] = [ox, oz, oy];

  let rootQuat: [number, number, number, number] = [0, 0, 0, 1];
  if (assembly.placement.rotationDeg) {
    const basis = deriveHardwareBasisFromEuler(assembly.placement.rotationDeg);
    const pose = assemblyPoseToThree({
      translationMm: [0, 0, 0],
      basis,
    });
    rootQuat = [
      pose.quaternion[0],
      pose.quaternion[1],
      pose.quaternion[2],
      pose.quaternion[3],
    ];
  }

  return (
    <group
      position={rootPos}
      quaternion={rootQuat}
      data-testid={`assembly-${assembly.assemblyInstanceId}`}
      userData={{ assemblyInstanceId: assembly.assemblyInstanceId }}
    >
      {/* 1. Rigid Hardware Members (unscaled purchased hardware) */}
      {assembly.rigidMembers.map((member: ProjectedRigidMember) => {
        if (member.renderStatus === 'historical_asset_missing') {
          // Fail-closed placeholder for missing historical asset
          return (
            <group
              key={`${assembly.assemblyInstanceId}-${member.memberId}`}
              data-testid={`assembly-member-missing-${member.memberId}`}
              userData={{
                assemblyInstanceId: assembly.assemblyInstanceId,
                memberId: member.memberId,
                diagnostic: member.statusDiagnostic,
                renderStatus: 'historical_asset_missing',
              }}
            />
          );
        }

        const pose = assemblyPoseToThree(member.effectiveTransform);
        const hardware: Hardware = hwMap.get(member.hardwareId) ?? {
          id: member.hardwareId,
          code: member.hardwareId,
          name: member.role,
          unit: 'piece',
          costPerUnit: 0,
          active: true,
          previewShape: 'slide' as const,
          previewColor: '#9aa0a6',
        };

        return (
          <group
            key={`${assembly.assemblyInstanceId}-${member.memberId}`}
            position={pose.position as [number, number, number]}
            quaternion={pose.quaternion as [number, number, number, number]}
            scale={[1, 1, 1]}
            data-testid={`assembly-member-${member.memberId}`}
            userData={{
              assemblyInstanceId: assembly.assemblyInstanceId,
              memberId: member.memberId,
              role: member.role,
              hardwareId: member.hardwareId,
              assetRevisionId: member.assetRevisionId,
              renderStatus: member.renderStatus,
            }}
          >
            <HardwareMesh
              placement={{
                componentInstanceId: member.memberId,
                hardwareId: member.hardwareId,
                localPosition: [0, 0, 0],
                localNormal: [0, 1, 0],
                standoffMm: 0,
                rotationDeg: { x: 0, y: 0, z: 0 },
                scale: 1,
              }}
              hardware={hardware}
              lightingMode={lightingMode}
              selected={selected}
              onSelect={
                onSelectMember ? () => onSelectMember(member.memberId) : undefined
              }
            />
          </group>
        );
      })}

      {/* 2. Fabricated Components (recalculated from authoritative dimensions) */}
      {assembly.fabricatedComponents.map((comp: ProjectedFabricatedComponent) => {
        const pose = assemblyPoseToThree(comp.transform);
        const w = comp.widthMm;
        const l = comp.lengthMm;
        const t = comp.thicknessMm;
        if (t === undefined || t <= 0) {
          throw new Error(
            `AssemblyMesh: fabricated component '${comp.componentId}' missing authoritative thicknessMm`,
          );
        }

        const visual: BoardPartVisual = {
          id: `${assembly.assemblyInstanceId}-${comp.componentId}`,
          description: comp.componentId,
          optionRole: 'ASSEMBLY_COMPONENT',
          materialId: comp.materialId ?? 'assembly-material',
          size: [w, t, l],
          position: pose.position as [number, number, number],
          rotation: pose.euler as [number, number, number],
          color: '#c4a574',
          grain: 0,
        };

        return (
          <BoardMesh
            key={`${assembly.assemblyInstanceId}-${comp.componentId}`}
            visual={visual}
            showWireframe={showWireframe}
            showOutlines={showOutlines}
            selected={selected}
            lightingMode={lightingMode}
            onSelect={
              onSelectFabricated
                ? () => onSelectFabricated(comp.componentId)
                : undefined
            }
          />
        );
      })}
    </group>
  );
}
