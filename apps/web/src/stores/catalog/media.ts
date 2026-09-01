/**
 * catalog/media — catalog image upload (F040/F042) + media URL resolution
 * through short-lived signed grants (#460 SEC-3). The session JWT never
 * travels in a query string anymore: canonical /api/media paths resolve via
 * the shared token-scoped grant cache (mediaAuthorization.ts), and every
 * other URL shape passes through unchanged.
 */

import type { CatalogState, CatalogStoreCtx } from './shared';
import { resolveAuthorizedMediaUrl } from '../mediaAuthorization';

type MediaSlice = Pick<CatalogState, 'resolveMediaUrl' | 'uploadCatalogImage'>;

export function createMediaActions(ctx: CatalogStoreCtx): MediaSlice {
  const { deps } = ctx;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  return {
    resolveMediaUrl: (url) =>
      resolveAuthorizedMediaUrl(url, {
        baseUrl: deps.baseUrl,
        getAuthToken: () => deps.getAuthToken(),
        fetchImpl,
      }),

    uploadCatalogImage: async (file) => {
      const token = deps.getAuthToken();
      if (!token) throw new Error('no auth');
      const form = new FormData();
      form.append('file', file);
      const res = await fetchImpl(`${deps.baseUrl}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        throw new Error(`upload ${res.status}`);
      }
      const data = (await res.json()) as { url?: string };
      if (!data.url) throw new Error('no url');
      return data.url;
    },
  };
}
