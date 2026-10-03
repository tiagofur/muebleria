/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFactoryConstructionPolicy } from './useFactoryConstructionPolicy';
import { GraneteApiClient, type LibraryOverlayDetail, type LibraryReleaseSummary, type LibraryOverlayConflictDetail } from '@granete/storage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

describe('useFactoryConstructionPolicy (#875, #944)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const mockRelease1: LibraryReleaseSummary = {
    id: 'rel-1',
    libraryId: 'lib-std',
    version: '1.0.0',
    schemaVersion: 1,
    status: 'published',
    changelog: 'Initial release',
    publishedAt: '2026-09-01T00:00:00Z',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const mockRelease2: LibraryReleaseSummary = {
    id: 'rel-2',
    libraryId: 'lib-std',
    version: '1.1.0',
    schemaVersion: 1,
    status: 'published',
    changelog: 'Updated joint standards',
    publishedAt: '2026-09-15T00:00:00Z',
    createdAt: '2026-09-15T00:00:00Z',
    updatedAt: '2026-09-15T00:00:00Z',
  };

  const mockOverlay: LibraryOverlayDetail = {
    id: 'overlay-1',
    organizationId: 'org-1',
    libraryId: 'lib-std',
    baseReleaseId: 'rel-1',
    status: 'active',
    overrides: {
      'joint.floorToSide.systemId': 'screw-only',
    },
    customResourceIds: [],
    version: 1,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
  };

  it('fetches overlay, current release, and published releases', async () => {
    vi.spyOn(GraneteApiClient.prototype, 'getActiveStandardLibraryOverlay').mockResolvedValue(mockOverlay);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(mockRelease2);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([mockRelease2, mockRelease1]);

    let hookResult!: ReturnType<typeof useFactoryConstructionPolicy>;
    function TestComponent() {
      hookResult = useFactoryConstructionPolicy({
        baseUrl: 'http://localhost',
        token: 'token-test',
        enabled: true,
      });
      return null;
    }

    await act(async () => {
      root?.render(createElement(TestComponent));
    });

    expect(hookResult.activeOverlay?.id).toBe('overlay-1');
    expect(hookResult.releases.length).toBe(2);
    expect(hookResult.latestRelease?.id).toBe('rel-2');
    expect(hookResult.hasUpstreamUpdate).toBe(true);
    expect(hookResult.conflicts).toEqual([]);
  });

  it('fetches unresolved conflicts if overlay is in rebase_conflict status', async () => {
    const conflictOverlay: LibraryOverlayDetail = {
      ...mockOverlay,
      status: 'rebase_conflict',
    };
    const mockConflict: LibraryOverlayConflictDetail = {
      id: 'conflict-1',
      overlayId: 'overlay-1',
      organizationId: 'org-1',
      oldBaseReleaseId: 'rel-1',
      newBaseReleaseId: 'rel-2',
      conflictType: 'same_field',
      path: 'joint.floorToSide.systemId',
      oldBaseValue: 'minifix-dowel',
      newBaseValue: 'dowel-only',
      customValue: 'screw-only',
      status: 'pending',
      resolutionAction: null,
      resolvedValue: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: '2026-09-20T00:00:00Z',
    };

    vi.spyOn(GraneteApiClient.prototype, 'getActiveStandardLibraryOverlay').mockResolvedValue(conflictOverlay);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(mockRelease2);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([mockRelease2, mockRelease1]);
    vi.spyOn(GraneteApiClient.prototype, 'listLibraryOverlayConflicts').mockResolvedValue([mockConflict]);

    let hookResult!: ReturnType<typeof useFactoryConstructionPolicy>;
    function TestComponent() {
      hookResult = useFactoryConstructionPolicy({
        baseUrl: 'http://localhost',
        token: 'token-test',
        enabled: true,
      });
      return null;
    }

    await act(async () => {
      root?.render(createElement(TestComponent));
    });

    expect(hookResult.activeOverlay?.status).toBe('rebase_conflict');
    expect(hookResult.conflicts.length).toBe(1);
    expect(hookResult.conflicts[0]?.id).toBe('conflict-1');
  });

  it('rebases overlay to target release and updates conflicts if collisions occur', async () => {
    vi.spyOn(GraneteApiClient.prototype, 'getActiveStandardLibraryOverlay').mockResolvedValue(mockOverlay);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(mockRelease1);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([mockRelease2, mockRelease1]);

    const mockConflict: LibraryOverlayConflictDetail = {
      id: 'conflict-1',
      overlayId: 'overlay-1',
      organizationId: 'org-1',
      oldBaseReleaseId: 'rel-1',
      newBaseReleaseId: 'rel-2',
      conflictType: 'same_field',
      path: 'joint.floorToSide.systemId',
      oldBaseValue: 'minifix-dowel',
      newBaseValue: 'dowel-only',
      customValue: 'screw-only',
      status: 'pending',
      resolutionAction: null,
      resolvedValue: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: '2026-09-20T00:00:00Z',
    };

    const rebaseSpy = vi.spyOn(GraneteApiClient.prototype, 'rebaseLibraryOverlay').mockResolvedValue({
      overlayId: 'overlay-1',
      oldBaseReleaseId: 'rel-1',
      newBaseReleaseId: 'rel-2',
      hasConflicts: true,
      status: 'rebase_conflict',
      conflicts: [mockConflict],
    });

    const getOverlaySpy = vi.spyOn(GraneteApiClient.prototype, 'getLibraryOverlayById').mockResolvedValue({
      ...mockOverlay,
      baseReleaseId: 'rel-2',
      status: 'rebase_conflict',
    });

    let hookResult!: ReturnType<typeof useFactoryConstructionPolicy>;
    function TestComponent() {
      hookResult = useFactoryConstructionPolicy({
        baseUrl: 'http://localhost',
        token: 'token-test',
        enabled: true,
      });
      return null;
    }

    await act(async () => {
      root?.render(createElement(TestComponent));
    });

    await act(async () => {
      await hookResult.rebaseToRelease('rel-2');
    });

    expect(rebaseSpy).toHaveBeenCalledWith('token-test', 'overlay-1', { targetReleaseId: 'rel-2' });
    expect(getOverlaySpy).toHaveBeenCalledWith('token-test', 'overlay-1');
    expect(hookResult.conflicts.length).toBe(1);
    expect(hookResult.activeOverlay?.status).toBe('rebase_conflict');
  });

  it('resolves conflict and reactivates overlay when all resolved', async () => {
    const conflictOverlay: LibraryOverlayDetail = {
      ...mockOverlay,
      status: 'rebase_conflict',
    };
    const mockConflict: LibraryOverlayConflictDetail = {
      id: 'conflict-1',
      overlayId: 'overlay-1',
      organizationId: 'org-1',
      oldBaseReleaseId: 'rel-1',
      newBaseReleaseId: 'rel-2',
      conflictType: 'same_field',
      path: 'joint.floorToSide.systemId',
      oldBaseValue: 'minifix-dowel',
      newBaseValue: 'dowel-only',
      customValue: 'screw-only',
      status: 'pending',
      resolutionAction: null,
      resolvedValue: null,
      resolvedBy: null,
      resolvedAt: null,
      createdAt: '2026-09-20T00:00:00Z',
    };

    vi.spyOn(GraneteApiClient.prototype, 'getActiveStandardLibraryOverlay').mockResolvedValue(conflictOverlay);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(mockRelease2);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([mockRelease2, mockRelease1]);
    vi.spyOn(GraneteApiClient.prototype, 'listLibraryOverlayConflicts').mockResolvedValue([
      { ...mockConflict, resolvedAt: '2026-09-21T00:00:00Z', resolutionAction: 'keep_custom', status: 'resolved' },
    ]);

    const resolveSpy = vi.spyOn(GraneteApiClient.prototype, 'resolveLibraryOverlayConflict').mockResolvedValue({
      ...mockConflict,
      resolvedAt: '2026-09-21T00:00:00Z',
      resolutionAction: 'keep_custom',
      status: 'resolved',
    });

    vi.spyOn(GraneteApiClient.prototype, 'getLibraryOverlayById').mockResolvedValue({
      ...mockOverlay,
      baseReleaseId: 'rel-2',
      status: 'active',
    });

    let hookResult!: ReturnType<typeof useFactoryConstructionPolicy>;
    function TestComponent() {
      hookResult = useFactoryConstructionPolicy({
        baseUrl: 'http://localhost',
        token: 'token-test',
        enabled: true,
      });
      return null;
    }

    await act(async () => {
      root?.render(createElement(TestComponent));
    });

    await act(async () => {
      await hookResult.resolveConflict('conflict-1', 'keep_custom');
    });

    expect(resolveSpy).toHaveBeenCalledWith('token-test', 'overlay-1', 'conflict-1', { action: 'keep_custom' });
    expect(hookResult.conflicts).toEqual([]);
    expect(hookResult.activeOverlay?.status).toBe('active');
  });
});
