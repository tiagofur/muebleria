/**
 * Single-hardware GLB viewport for the hardware editor (#669).
 *
 * Adapts a draft's `visualAsset` binding (+ mountFrame) into one
 * `ProjectedRigidMember` at identity transform and renders it through the
 * shared `HardwareGlbMesh` path — the same exact-GLB/procedural-fallback
 * branch `AssemblyMesh` uses. No scene duplication, no SKP parsing.
 *
 * Honors the fallback contract: without a GLB co-representation the draft's
 * procedural preview fields render with an explicit marker; a member never
 * silently disappears.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  Hardware,
  HardwareVisualAssetBinding,
  HardwareVisualGlbBinding,
  ProjectedRigidMember,
} from '@granete/domain';
import { normalizeHardwarePartFinishes } from '@granete/domain';
import type { GlbSceneCache } from '../../preview3d/glbSceneCache';
import { useGlbAssetAuthority } from '../../preview3d/glbAssetSourceContext';
import {
  HardwareGlbMesh,
  type HardwareGlbLoadStatus,
} from '../../preview3d/HardwareGlbMesh';
import { HardwareMesh } from '../../preview3d/HardwareMesh';
import { canUseWebGL } from '../../preview3d/webglSupport';
import type { HardwareDraft } from './hardwareDraft';

const IDENTITY_BASIS = {
  x: [1, 0, 0] as const,
  y: [0, 1, 0] as const,
  z: [0, 0, 1] as const,
};

const HARDWARE_SHAPES: ReadonlyArray<NonNullable<Hardware['previewShape']>> = [
  'knob',
  'bar-pull',
  'cup-pull',
  'hinge',
  'slide',
  'rail',
  'leg',
];

function parseDraftNum(value: string | undefined, allowZero = false): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  if (!allowZero && n <= 0) return undefined;
  if (allowZero && n < 0) return undefined;
  return n;
}

/**
 * Thin adapter: draft (+ binding) → one rigid member at identity.
 * Reuses the mountFrame resolved by the #668 server authority when present;
 * otherwise falls back to identity (asset space == preview space).
 * The GLB co-representation only attaches when it carries the full declared
 * coordinate space (units + axes): otherwise the member renders the explicit
 * procedural fallback instead of guessing the frame.
 */
export function hardwareDraftToMember(
  draft: HardwareDraft,
  binding: HardwareVisualAssetBinding,
): ProjectedRigidMember {
  const identity = {
    translationMm: [0, 0, 0] as const,
    basis: IDENTITY_BASIS,
  };
  const mountFrame = binding.mountFrame
    ? {
        originMm: binding.mountFrame.originMm,
        basis: binding.mountFrame.basis,
      }
    : undefined;
  const glb =
    bindingHasCompleteGlb(binding) && binding.glb
      ? {
          revisionId: binding.glb.revisionId,
          sha256: binding.glb.sha256,
          sourceUnits: binding.glb.sourceUnits,
          upAxis: binding.glb.upAxis,
          ...(binding.glb.sourceRevisionId
            ? { sourceRevisionId: binding.glb.sourceRevisionId }
            : {}),
        }
      : undefined;
  return {
    memberId: `hardware-editor-${binding.assetId}`,
    role: 'editor-preview',
    hardwareId: binding.assetId,
    bomRole: 'non_purchasing',
    assetId: binding.assetId,
    assetRevisionId: binding.assetRevisionId,
    ...(binding.sha256 ? { sha256: binding.sha256 } : {}),
    ...(mountFrame ? { mountFrame } : {}),
    localTransform: identity,
    effectiveTransform: identity,
    renderStatus: 'exact',
    ...(glb ? { glb } : {}),
  };
}

/**
 * Procedural `Hardware` for the explicit fallback mesh, parsed from the
 * draft's F069/F080 fields with the same semantics as the catalog store's
 * `hardwarePreviewFields` (validated shape, trimmed color, finite numbers).
 */
export function hardwareDraftToProcedural(draft: HardwareDraft): Hardware {
  const shape = (
    HARDWARE_SHAPES as readonly string[]
  ).includes(draft.previewShape)
    ? (draft.previewShape as NonNullable<Hardware['previewShape']>)
    : undefined;
  const color = draft.previewColor?.trim() || undefined;
  const partFinishes = normalizeHardwarePartFinishes({
    body: draft.partFinishes?.body || undefined,
    base: draft.partFinishes?.base || undefined,
    grip: draft.partFinishes?.grip || undefined,
  });
  return {
    id: 'hardware-editor-draft',
    code: draft.code || 'draft',
    name: draft.name || 'Borrador',
    unit: draft.unit,
    costPerUnit: draft.costPerUnit,
    active: true,
    ...(shape ? { previewShape: shape } : {}),
    ...(color ? { previewColor: color } : {}),
    ...(parseDraftNum(draft.previewSizeMm) !== undefined
      ? { previewSizeMm: parseDraftNum(draft.previewSizeMm) }
      : {}),
    ...(parseDraftNum(draft.previewDiameterMm) !== undefined
      ? { previewDiameterMm: parseDraftNum(draft.previewDiameterMm) }
      : {}),
    ...(parseDraftNum(draft.previewProjectionMm) !== undefined
      ? { previewProjectionMm: parseDraftNum(draft.previewProjectionMm) }
      : {}),
    ...(parseDraftNum(draft.previewRoughness, true) !== undefined
      ? { previewRoughness: parseDraftNum(draft.previewRoughness, true) }
      : {}),
    ...(parseDraftNum(draft.previewMetalness, true) !== undefined
      ? { previewMetalness: parseDraftNum(draft.previewMetalness, true) }
      : {}),
    ...(parseDraftNum(draft.previewClearcoat, true) !== undefined
      ? { previewClearcoat: parseDraftNum(draft.previewClearcoat, true) }
      : {}),
    ...(partFinishes ? { partFinishes } : {}),
  };
}

/**
 * Whether the binding carries a COMPLETE GLB co-representation (exact
 * revision + digest + declared coordinate space). Anything less renders the
 * explicit procedural fallback — the single predicate the viewport branch
 * AND the bound-card notice share, so copy never presents a proxy as exact.
 */
export type BindingWithCompleteGlb = HardwareVisualAssetBinding & {
  readonly glb: {
    readonly revisionId: string;
    readonly sha256: string;
    readonly sourceUnits: NonNullable<HardwareVisualGlbBinding['sourceUnits']>;
    readonly upAxis: NonNullable<HardwareVisualGlbBinding['upAxis']>;
  };
};

export function bindingHasCompleteGlb(
  binding: HardwareVisualAssetBinding,
): binding is BindingWithCompleteGlb {
  const glb = binding.glb;
  return Boolean(
    glb?.revisionId && glb.sha256 && glb.sourceUnits && glb.upAxis,
  );
}

export type HardwareGlbViewportProps = {
  readonly draft: HardwareDraft;
  readonly binding: HardwareVisualAssetBinding;
  /**
   * Shared owner-scoped GLB cache; absent = procedural fallback renders.
   * An explicit cache wins; otherwise the session authority from context.
   */
  readonly glbCache?: GlbSceneCache;
};

/**
 * Marker copy reflects what the canvas ACTUALLY shows (review round-1
 * suggestion): loading/corrupt/inaccessible/unsupported states say so while
 * the procedural fallback renders — the marker never claims the exact model
 * before `ready`.
 */
function markerText(
  hasGlb: boolean,
  status: HardwareGlbLoadStatus,
): string {
  if (!hasGlb) {
    return 'Representación genérica: este vínculo aún no tiene GLB derivado.';
  }
  switch (status) {
    case 'ready':
      return 'Modelo exacto del archivo vinculado (GLB).';
    case 'loading':
      return 'Cargando el modelo exacto… (se muestra la representación genérica).';
    default:
      return `No se pudo cargar el modelo exacto (${status}); se muestra la representación genérica.`;
  }
}

export function HardwareGlbViewport({
  draft,
  binding,
  glbCache,
}: HardwareGlbViewportProps): ReactNode {
  const member = hardwareDraftToMember(draft, binding);
  const proceduralHardware = hardwareDraftToProcedural(draft);
  const authority = useGlbAssetAuthority();
  const cache = useMemo(
    () => glbCache ?? authority.cache,
    [glbCache, authority.cache],
  );
  const webglAvailable = useMemo(() => canUseWebGL(), []);
  const [glbStatus, setGlbStatus] = useState<HardwareGlbLoadStatus>('loading');
  // Render-phase identity reset (React's "adjust state when props change"
  // pattern): a binding/revision change restarts the tracked status — an
  // effect would fire AFTER the mesh's own first report and clobber it.
  const identityKey = `${binding.assetId}|${binding.assetRevisionId}|${
    binding.glb?.revisionId ?? ''
  }`;
  const prevIdentityRef = useRef(identityKey);
  if (prevIdentityRef.current !== identityKey) {
    prevIdentityRef.current = identityKey;
    setGlbStatus('loading');
  }
  const procedural = (
    <HardwareMesh
      placement={{
        componentInstanceId: member.memberId,
        hardwareId: proceduralHardware.id,
        localPosition: [0, 0, 0],
        localNormal: [0, 1, 0],
        standoffMm: 0,
        scale: 1,
        rotationDeg: { x: 0, y: 0, z: 0 },
      }}
      hardware={proceduralHardware}
    />
  );
  if (!webglAvailable) {
    return (
      <div
        className="hardware-glb-viewport hardware-glb-viewport--no-webgl"
        data-testid="hardware-glb-viewport-no-webgl"
        role="status"
      >
        <p>Vista 3D no disponible en este navegador (WebGL).</p>
      </div>
    );
  }
  const hasGlb = bindingHasCompleteGlb(binding);
  return (
    <div
      className="hardware-glb-viewport"
      data-testid="hardware-glb-viewport"
      style={{ height: 220 }}
    >
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
        camera={{
          fov: 40,
          near: 1,
          far: 20000,
          position: [320, 260, 420],
          up: [0, 0, 1],
        }}
        onCreated={({ gl, camera }) => {
          // Frame the member's local origin at identity; the model authors
          // its own units (mm) and the GLB swap group maps to asset space.
          camera.lookAt(new THREE.Vector3(0, 0, 0));
          gl.setClearColor(new THREE.Color('#f2f4f7'));
        }}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[300, 400, 500]} intensity={1.1} />
        <group data-testid="hardware-glb-viewport-content">
          {hasGlb ? (
            <HardwareGlbMesh
              member={member}
              glbCache={cache}
              fallback={procedural}
              onStatusChange={setGlbStatus}
            />
          ) : (
            procedural
          )}
        </group>
      </Canvas>
      <p
        className="catalog-form__hint"
        data-testid="hardware-glb-viewport-marker"
        role="status"
      >
        {markerText(hasGlb, glbStatus)}
      </p>
    </div>
  );
}
