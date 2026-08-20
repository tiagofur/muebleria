/**
 * catalog/media — catalog image upload (F040/F042) + media URL resolution
 * with the auth token query param.
 */

import type { CatalogState, CatalogStoreCtx } from './shared';

type MediaSlice = Pick<CatalogState, 'resolveMediaUrl' | 'uploadCatalogImage'>;

export function createMediaActions(ctx: CatalogStoreCtx): MediaSlice {
  const { deps } = ctx;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  return {
    resolveMediaUrl: (url) => {
      if (!url) return undefined;
      if (url.startsWith('http') || url.startsWith('blob:')) return url;
      const token = deps.getAuthToken() ?? '';
      const abs = url.startsWith('/api/')
        ? `${deps.baseUrl.replace(/\/api\/?$/, '')}${url}`
        : url;
      return token
        ? `${abs}${abs.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
        : abs;
    },

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
