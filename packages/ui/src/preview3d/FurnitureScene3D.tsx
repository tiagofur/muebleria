/**
 * Generic R3F furniture scene: one or many modules at workshop origins.
 */

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Bounds, ContactShadows, OrbitControls, PerspectiveCamera, OrthographicCamera, Edges } from '@react-three/drei';
import type { ResolvedBoardPart } from '@muebles/domain';
import {
  boardPartsToVisuals,
  sceneFraming,
  type BoardColorMode,
  type BoardPartVisual,
  type MaterialColorLookup,
} from './boardPartVisual';
import { MeasurementTool } from './MeasurementTool';
import { KeyboardNav } from './KeyboardNav';
import { ModelExporter, type ModelFormat } from './ModelExporter';
import { AlertTriangle } from 'lucide-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
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
  readonly cameraView?: { readonly type: 'front' | 'top' | 'side' | 'isometric'; readonly ts: number } | null;
  /** Default `material` = fast solid colors from catalog. */
  readonly colorMode?: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly cameraType?: 'perspective' | 'orthographic';
  readonly showWireframe?: boolean;
  /** Enable measurement tool mode (click two points to measure distance). */
  readonly measurementMode?: boolean;
  /** Trigger 3D model export. Set to a format to export; parent should reset to null. */
  readonly exportFormat?: ModelFormat | null;
  /** Callback after export completes (success or failure). */
  readonly onExportComplete?: () => void;
  /** Project name used as base filename for exports. */
  readonly exportProjectName?: string;
  /** Currently selected board part id (highlight). */
  readonly selectedPartId?: string | null;
  /** Click mesh / empty space → select or clear. Disabled while measuring. */
  readonly onSelectPart?: (partId: string | null) => void;
  /** When true and a part is selected, dim other meshes. */
  readonly isolateSelected?: boolean;
};

function BoardMesh({
  visual,
  showWireframe = false,
  selected = false,
  dimmed = false,
  onSelect,
}: {
  readonly visual: BoardPartVisual;
  readonly showWireframe?: boolean;
  readonly selected?: boolean;
  readonly dimmed?: boolean;
  readonly onSelect?: (partId: string) => void;
}): ReactNode {
  const [w, t, l] = visual.size;
  const transparent = showWireframe || dimmed;
  const opacity = dimmed ? 0.12 : showWireframe ? 0.3 : 1;
  return (
    <group position={visual.position} rotation={visual.rotation}>
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
        <meshStandardMaterial
          color={visual.color}
          emissive={selected ? '#f5c542' : '#000000'}
          emissiveIntensity={selected ? 0.4 : 0}
          transparent={transparent}
          opacity={opacity}
          depthWrite={!transparent}
          roughness={0.72}
          metalness={0.04}
        />
        {(showWireframe || selected) && (
          <Edges
            scale={1}
            threshold={15}
            color={selected ? '#f5c542' : visual.color}
          />
        )}
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
  showWireframe,
  selectedPartId,
  isolateSelected,
  onSelectPart,
}: {
  readonly mod: FurnitureSceneModule;
  readonly colorMode: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly showWireframe?: boolean;
  readonly selectedPartId?: string | null;
  readonly isolateSelected?: boolean;
  readonly onSelectPart?: (partId: string) => void;
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
  const hasSelection = Boolean(selectedPartId);

  return (
    <group position={groupPos}>
      {mod.showOuterGhost !== false ? (
        <OuterGhost
          width={mod.width}
          height={mod.height}
          depth={mod.depth}
        />
      ) : null}
      {visuals.map((v) => {
        const selected = selectedPartId === v.id;
        const dimmed =
          Boolean(isolateSelected) && hasSelection && !selected;
        return (
          <BoardMesh
            key={`${mod.key}-${v.id}`}
            visual={v}
            showWireframe={showWireframe}
            selected={selected}
            dimmed={dimmed}
            onSelect={onSelectPart}
          />
        );
      })}
    </group>
  );
}

type CameraViewType = {
  readonly type: 'front' | 'top' | 'side' | 'isometric';
  readonly ts: number;
};

function CameraViewSetter({
  cameraView,
  center,
  maxDim,
  controlsRef,
}: {
  readonly cameraView: CameraViewType | null | undefined;
  readonly center: readonly [number, number, number];
  readonly maxDim: number;
  readonly controlsRef: React.RefObject<any>;
}): ReactNode {
  const { camera } = useThree();

  useEffect(() => {
    if (!cameraView) return;

    const dist = maxDim * 1.85;

    if (controlsRef.current) {
      controlsRef.current.target.set(center[0], center[1], center[2]);
    }

    let targetPos: [number, number, number];
    if (cameraView.type === 'top') {
      targetPos = [center[0], center[1] + dist, center[2]];
    } else if (cameraView.type === 'front') {
      targetPos = [center[0], center[1], center[2] + dist];
    } else if (cameraView.type === 'side') {
      targetPos = [center[0] + dist, center[1], center[2]];
    } else {
      // isometric
      targetPos = [
        center[0] + maxDim * 0.55,
        center[1] + Math.max(center[1] * 2, maxDim * 0.8),
        center[2] + maxDim * 1.8,
      ];
    }

    camera.position.set(...targetPos);
    camera.lookAt(center[0], center[1], center[2]);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.update();
    }
  }, [cameraView, center, maxDim, controlsRef, camera]);

  return null;
}

function SceneContent({
  modules,
  totalWidth,
  totalHeight,
  totalDepth,
  showFloor,
  colorMode,
  materialColors,
  cameraView,
  showWireframe,
  measurementMode,
  controlsRef,
  exportFormat,
  onExportComplete,
  exportProjectName,
  selectedPartId,
  isolateSelected,
  onSelectPart,
}: {
  readonly modules: readonly FurnitureSceneModule[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  readonly totalDepth: number;
  readonly showFloor: boolean;
  readonly colorMode: BoardColorMode;
  readonly materialColors?: MaterialColorLookup;
  readonly cameraView?: CameraViewType | null;
  readonly showWireframe?: boolean;
  readonly measurementMode?: boolean;
  readonly controlsRef: React.RefObject<any>;
  readonly exportFormat?: ModelFormat | null;
  readonly onExportComplete?: () => void;
  readonly exportProjectName?: string;
  readonly selectedPartId?: string | null;
  readonly isolateSelected?: boolean;
  readonly onSelectPart?: (partId: string) => void;
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

      <Bounds fit margin={1.25}>
        <group>
          {!showFloor ? (
            <axesHelper args={[framing.maxDim * 0.75]} />
          ) : null}
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
              showWireframe={showWireframe}
              selectedPartId={selectedPartId}
              isolateSelected={isolateSelected}
              onSelectPart={onSelectPart}
            />
          ))}
        </group>
        <CameraViewSetter
          cameraView={cameraView}
          center={framing.center}
          maxDim={framing.maxDim}
          controlsRef={controlsRef}
        />
      </Bounds>

      <ContactShadows
        position={[framing.center[0], 0.5, framing.center[2]]}
        opacity={0.32}
        scale={framing.maxDim * 2.2}
        blur={2.2}
        far={framing.maxDim}
      />      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={framing.maxDim * 0.3}
        maxDistance={framing.maxDim * 5}
        target={framing.center as any}
        enabled={!measurementMode}
      />

      <MeasurementTool active={measurementMode ?? false} />
      <KeyboardNav
        active={true}
        controlsRef={controlsRef}
        center={framing.center}
        maxDim={framing.maxDim}
      />

      <ModelExporter
        exportFormat={exportFormat ?? null}
        onExportComplete={onExportComplete ?? (() => {})}
        projectName={exportProjectName ?? 'scene'}
      />
    </>);
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
  cameraView,
  cameraType = 'perspective',
  showWireframe,
  measurementMode,
  exportFormat = null,
  onExportComplete,
  exportProjectName = 'scene',
  selectedPartId = null,
  onSelectPart,
  isolateSelected = false,
}: FurnitureScene3DProps): ReactNode {
  const controlsRef = useRef<any>(null);
  const hasAnyParts = modules.some((m) => m.parts.length > 0);
  // Keep empty modules so outer ghosts match layout footprint (no invisible gaps).
  const sceneModules = modules;
  const selectionEnabled = Boolean(onSelectPart) && !measurementMode;

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
        Arrastrá para orbitar · rueda para zoom · click derecho o Shift+click para desplazar (pan)
        · ← → ↑ ↓ para navegar con teclado · + − para zoom
        {selectionEnabled ? ' · click en una pieza para inspeccionar' : ''}
      </p>
      <div
        className="module-scene-3d__canvas-wrap module-scene-3d__canvas-wrap--focusable"
        tabIndex={0}
        aria-label="Vista 3D interactiva. Usá las flechas para orbitar, +/- para zoom."
      >
        <ErrorBoundary
          fallback={(error, reset) => (
            <div className="r3f-error-fallback" role="alert" aria-label="Error en la vista 3D">
              <AlertTriangle
                size={32}
                strokeWidth={1.5}
                className="r3f-error-fallback__icon"
                aria-hidden
              />
              <p className="r3f-error-fallback__message">
                Error al renderizar la vista 3D.
              </p>
              <button
                type="button"
                className="btn btn--small"
                onClick={reset}
                data-testid="r3f-error-retry"
              >
                Reintentar
              </button>
            </div>
          )}
        >
        <Suspense fallback={
          <div className="module-scene-3d__loading" role="status" aria-label="Cargando vista 3D">
            <div className="module-scene-3d__loading-spinner" />
            <p className="module-scene-3d__loading-text">
              Cargando escena 3D…
            </p>
          </div>
        }>
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
          onPointerMissed={() => {
            if (selectionEnabled) onSelectPart?.(null);
          }}
        >
          {cameraType === 'orthographic' ? (
            <OrthographicCamera
              makeDefault
              position={[
                totalWidth * 0.55,
                Math.max(totalHeight * 1.15, Math.max(totalWidth, totalDepth) * 0.65),
                totalDepth * 1.8 + totalWidth * 0.15,
              ]}
              zoom={1.5}
              near={1}
              far={Math.max(totalWidth, totalHeight, totalDepth) * 25}
            />
          ) : (
            <PerspectiveCamera
              makeDefault
              position={[
                totalWidth * 0.55,
                Math.max(totalHeight * 1.15, Math.max(totalWidth, totalDepth) * 0.65),
                totalDepth * 1.8 + totalWidth * 0.15,
              ]}
              fov={40}
              near={1}
              far={Math.max(totalWidth, totalHeight, totalDepth) * 25}
            />
          )}
          <Suspense fallback={null}>
             <SceneContent
              modules={sceneModules}
              totalWidth={totalWidth}
              totalHeight={totalHeight}
              totalDepth={totalDepth}
              showFloor={showFloor}
              colorMode={colorMode}
              materialColors={materialColors}
              cameraView={cameraView}
              showWireframe={showWireframe}
              measurementMode={measurementMode}
              controlsRef={controlsRef}
              exportFormat={exportFormat}
              onExportComplete={onExportComplete}
              exportProjectName={exportProjectName}
              selectedPartId={selectedPartId}
              isolateSelected={isolateSelected}
              onSelectPart={selectionEnabled ? onSelectPart : undefined}
            />
          </Suspense>          </Canvas>
        </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
