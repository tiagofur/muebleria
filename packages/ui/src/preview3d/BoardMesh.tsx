import { Suspense, type ReactNode } from 'react';
import type { Hardware, HardwarePlacement, ResolvedHardwarePlacement } from '@granete/domain';
import { Edges } from '@react-three/drei';
import type { BoardPartVisual } from './boardPartVisual';
import { HardwareMesh } from './HardwareMesh';
import { HardwarePlacementGizmo, pickGizmoPlacement } from './HardwarePlacementGizmo';
import { BoardMeshMaterial } from './BoardMeshMaterial';
import { DEFAULT_SCENE_LIGHTING_MODE, type SceneLightingMode } from './sceneLighting';

export type BoardMeshProps = {
  readonly visual: BoardPartVisual;
  readonly showWireframe?: boolean;
  readonly showOutlines?: boolean;
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly onSelect?: (partId: string) => void;
  readonly lightingMode?: SceneLightingMode;
  readonly hardwarePlacements?: readonly ResolvedHardwarePlacement[];
  readonly hardwareCatalog?: Readonly<Map<string, Hardware>>;
  readonly hardwareSelectedId?: string | null;
  readonly onSelectHardwareId?: (hardwareId: string) => void;
  readonly gizmoRawPlacement?: HardwarePlacement;
  readonly onGizmoPlacementChange?: (patch: Partial<HardwarePlacement>) => void;
};

export function BoardMesh({
  visual,
  showWireframe = false,
  showOutlines = false,
  selected = false,
  dimmed = false,
  onSelect,
  lightingMode = DEFAULT_SCENE_LIGHTING_MODE,
  hardwarePlacements,
  hardwareCatalog,
  hardwareSelectedId,
  onSelectHardwareId,
  gizmoRawPlacement,
  onGizmoPlacementChange,
}: BoardMeshProps): ReactNode {
  const [w, t, l] = visual.size;
  const transparent = showWireframe || dimmed;
  const opacity = dimmed ? 0.12 : showWireframe ? 0.3 : 1;
  const showEdges = showOutlines || showWireframe || selected;
  const edgeColor = selected
    ? '#f5c542'
    : showWireframe
      ? visual.color
      : '#000000';
  const handleMeshes =
    hardwarePlacements && hardwarePlacements.length > 0 && hardwareCatalog
      ? hardwarePlacements.map((placement) => {
          const hardware = hardwareCatalog.get(placement.hardwareId);
          if (!hardware) return null;
          const hardwareId = `${placement.componentInstanceId}:${placement.hardwareId}`;
          return (
            <HardwareMesh
              key={`${visual.id}:${placement.hardwareId}:${placement.componentInstanceId}`}
              placement={placement}
              hardware={hardware}
              lightingMode={lightingMode}
              selected={hardwareSelectedId === hardwareId}
              onSelect={
                onSelectHardwareId ? () => onSelectHardwareId(hardwareId) : undefined
              }
            />
          );
        })
      : null;

  const showGizmo =
    selected && pickGizmoPlacement(selected, hardwarePlacements ?? []);
  const gizmoAnchor = hardwarePlacements?.[0];

  return (
    <group position={visual.position} rotation={visual.rotation}>
      {showGizmo && gizmoAnchor ? (
        <group position={gizmoAnchor.localPosition}>
          <HardwarePlacementGizmo
            placement={
              gizmoRawPlacement ?? {
                hardwareId: gizmoAnchor.hardwareId,
                anchorFace: 'front',
                relativePosition: {
                  xMm: gizmoAnchor.localPosition[0],
                  yMm: gizmoAnchor.localPosition[2],
                },
              }
            }
            anchorFace={gizmoRawPlacement?.anchorFace ?? 'front'}
            boardWidthMm={visual.size[0]}
            boardHeightMm={visual.size[2]}
            snapMm={32}
            onChangePlacement={onGizmoPlacementChange}
          />
        </group>
      ) : null}
      <mesh
        position={[w / 2, t / 2, l / 2]}
        castShadow={!showWireframe && !dimmed}
        receiveShadow={!showWireframe && !dimmed}
        userData={{
          partId: visual.id,
          description: visual.description,
          optionRole: visual.optionRole,
        }}
        onClick={(e) => {
          if (!onSelect) return;
          e.stopPropagation();
          onSelect(visual.id);
        }}
        onPointerOver={
          onSelect
            ? (e) => {
                e.stopPropagation();
                if (typeof document !== 'undefined') {
                  document.body.style.cursor = 'pointer';
                }
              }
            : undefined
        }
        onPointerOut={
          onSelect
            ? () => {
                if (typeof document !== 'undefined') {
                  document.body.style.cursor = 'auto';
                }
              }
            : undefined
        }
      >
        <boxGeometry args={[w, t, l]} />
        <Suspense
          fallback={
            <meshStandardMaterial
              color={visual.color}
              transparent={transparent}
              opacity={opacity}
              depthWrite={!transparent}
              roughness={0.55}
              metalness={0.04}
            />
          }
        >
          <BoardMeshMaterial
            key={`${visual.id}:${visual.textureUrl ?? ''}:${visual.grain}:${visual.color}:${lightingMode}`}
            visual={visual}
            selected={selected}
            transparent={transparent}
            opacity={opacity}
            lightingMode={lightingMode}
          />
        </Suspense>
        {showEdges ? (
          <Edges scale={1} threshold={15} color={edgeColor} />
        ) : null}
      </mesh>
      {handleMeshes}
    </group>
  );
}
