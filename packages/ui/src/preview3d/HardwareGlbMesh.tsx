import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ProjectedRigidMember } from '@granete/domain';
import {
  type GlbAssetSource,
  GlbAssetLoadError,
  GlbSceneCache,
  cloneGlbScene,
  createAssetSpaceSwapGroup,
} from './glbSceneCache';

/**
 * Renders one rigid member's exact GLB representation (#669).
 *
 * Placement contract: the parent group carries the conjugated effective
 * transform (T_member x inverse(T_mountFrame), three frame). The GLB scene is
 * normalized to asset-space mm once per digest (GlbSceneCache) and mounted
 * under the constant axis-swap group, so the composed world transform of any
 * asset point equals S . (T_furniture x T_assembly x T_member x T_norm) . P —
 * the same world point SketchUp produces (canonical #669 parity fixture).
 *
 * Fallback order is honest: while loading, or when the exact GLB cannot be
 * loaded (corrupt/inaccessible/unsupported), the explicit procedural
 * representation renders with a visible state marker — a member never
 * silently disappears and a proxy is never presented as the exact model.
 */
export type HardwareGlbLoadStatus = 'loading' | 'ready' | 'corrupt' | 'inaccessible' | 'unsupported';

export type HardwareGlbMeshProps = {
  readonly member: ProjectedRigidMember;
  readonly glbSource?: GlbAssetSource;
  readonly glbCache?: GlbSceneCache;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  /** Explicit procedural representation rendered while the exact GLB is unavailable. */
  readonly fallback: ReactNode;
  readonly onStatusChange?: (status: HardwareGlbLoadStatus, diagnostic?: string) => void;
};

export function HardwareGlbMesh({
  member,
  glbSource,
  glbCache,
  onSelect,
  fallback,
  onStatusChange,
}: HardwareGlbMeshProps): ReactNode {
  const glb = member.glb;
  const [status, setStatus] = useState<HardwareGlbLoadStatus>('loading');
  const [instance, setInstance] = useState<THREE.Group | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | undefined>(undefined);
  const generationRef = useRef(0);
  const cache = glbCache ?? (glbSource ? useMemo(() => new GlbSceneCache(glbSource), [glbSource]) : undefined);

  const revisionId = glb?.revisionId;
  const sha256 = glb?.sha256;
  const sourceUnits = glb?.sourceUnits;
  const upAxis = glb?.upAxis;

  useEffect(() => {
    if (!cache || !glb || !revisionId || !sha256) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    setStatus('loading');
    setInstance(null);
    setDiagnostic(undefined);

    cache
      .load({ revisionId, sha256, sourceUnits: sourceUnits ?? 'm', upAxis: upAxis ?? 'y' })
      .then((template) => {
        if (cancelled || generationRef.current !== generation) return;
        setInstance(cloneGlbScene(template));
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled || generationRef.current !== generation) return;
        const failure =
          error instanceof GlbAssetLoadError ? error : null;
        setStatus(failure?.kind ?? 'inaccessible');
        setDiagnostic(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
      generationRef.current += 1;
    };
  }, [cache, revisionId, sha256, sourceUnits, upAxis, glb]);

  useEffect(() => {
    onStatusChange?.(status, diagnostic);
  }, [status, diagnostic, onStatusChange]);

  const swapMounted = useMemo(() => {
    if (!instance) return null;
    const swap = createAssetSpaceSwapGroup();
    swap.add(instance);
    return swap;
  }, [instance]);

  if (!glb) {
    return <>{fallback}</>;
  }

  return (
    <group
      onClick={
        onSelect
          ? (event) => {
              event.stopPropagation();
              onSelect();
            }
          : undefined
      }
      data-testid={`hardware-glb-${status}-${member.memberId}`}
      userData={{
        memberId: member.memberId,
        glbRevisionId: glb.revisionId,
        glbSha256: glb.sha256,
        glbSourceRevisionId: glb.sourceRevisionId,
        glbStatus: status,
        ...(diagnostic ? { glbDiagnostic: diagnostic } : {}),
      }}
    >
      {status === 'ready' && swapMounted ? <primitive object={swapMounted} /> : fallback}
    </group>
  );
}
