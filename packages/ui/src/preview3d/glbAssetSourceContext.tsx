import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { GlbAssetSource } from './glbSceneCache';

/**
 * Session-scoped GLB byte source for every web consumer (#669). The app
 * provides the API-backed source once (GlbAssetSourceProvider); surfaces that
 * already accept an explicit glbSource prop keep precedence. In guest/test
 * contexts a data-only window seam can supply static bytes: it never carries
 * functions, only {revisionId -> {sha256, bytesBase64}} recorded BEFORE the
 * scene mounts (the #444 WebGL harness pattern, like __graneteScene).
 */
const GlbAssetSourceContext = createContext<GlbAssetSource | undefined>(undefined);

export type GlbAssetSourceProviderProps = {
  readonly source: GlbAssetSource | undefined;
  readonly children: ReactNode;
};

export function GlbAssetSourceProvider({ source, children }: GlbAssetSourceProviderProps): ReactNode {
  return <GlbAssetSourceContext.Provider value={source}>{children}</GlbAssetSourceContext.Provider>;
}

export function useGlbAssetSource(): GlbAssetSource | undefined {
  const provided = useContext(GlbAssetSourceContext);
  if (provided) return provided;
  const testSource = useMemo(() => createWindowSeamGlbAssetSource(), []);
  return testSource;
}

interface WindowSeamAssets {
  readonly [revisionId: string]: { readonly sha256: string; readonly bytesBase64: string };
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
