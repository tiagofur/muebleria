/** @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  suggestNextLibraryVersion,
  useStandardLibraryWorkspace,
} from './useStandardLibraryWorkspace';
import { GraneteApiClient, GraneteApiError, type ApiError, type LibraryReleaseSummary } from '@granete/storage';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

function release(id: string, version: string, status: 'draft' | 'published'): LibraryReleaseSummary {
  return {
    id,
    libraryId: 'lib-std',
    version,
    schemaVersion: 1,
    status,
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
  };
}

function apiError(status: number, code: ApiError['code']): GraneteApiError {
  return new GraneteApiError(status, {
    code,
    message: code,
    fieldErrors: {},
    requestId: 'test',
    retryable: false,
    details: {},
  });
}

describe('suggestNextLibraryVersion (#1102 Slice A)', () => {
  it('suggests patch+1 over the max across published and drafts', () => {
    expect(
      suggestNextLibraryVersion([
        release('a', '0.3.4', 'published'),
        release('b', '0.4.0', 'draft'),
        release('c', '0.2.9', 'published'),
      ]),
    ).toBe('0.4.1');
  });

  it('ignores non-semver versions and falls back to 0.1.0', () => {
    expect(suggestNextLibraryVersion([{ version: 'proxima' } as LibraryReleaseSummary])).toBe('0.1.0');
    expect(suggestNextLibraryVersion([])).toBe('0.1.0');
  });
});

describe('useStandardLibraryWorkspace (#1102 Slice A)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  // El componente reasigna esta referencia en cada render: leer `hook!`
  // después de un act devuelve el estado MÁS NUEVO, nunca el snapshot del
  // primer render (mismo patrón que useFactoryConstructionPolicy.test.ts).
  let hook!: ReturnType<typeof useStandardLibraryWorkspace>;

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

  async function renderHook(props: { token: string | null; enabled?: boolean }) {
    function TestComponent() {
      hook = useStandardLibraryWorkspace({
        baseUrl: 'http://localhost',
        token: props.token,
        enabled: props.enabled ?? true,
      });
      return null;
    }
    await act(async () => {
      root?.render(createElement(TestComponent));
    });
  }

  it('loads published releases and open drafts, newest draft first as current', async () => {
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(release('pub-1', '0.3.4', 'published'));
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([
      release('pub-1', '0.3.4', 'published'),
      release('pub-0', '0.2.0', 'published'),
    ]);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases').mockResolvedValue([
      release('draft-2', '0.4.0', 'draft'),
      release('draft-1', '0.3.5', 'draft'),
    ]);

    await renderHook({ token: 'token-test' });

    expect(hook.currentPublished?.id).toBe('pub-1');
    expect(hook.currentDraft?.id).toBe('draft-2');
    expect(hook.draftReleases.length).toBe(2);
    expect(hook.suggestedVersion).toBe('0.4.1');
    expect(hook.error).toBeNull();
  });

  it('openDraft creates with the suggested version and refreshes', async () => {
    const createSpy = vi
      .spyOn(GraneteApiClient.prototype, 'createStandardLibraryRelease')
      .mockResolvedValue(release('draft-new', '0.3.5', 'draft'));
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(release('pub-1', '0.3.4', 'published'));
    const releasesSpy = vi
      .spyOn(GraneteApiClient.prototype, 'getStandardReleases')
      .mockResolvedValue([release('pub-1', '0.3.4', 'published')]);
    const draftsSpy = vi
      .spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([release('draft-new', '0.3.5', 'draft')]);

    await renderHook({ token: 'token-test' });
    expect(hook.currentDraft).toBeNull();

    const created: { value: LibraryReleaseSummary | null } = { value: null };
    await act(async () => {
      created.value = await hook.openDraft();
    });

    expect(created.value?.id).toBe('draft-new');
    expect(createSpy).toHaveBeenCalledWith('token-test', { version: '0.3.5' });
    expect(releasesSpy).toHaveBeenCalledTimes(2);
    expect(draftsSpy).toHaveBeenCalledTimes(2);
    expect(hook.currentDraft?.id).toBe('draft-new');
    expect(hook.error).toBeNull();
  });

  it('surfaces a distinct error when drafts are forbidden (403)', async () => {
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(release('pub-1', '0.3.4', 'published'));
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([]);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases').mockRejectedValue(
      apiError(403, 'FORBIDDEN'),
    );

    await renderHook({ token: 'token-test' });

    expect(hook.error).toContain('plataforma');
    expect(hook.currentDraft).toBeNull();
  });

  it('maps a 409 duplicate version on openDraft to an actionable message', async () => {
    vi.spyOn(GraneteApiClient.prototype, 'createStandardLibraryRelease').mockRejectedValue(
      apiError(409, 'CONFLICT'),
    );
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(release('pub-1', '0.3.4', 'published'));
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([release('pub-1', '0.3.4', 'published')]);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases').mockResolvedValue([]);

    await renderHook({ token: 'token-test' });
    await act(async () => {
      await hook.openDraft();
    });

    expect(hook.error).toContain('versión');
    expect(hook.opening).toBe(false);
  });

  it('does not fetch when disabled or token-less', async () => {
    const draftsSpy = vi.spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases');

    await renderHook({ token: null });
    await renderHook({ token: 'token-test', enabled: false });

    expect(draftsSpy).not.toHaveBeenCalled();
  });

  it('validateDraft posts the current draft and keeps the report keyed to it', async () => {
    const draft = release('draft-1', '0.3.5', 'draft');
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(release('pub-1', '0.3.4', 'published'));
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([release('pub-1', '0.3.4', 'published')]);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases').mockResolvedValue([draft]);
    const validateSpy = vi
      .spyOn(GraneteApiClient.prototype, 'validateStandardLibraryDraft')
      .mockResolvedValue({
        releaseId: draft.id,
        version: '0.3.5',
        ok: true,
        compile: { ok: true, resourceCount: 3, manifestHash: 'sha256:x' },
        furniture: { total: 1, resolved: 1, failed: 0, failures: [] },
        validatedAt: '2026-10-05T12:00:00Z',
      });

    await renderHook({ token: 'token-test' });
    expect(hook.currentValidation).toBeNull();

    let report: unknown = null;
    await act(async () => {
      report = await hook.validateDraft();
    });

    expect(validateSpy).toHaveBeenCalledWith('token-test', 'draft-1');
    expect(report).not.toBeNull();
    expect(hook.currentValidation?.ok).toBe(true);
    expect(hook.validating).toBe(false);
  });

  it('validateDraft is a no-op without an open draft', async () => {
    vi.spyOn(GraneteApiClient.prototype, 'getStandardCurrentRelease').mockResolvedValue(release('pub-1', '0.3.4', 'published'));
    vi.spyOn(GraneteApiClient.prototype, 'getStandardReleases').mockResolvedValue([]);
    vi.spyOn(GraneteApiClient.prototype, 'getStandardLibraryDraftReleases').mockResolvedValue([]);
    const validateSpy = vi.spyOn(GraneteApiClient.prototype, 'validateStandardLibraryDraft');

    await renderHook({ token: 'token-test' });
    await act(async () => {
      await hook.validateDraft();
    });

    expect(validateSpy).not.toHaveBeenCalled();
  });
});
