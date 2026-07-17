/**
 * Basic 3D furniture viewer (H12 / #107) — not a CAD editor.
 * Consumes ResolvedAssembly from domain; UI does not invent measures.
 */

import {
  useMemo,
  useState,
  type ReactNode,
  type MouseEvent as DomMouseEvent,
} from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Edges } from '@react-three/drei';
import type { ResolvedAssembly } from '@muebles/domain';
import {
  assemblyToBoxes,
  boxToScene,
  mmToScene,
  type BoardBoxMm,
} from './placedBoardGeometry';
import { colorForOptionRole } from './roleColors';
import './Module3DPreview.css';

export type Module3DPreviewProps = {
  readonly assembly: ResolvedAssembly;
  /** Optional controlled selection; when omitted, local state is used. */
  readonly selectedPartId?: string | null;
  readonly onSelectPart?: (partId: string | null) => void;
  readonly className?: string;
};

function BoardMesh({
  box,
  selected,
  onSelect,
}: {
  readonly box: BoardBoxMm;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const { position, scale } = boxToScene(box);
  const color = colorForOptionRole(box.optionRole);

  return (
    <mesh
      position={[position[0], position[1], position[2]]}
      scale={[scale[0], scale[1], scale[2]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(box.partId);
      }}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={selected ? 0.95 : 0.72}
        metalness={0.05}
        roughness={0.65}
      />
      <Edges
        threshold={15}
        color={selected ? '#1a1a2e' : '#3d3d5c'}
        scale={1.001}
      />
    </mesh>
  );
}

function OuterWire({
  outerMm,
}: {
  readonly outerMm: ResolvedAssembly['outerMm'];
}): ReactNode {
  const w = mmToScene(outerMm.width);
  const h = mmToScene(outerMm.height);
  const d = mmToScene(outerMm.depth);
  return (
    <mesh position={[w / 2, h / 2, d / 2]} scale={[w, h, d]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#94a3b8" wireframe transparent opacity={0.35} />
    </mesh>
  );
}

function Scene({
  assembly,
  selectedPartId,
  onSelectPart,
}: {
  readonly assembly: ResolvedAssembly;
  readonly selectedPartId: string | null;
  readonly onSelectPart: (id: string | null) => void;
}): ReactNode {
  const boxes = useMemo(() => assemblyToBoxes(assembly), [assembly]);
  const maxDim = Math.max(
    assembly.outerMm.width,
    assembly.outerMm.height,
    assembly.outerMm.depth,
    1,
  );
  const camDist = mmToScene(maxDim) * 2.2;

  return (
    <>
      <color attach="background" args={['#f1f3f8']} />
      <ambientLight intensity={0.55} />
      <directionalLight
        position={[camDist, camDist * 1.2, camDist * 0.8]}
        intensity={0.9}
        castShadow
      />
      <directionalLight position={[-camDist, camDist * 0.5, -camDist]} intensity={0.35} />
      <OrbitControls
        makeDefault
        target={[
          mmToScene(assembly.outerMm.width) / 2,
          mmToScene(assembly.outerMm.height) / 2,
          mmToScene(assembly.outerMm.depth) / 2,
        ]}
        enableDamping
        dampingFactor={0.08}
        minDistance={mmToScene(maxDim) * 0.4}
        maxDistance={mmToScene(maxDim) * 6}
      />
      <group
        onPointerMissed={() => {
          onSelectPart(null);
        }}
      >
        <OuterWire outerMm={assembly.outerMm} />
        {boxes.map((box) => (
          <BoardMesh
            key={box.partId}
            box={box}
            selected={selectedPartId === box.partId}
            onSelect={(id) => onSelectPart(id)}
          />
        ))}
      </group>
    </>
  );
}

function SpecsPanel({
  assembly,
  selectedPartId,
}: {
  readonly assembly: ResolvedAssembly;
  readonly selectedPartId: string | null;
}): ReactNode {
  const part = selectedPartId
    ? assembly.boards.find((b) => b.partId === selectedPartId)
    : undefined;

  if (!part) {
    return (
      <p className="module-3d-preview__hint" data-testid="module-3d-hint">
        Orbitá con el mouse · click en una pieza para ver medidas
        {assembly.completeness === 'outer_only'
          ? ' · solo caja exterior (sin pose espacial)'
          : assembly.completeness === 'partial'
            ? ' · ensamble parcial'
            : ''}
      </p>
    );
  }

  return (
    <dl className="module-3d-preview__specs" data-testid="module-3d-specs">
      <div>
        <dt>Pieza</dt>
        <dd>{part.description}</dd>
      </div>
      <div>
        <dt>Rol</dt>
        <dd>{part.optionRole}</dd>
      </div>
      <div>
        <dt>Corte</dt>
        <dd>
          {part.lengthMm}×{part.widthMm}×{part.thicknessMm} mm
        </dd>
      </div>
      <div>
        <dt>Cara</dt>
        <dd>{part.face.toUpperCase()}</dd>
      </div>
      <div>
        <dt>Origen</dt>
        <dd>
          {part.originMm.x}, {part.originMm.y}, {part.originMm.z} mm
        </dd>
      </div>
      {part.placement ? (
        <div>
          <dt>Posición</dt>
          <dd>{part.placement}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function Module3DPreview({
  assembly,
  selectedPartId: controlledSelected,
  onSelectPart,
  className,
}: Module3DPreviewProps): ReactNode {
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selectedPartId =
    controlledSelected !== undefined ? controlledSelected : localSelected;

  const setSelected = (id: string | null) => {
    if (controlledSelected === undefined) setLocalSelected(id);
    onSelectPart?.(id);
  };

  const maxDim = Math.max(
    assembly.outerMm.width,
    assembly.outerMm.height,
    assembly.outerMm.depth,
    400,
  );
  const camDist = mmToScene(maxDim) * 2.4;
  const target = [
    mmToScene(assembly.outerMm.width) / 2,
    mmToScene(assembly.outerMm.height) / 2,
    mmToScene(assembly.outerMm.depth) / 2,
  ] as const;

  const stopOrbitOnUi = (e: DomMouseEvent) => {
    e.stopPropagation();
  };

  return (
    <section
      className={`module-3d-preview${className ? ` ${className}` : ''}`}
      data-testid="module-3d-preview"
      aria-label="Vista 3D del mueble"
    >
      <header className="module-3d-preview__header">
        <h3 className="module-3d-preview__title">Vista 3D</h3>
        <span
          className="module-3d-preview__badge"
          data-testid="module-3d-completeness"
        >
          {assembly.completeness === 'full'
            ? 'Ensamble completo'
            : assembly.completeness === 'partial'
              ? 'Ensamble parcial'
              : 'Solo exterior'}
        </span>
      </header>
      <div className="module-3d-preview__canvas-wrap">
        <Canvas
          shadows
          camera={{
            position: [
              target[0] + camDist * 0.75,
              target[1] + camDist * 0.55,
              target[2] + camDist * 0.9,
            ],
            fov: 40,
            near: 0.01,
            far: 50,
          }}
          onPointerMissed={() => setSelected(null)}
          data-testid="module-3d-canvas"
        >
          <Scene
            assembly={assembly}
            selectedPartId={selectedPartId}
            onSelectPart={setSelected}
          />
        </Canvas>
      </div>
      <div className="module-3d-preview__footer" onMouseDown={stopOrbitOnUi}>
        <SpecsPanel assembly={assembly} selectedPartId={selectedPartId} />
      </div>
    </section>
  );
}
