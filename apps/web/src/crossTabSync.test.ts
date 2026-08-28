/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCrossTabSyncForTests,
  installCrossTabRefresh,
  notifyCatalogMutated,
} from './crossTabSync';

/**
 * P0-3 mitigation (pre-demo audit): a tab that saved the catalog broadcasts a
 * signal; other tabs re-fetch from the server when the user returns to them.
 * These tests drive the module's contract through a fake BroadcastChannel and
 * visibility events.
 */

class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    FakeChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    // Broadcast reaches every OTHER channel on the same name.
    for (const other of FakeChannel.instances) {
      if (other !== this && other.onmessage) {
        other.onmessage({ data });
      }
    }
  }
  close(): void {
    FakeChannel.instances = FakeChannel.instances.filter((item) => item !== this);
  }
}

function fireVisibility(state: string): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('crossTabSync (P0-3 mitigation)', () => {
  afterEach(() => {
    __resetCrossTabSyncForTests();
    FakeChannel.instances.length = 0;
    fireVisibility('hidden');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a mutation from an external channel refreshes when this tab becomes visible', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    const refresh = vi.fn(async () => {});
    installCrossTabRefresh(refresh);

    const external = new FakeChannel('granete-catalog');
    external.postMessage('catalog-mutated');

    // While hidden: no refresh yet (never clobber the tab the user is on).
    fireVisibility('hidden');
    expect(refresh).not.toHaveBeenCalled();

    // Becoming visible after a foreign mutation triggers the refresh once.
    fireVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve();

    // Visible again without a new mutation: no extra refresh.
    fireVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('publishes mutations to an external channel', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    installCrossTabRefresh(async () => {});
    const external = new FakeChannel('granete-catalog');
    const received = vi.fn();
    external.onmessage = received;

    notifyCatalogMutated();

    expect(received).toHaveBeenCalledWith({ data: 'catalog-mutated' });
  });

  it('ignores unrelated broadcast payloads', () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    const refresh = vi.fn(async () => {});
    installCrossTabRefresh(refresh);
    const external = new FakeChannel('granete-catalog');
    external.postMessage('something-else');
    fireVisibility('visible');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps stale state after a refresh error and retries when visible again', async () => {
    vi.stubGlobal('BroadcastChannel', FakeChannel as unknown as typeof BroadcastChannel);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce();
    installCrossTabRefresh(refresh);
    const external = new FakeChannel('granete-catalog');
    external.postMessage('catalog-mutated');

    fireVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();

    fireVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);
    await Promise.resolve();

    fireVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
