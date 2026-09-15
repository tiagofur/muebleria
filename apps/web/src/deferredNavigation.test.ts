import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureDeferredNavigationIntent,
  deferredNavigationStillCurrent,
  runDeferredNavigationGuarded,
} from './deferredNavigation';

const intent = captureDeferredNavigationIntent({
  scopeKey: '["web","gen-1","org-a"]',
  path: '/quotes/p-1/reconciliacion?qrev=q1',
});

describe('deferredNavigation (#738 review)', () => {
  it('proceeds when scope, path and session are unchanged', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-1","org-a"]',
        path: '/quotes/p-1/reconciliacion?qrev=q1',
        sessionActive: true,
      }),
    ).toBe(true);
  });

  it('blocks a late navigation after the user moved to another route/project', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-1","org-a"]',
        path: '/quotes/p-2',
        sessionActive: true,
      }),
    ).toBe(false);
  });

  it('blocks after an organization/session switch', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-2","org-b"]',
        path: '/quotes/p-1/reconciliacion?qrev=q1',
        sessionActive: true,
      }),
    ).toBe(false);
  });

  it('blocks when the session ended', () => {
    expect(
      deferredNavigationStillCurrent(intent, {
        scopeKey: '["web","gen-1","org-a"]',
        path: '/quotes/p-1/reconciliacion?qrev=q1',
        sessionActive: false,
      }),
    ).toBe(false);
  });
});

/* ── Integration: the composed run against a controllable refresh ────────── */

interface Deferred {
  resolve: () => void;
  reject: (reason?: unknown) => void;
  promise: Promise<void>;
}

function defer(): Deferred {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

function setupRun(liveOverrides?: Partial<{ scopeKey: string | null; path: string; sessionActive: boolean }>) {
  const refresh = defer();
  const navigate = vi.fn();
  let live = {
    scopeKey: '["web","gen-1","org-a"]' as string | null,
    path: '/quotes/p-1/reconciliacion?qrev=q1',
    sessionActive: true,
    ...liveOverrides,
  };
  runDeferredNavigationGuarded({
    projectId: 'p-1',
    releaseId: 'rel-1',
    start: intent,
    deps: {
      refreshWorkspace: () => refresh.promise,
      navigate,
      live: () => live,
      target: (projectId, releaseId) =>
        `/engineering/${projectId}?release=${releaseId}`,
    },
  });
  return {
    refresh,
    navigate,
    changeLive: (next: Partial<typeof live>) => {
      live = { ...live, ...next };
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('runDeferredNavigationGuarded — integration (#738 review)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: refresh resolves with the context intact → navigates to the exact project+release', async () => {
    const { refresh, navigate } = setupRun();
    expect(navigate).not.toHaveBeenCalled();
    refresh.resolve();
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/engineering/p-1?release=rel-1');
  });

  it('late route change while the refresh is pending → resolution does NOT navigate', async () => {
    const { refresh, navigate, changeLive } = setupRun();
    changeLive({ path: '/quotes/p-2' });
    refresh.resolve();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('late organization/session switch while the refresh is pending → resolution does NOT navigate', async () => {
    const { refresh, navigate, changeLive } = setupRun();
    changeLive({ scopeKey: '["web","gen-2","org-b"]' });
    refresh.resolve();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('session ends while the refresh is pending → resolution does NOT navigate', async () => {
    const { refresh, navigate, changeLive } = setupRun();
    changeLive({ sessionActive: false });
    refresh.resolve();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('refresh REJECTS with the context intact → still navigates (the workspace fetches its own context)', async () => {
    const { refresh, navigate } = setupRun();
    refresh.reject(new Error('transient'));
    await flush();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/engineering/p-1?release=rel-1');
  });

  it('refresh REJECTS after the context changed → does NOT navigate', async () => {
    const { refresh, navigate, changeLive } = setupRun();
    changeLive({ path: '/engineering/p-9' });
    refresh.reject(new Error('transient'));
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not re-navigate when the live path already is the exact target', async () => {
    const { refresh, navigate, changeLive } = setupRun();
    // e.g. a second invocation of the same CTA raced ahead.
    changeLive({ path: '/engineering/p-1?release=rel-1' });
    refresh.resolve();
    await flush();
    expect(navigate).not.toHaveBeenCalled();
  });
});
