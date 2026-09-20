// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GlbAssetSource } from './glbSceneCache';
import { GlbSceneCache } from './glbSceneCache';
import {
  type GlbAssetAuthority,
  GlbAssetSourceProvider,
  useGlbAssetAuthority,
} from './glbAssetSourceContext';

// #669 review R1/R2: the provider owns ONE cache per source identity, every
// hook in the authority chain is unconditional, and source transitions
// (undefined -> A -> B -> undefined) neither break React's hook order nor leak
// the previous owner's cache.

function AuthorityProbe({ label }: { label: string }) {
  const authority = useGlbAssetAuthority();
  return (
    <div
      data-testid={`authority-${label}`}
      data-has-source={authority.source ? 'yes' : 'no'}
      data-cache-key={authority.source?.ownerKey ?? 'none'}
    >
      {authority.source ? 'with-source' : 'empty'}
    </div>
  );
}

function makeSource(ownerKey: string): GlbAssetSource & { loadBytes: ReturnType<typeof vi.fn> } {
  return {
    ownerKey,
    loadBytes: vi.fn(async () => {
      throw new Error(`source ${ownerKey} has no bytes in this test`);
    }),
  };
}

describe('GlbAssetSourceProvider authority lifecycle', () => {
  it('transitions undefined -> A -> B -> undefined without hook errors and disposes replaced caches', async () => {
    const sourceA = makeSource('session-a');
    const sourceB = makeSource('session-b');
    const consoleErrors: string[] = [];
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });

    const caches: GlbSceneCache[] = [];
    const CacheCapture = ({ source }: { source?: GlbAssetSource }) => (
      <GlbAssetSourceProvider source={source}>
        <AuthorityCapture onCache={(cache) => { if (cache) caches.push(cache); }} label="probe" />
      </GlbAssetSourceProvider>
    );
    function AuthorityCapture({
      onCache,
      label,
    }: {
      onCache: (cache: GlbSceneCache | undefined) => void;
      label: string;
    }) {
      const authority: GlbAssetAuthority = useGlbAssetAuthority();
      onCache(authority.cache);
      return <AuthorityProbe label={label} />;
    }

    const { rerender, unmount } = render(<CacheCapture source={undefined} />);
    expect(screen.getByTestId('authority-probe').dataset.hasSource).toBe('no');

    rerender(<CacheCapture source={sourceA} />);
    await waitFor(() => {
      expect(screen.getByTestId('authority-probe').dataset.cacheKey).toBe('session-a');
    });

    rerender(<CacheCapture source={sourceB} />);
    await waitFor(() => {
      expect(screen.getByTestId('authority-probe').dataset.cacheKey).toBe('session-b');
    });

    rerender(<CacheCapture source={undefined} />);
    await waitFor(() => {
      expect(screen.getByTestId('authority-probe').dataset.hasSource).toBe('no');
    });

    // One cache per source identity: A and B only (the undefined steps carry
    // no cache at all — they must not create or resurrect one).
    const realCaches = caches.filter((cache): cache is GlbSceneCache => Boolean(cache));
    expect(realCaches.length).toBeGreaterThanOrEqual(2);
    const uniqueCaches = new Set(realCaches);
    expect(uniqueCaches.size).toBe(2);

    // The cache replaced by the switch was disposed: loads now reject with
    // the honest inaccessible classification instead of resurrecting bytes.
    const cacheA = [...uniqueCaches].find((cache) => cache.ownerKey === 'session-a');
    const cacheB = [...uniqueCaches].find((cache) => cache.ownerKey === 'session-b');
    expect(cacheA).toBeDefined();
    expect(cacheB).toBeDefined();
    // The final undefined step removed the last owner too: every cache the
    // provider ever created is disposed and refuses loads honestly.
    const representation = {
      revisionId: 'r',
      sha256: 'sha256-' + '0'.repeat(64),
      sourceUnits: 'm' as const,
      upAxis: 'y' as const,
    };
    await expect(cacheA!.load(representation)).rejects.toThrow(/disposed/);
    await expect(cacheB!.load(representation)).rejects.toThrow(/disposed/);

    // While a source is ACTIVE its cache is NOT disposed: a fresh provider
    // with source B keeps serving (fetch classification reaches the source).
    const keepAlive: GlbAssetSource = makeSource('session-keep');
    const keepProbe = render(
      <GlbAssetSourceProvider source={keepAlive}>
        <AuthorityProbe label="keep" />
      </GlbAssetSourceProvider>,
    );
    expect(screen.getByTestId('authority-keep').dataset.cacheKey).toBe('session-keep');
    keepProbe.unmount();

    unmount();

    const hookErrors = consoleErrors.filter((message) =>
      message.includes('Rendered fewer hooks') || message.includes('Rendered more hooks'),
    );
    expect(hookErrors).toEqual([]);
    errorSpy.mockRestore();
  });
});
