import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import { type GlbAssetSource, GlbSceneCache } from './glbSceneCache';

/**
 * Session-scoped GLB authority for every web consumer (#669): the byte source
 * AND the scene cache that owns its parsed templates. The app provides the
 * API-backed source once (GlbAssetSourceProvider); one cache lives per
 * source/owner so twenty members of the same digest authorize/fetch/parse
 * ONCE, templates never leak across sessions, and disposal happens exactly
 * when the owning authority changes or unmounts. In guest/test contexts a
 * data-only window seam can supply static bytes: it never carries functions,
 * only {revisionId -> {sha256, bytesBase64}} recorded BEFORE the scene mounts
 * (the #444 WebGL harness pattern, like __graneteScene).
 */
export interface GlbAssetAuthority {
  readonly source: GlbAssetSource | undefined;
  readonly cache: GlbSceneCache | undefined;
}

const GlbAssetSourceContext = createContext<GlbAssetAuthority | undefined>(undefined);

const EMPTY_AUTHORITY: GlbAssetAuthority = { source: undefined, cache: undefined };

export type GlbAssetSourceProviderProps = {
  readonly source: GlbAssetSource | undefined;
  readonly children: ReactNode;
};

export function GlbAssetSourceProvider({ source, children }: GlbAssetSourceProviderProps): ReactNode {
  // One cache per source identity: a session switch produces a new source →
  // new cache → the previous cache is disposed (its templates/geometries/
  // materials/textures are owned by it and by nothing else).
  const cache = useMemo(() => (source ? new GlbSceneCache(source) : undefined), [source]);
  useEffect(() => {
    if (!cache) return;
    return () => cache.dispose();
  }, [cache]);
  const authority = useMemo<GlbAssetAuthority>(
    () => (source ? { source, cache } : EMPTY_AUTHORITY),
    [source, cache],
  );
  return <GlbAssetSourceContext.Provider value={authority}>{children}</GlbAssetSourceContext.Provider>;
}

export function useGlbAssetAuthority(): GlbAssetAuthority {
  const provided = useContext(GlbAssetSourceContext);
  const seamAuthority = useMemo(() => buildWindowSeamAuthority(), []);
  // Hooks are unconditional; precedence is decided at return time only. A
  // provider without a source (e.g. guest sessions) must NOT mask the test
  // seam: an empty authority is equivalent to no authority.
  return provided?.source ? provided : seamAuthority;
}

/**
 * Back-compat helper: the byte source of the active authority.
 */
export function useGlbAssetSource(): GlbAssetSource | undefined {
  return useGlbAssetAuthority().source;
}

interface WindowSeamAssets {
  readonly [revisionId: string]: { readonly sha256: string; bytesBase64: string };
}

function buildWindowSeamAuthority(): GlbAssetAuthority {
  const source = createWindowSeamGlbAssetSource();
  if (!source) return EMPTY_AUTHORITY;
  return { source, cache: new GlbSceneCache(source) };
}

/**
 * Builds a static source from window.__graneteTestGlbAssets when present.
 * Test/guest-only; the app never sets the seam.
 */
export function createWindowSeamGlbAssetSource(): GlbAssetSource | undefined {
  if (typeof window === 'undefined') return undefined;
  const seam = (window as unknown as { __graneteTestGlbAssets?: WindowSeamAssets })
    .__graneteTestGlbAssets;
  if (!seam || Object.keys(seam).length === 0) return undefined;
  return {
    ownerKey: 'window-seam',
    loadBytes: async (_assetId: string, revisionId: string, sha256: string) => {
      const entry = seam[revisionId];
      if (!entry || entry.sha256 !== sha256) {
        throw new Error(`static glb seam has no exact revision ${revisionId}`);
      }
      const binary = atob(entry.bytesBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer as ArrayBuffer;
    },
  };
}
