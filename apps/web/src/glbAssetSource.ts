import { useMemo } from 'react';

import {
  type GlbAssetSource,
} from '@granete/ui';
import {
  type HardwareAssetService,
  resolveHardwareAssetFileUrl,
} from '@granete/storage';

/**
 * Session-scoped GLB byte source backed by the generated hardware-asset API
 * (#669): authorize the EXACT revision (short-lived grant with integrity
 * pins), resolve the grant URL against the API origin and fetch the bytes.
 * The renderer cache verifies the SHA-256 client-side before parsing.
 */
export function useApiGlbAssetSource(
  hardwareAssetService: HardwareAssetService | undefined,
  apiBaseUrl: string,
  sessionScope: string,
): GlbAssetSource | undefined {
  return useMemo(() => {
    if (!hardwareAssetService) return undefined;
    const source: GlbAssetSource = {
      ownerKey: `api:${sessionScope}`,
      loadBytes: async (assetId: string, revisionId: string, sha256: string) => {
        if (!assetId) {
          throw new Error(`glb revision ${revisionId} has no owning asset id`);
        }
        const authorize = hardwareAssetService.authorizeRevision;
        if (!authorize) {
          throw new Error('hardware asset authorize is unavailable in this session');
        }
        const grant = await authorize(assetId, revisionId);
        if (grant.sha256 !== sha256) {
          throw new Error(
            `grant digest ${grant.sha256} does not match the pinned revision digest ${sha256}`,
          );
        }
        const url = resolveHardwareAssetFileUrl(apiBaseUrl, grant.url);
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
          throw new Error(`glb fetch failed: ${response.status}`);
        }
        return response.arrayBuffer();
      },
    };
    return source;
  }, [hardwareAssetService, apiBaseUrl, sessionScope]);
}
