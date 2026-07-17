/**
 * Generic R3F furniture scene: one or many modules at workshop origins.
 */

import {
  Suspense,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, ContactShadows, OrbitControls } from '@react-three/drei';
import type { ResolvedBoardPart } from '@muebles/domain';
import {
  boardPartsToVisuals,
  sceneFraming,
  type BoardColorMode,
  type BoardPartVisual,
  type MaterialColorLookup,
} from './boardPartVisual';
import './moduleScene3d.css';

export type FurnitureSceneModule = {
  readonly key: string;
  readonly parts: readonly ResolvedBoardPart[];
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  /** Workshop origin (mm): X along run, Y depth, Z height. */
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
  readonly showOuterGhost?: boolean;
};

export type FurnitureScene3DProps = {
  readonly modules: readonly FurnitureSceneModule[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly testId?: string;
  /** Show a simple floor under the run. */
  readonly showFloor?: boolean;
  /** Default `material` = fast solid colors from catalog. */
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
};

function BoardMesh({ visual }: { readonly visual: BoardPartVisual }): ReactNode {
  const [w, t, l] = visual.size;
  return (
    <group position={visual.position} rotation={visual.rotation}>
      <mesh
        position={[w / 2, t / 2, l / 2]}
        castShadow
        receiveShadow
        userData={{
          partId: visual.id,
          description: visual.description,
          optionRole: visual.optionRole,
        }}
      >
        <boxGeometry args={[w, t, l]} />
        <meshStandardMaterial
          color={visual.color}
          roughness={0.72}
          metalness={0.04}
        />
      </mesh>
    </group>
  );
}

function OuterGhost({
  width,
  height,
  depth,
}: {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}): ReactNode {
  const W = Math.max(width, 1);
  const H = Math.max(height, 1);
  const D = Math.max(depth, 1);
  return (
    <mesh position={[W / 2, H / 2, D / 2]}>
      <boxGeometry args={[W, H, D]} />
      <meshBasicMaterial
        color="#6b7280"
        wireframe
        transparent
        opacity={0.18}
      />
    </mesh>
  );
}

function ModuleGroup({
  mod,
  colorMode,
  materialColors,
}: {
  readonly mod: FurnitureSceneModule;
  readonly colorMode: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
}): ReactNode {
  const visuals = useMemo(
    () =>
      boardPartsToVisuals(mod.parts, {
        colorMode,
        materialColors,
      }),
    [mod.parts, colorMode, materialColors],
  );
  // Workshop → Three Y-up: [x, z, y]
  const groupPos: [number, number, number] = [
    mod.originX,
    mod.originZ,
    mod.originY,
  ];

  return (
    <group position={groupPos}>
      {mod.showOuterGhost !== false ? (
        <OuterGhost
          width={mod.width}
          height={mod.height}
          depth={mod.depth}
        />
      ) : null}
      {visuals.map((v) => (
        <BoardMesh key={`${mod.key}-${v.id}`} visual={v} />
      ))}
    </group>
  );
}

function SceneContent({
  modules,
  totalWidth,
  totalHeight,
  totalDepth,
  showFloor,
  colorMode,
  materialColors,
}: {
  readonly modules: readonly FurnitureSceneModule[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly showFloor: boolean;
  readonly colorMode: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
}): ReactNode {
  const framing = useMemo(
    () => sceneFraming(totalWidth, totalHeight, totalDepth),
    [totalWidth, totalHeight, totalDepth],
  );

  return (
    <>
      <color attach="background" args={['#1a1c1e']} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[framing.maxDim, framing.maxDim * 1.4, framing.maxDim * 0.6]}
        intensity={1.05}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <hemisphereLight args={['#f0f4f8', '#3d3a35', 0.35]} />

      <Bounds fit clip observe margin={1.25}>
        <group>
          {showFloor ? (
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[framing.center[0], -1, framing.center[2]]}
              receiveShadow
            >
              <planeGeometry
                args={[totalWidth * 1.4, totalDepth * 1.6]}
              />
              <meshStandardMaterial
                color="#2a2d31"
                roughness={0.95}
                metalness={0}
              />
            </mesh>
          ) : null}
          {modules.map((mod) => (
            <ModuleGroup
              key={mod.key}
              mod={mod}
              colorMode={colorMode}
              materialColors={materialColors}
            />
          ))}
        </group>
      </Bounds>

      <ContactShadows
        position={[framing.center[0], 0.5, framing.center[2]]}
        opacity={0.32}
        scale={framing.maxDim * 2.2}
        blur={2.2}
        far={framing.maxDim}
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={framing.maxDim * 0.3}
        maxDistance={framing.maxDim * 5}
        target={[...framing.center]}
      />
    </>
  );
}

export function FurnitureScene3D({
  modules,
  totalWidth,
  totalHeight,
  totalDepth,
  className,
  style,
  testId = 'furniture-scene-3d',
  showFloor = true,
  colorMode = 'material',
  materialColors,
}: FurnitureScene3DProps): ReactNode {
  const hasAnyParts = modules.some((m) => m.parts.length > 0);
  // Keep empty modules so outer ghosts match layout footprint (no invisible gaps).
  const sceneModules = modules;

  if (sceneModules.length === 0 || (!hasAnyParts && sceneModules.every((m) => m.showOuterGhost === false))) {
    return (
      <div
        className={`module-scene-3d module-scene-3d--empty ${className ?? ''}`}
        style={style}
        data-testid={`${testId}-empty`}
      >
        <p className="catalog-empty">Sin piezas para la vista 3D.</p>
      </div>
    );
  }

  return (
    <div
      className={`module-scene-3d ${className ?? ''}`}
      style={style}
      data-testid={testId}
    >
      <p className="module-scene-3d__hint">
        Arrastrá para orbitar · rueda para zoom · clic derecho para pan
      </p>
      <div className="module-scene-3d__canvas-wrap">
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{
            position: [
              totalWidth * 0.55,
              totalHeight * 1.15,
              totalDepth * 1.8 + totalWidth * 0.15,
            ],
            fov: 40,
            near: 1,
            far: Math.max(totalWidth, totalHeight, totalDepth) * 25,
          }}
          gl={{ antialias: true, alpha: false }}
        >
          <Suspense fallback={null}>
            <SceneContent
              modules={sceneModules}
              totalWidth={totalWidth}
              totalHeight={totalHeight}
              totalDepth={totalDepth}
              showFloor={showFloor}
              colorMode={colorMode}
              materialColors={materialColors}
            />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
