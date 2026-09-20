import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ProjectedRigidMember } from '@granete/domain';
import {
  GlbAssetLoadError,
  type GlbSceneCache,
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

/**
 * The mounted GLB carries the EXACT authority/revision identity it was
 * produced for (#669 review R19). Rendering it is decided purely by identity
 * DURING render: the primitive may appear IFF the mounted identity equals the
 * currently requested one — a stale mounted (previous cache/revision) is
 * excluded from the new commit immediately, with no dependency on passive
 * effect ordering.
 */
interface MountedGlb {
  readonly object: THREE.Group;
  readonly cache: GlbSceneCache;
  readonly assetId: string | undefined;
  readonly revisionId: string;
  readonly sha256: string;
  readonly sourceUnits: NonNullable<ProjectedRigidMember['glb']>['sourceUnits'];
  readonly upAxis: NonNullable<ProjectedRigidMember['glb']>['upAxis'];
}

export type HardwareGlbMeshProps = {
  readonly member: ProjectedRigidMember;
  /**
   * Shared, owner-scoped cache (#669 review R2): one per session/source
   * authority (GlbAssetSourceProvider or an explicit prop on the scene).
   * Members NEVER create their own cache — the same digest is fetched and
   * parsed once per owner, not once per member.
   */
  readonly glbCache?: GlbSceneCache;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  /** Explicit procedural representation rendered while the exact GLB is unavailable. */
  readonly fallback: ReactNode;
  readonly onStatusChange?: (status: HardwareGlbLoadStatus, diagnostic?: string) => void;
};

export function HardwareGlbMesh({
  member,
  glbCache,
  onSelect,
  fallback,
  onStatusChange,
}: HardwareGlbMeshProps): ReactNode {
  const glb = member.glb;
  const [status, setStatus] = useState<HardwareGlbLoadStatus>('loading');
  // `mounted` couples the axis-swap group, the cloned instance AND the
  // authority/revision identity it was produced for. It is created ONCE per
  // exact revision inside the effect: R3F primitives must keep a stable
  // identity — re-created objects get their imperatively added children
  // detached by the reconciler.
  const [mounted, setMounted] = useState<MountedGlb | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | undefined>(undefined);
  const generationRef = useRef(0);
  const cache = glbCache;

  const revisionId = glb?.revisionId;
  const sha256 = glb?.sha256;
  const sourceUnits = glb?.sourceUnits;
  const upAxis = glb?.upAxis;
  const assetId = member.assetId;

  useEffect(() => {
    if (!cache || !glb || !revisionId || !sha256) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let cancelled = false;
    setStatus('loading');
    setMounted(null);
    setDiagnostic(undefined);

    cache
      .load({
        assetId,
        revisionId,
        sha256,
        sourceUnits: sourceUnits ?? 'm',
        upAxis: upAxis ?? 'y',
      })
      .then((template) => {
        if (cancelled || generationRef.current !== generation) return;
        const swap = createAssetSpaceSwapGroup();
        swap.add(cloneGlbScene(template));
        swap.name = template.name;
        setMounted({
          object: swap,
          cache,
          assetId,
          revisionId,
          sha256,
          sourceUnits: sourceUnits ?? 'm',
          upAxis: upAxis ?? 'y',
        });
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
    // Semantic identity ONLY (#669 review R11): a new-but-equivalent glb
    // binding object (same revision/digest/units/axes/asset) must NOT restart
    // the lifecycle — reference identity of `glb` is deliberately excluded so
    // the mounted object (and its R3F children) cannot churn on parent
    // re-renders. Real identity changes ARE part of the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, assetId, revisionId, sha256, sourceUnits, upAxis]);

  useEffect(() => {
    onStatusChange?.(status, diagnostic);
  }, [status, diagnostic, onStatusChange]);

  // Stable identity: the reconciler must not churn the primitive's parent
  // props across unrelated re-renders (it would detach mounted children).
  const userData = useMemo(
    () => ({
      memberId: member.memberId,
      glbRevisionId: glb?.revisionId ?? '',
      glbSha256: glb?.sha256 ?? '',
      glbSourceRevisionId: glb?.sourceRevisionId ?? '',
      glbStatus: status,
      ...(diagnostic ? { glbDiagnostic: diagnostic } : {}),
    }),
    [member.memberId, glb?.revisionId, glb?.sha256, glb?.sourceRevisionId, status, diagnostic],
  );

  // Identity gate (R19): evaluated during EVERY render, before any effect.
  // A mounted object produced for a previous cache/revision is not part of
  // the output of the new commit — the fallback renders instead until the
  // new authority resolves.
  const mountedIsCurrent =
    Boolean(mounted && glb) &&
    mounted!.cache === cache &&
    mounted!.assetId === assetId &&
    mounted!.revisionId === glb!.revisionId &&
    mounted!.sha256 === glb!.sha256 &&
    mounted!.sourceUnits === glb!.sourceUnits &&
    mounted!.upAxis === glb!.upAxis;

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
      userData={userData}
    >
      {status === 'ready' && mountedIsCurrent && mounted ? (
        <primitive object={mounted.object} name={mounted.object.name} />
      ) : (
        fallback
      )}
    </group>
  );
}
