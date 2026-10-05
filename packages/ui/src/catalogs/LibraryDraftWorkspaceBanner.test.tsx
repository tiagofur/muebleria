/**
 * LibraryDraftWorkspaceBanner tests (#1102 LIB-AUTH Slice A).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryDraftWorkspaceBanner } from './LibraryDraftWorkspaceBanner';
import type { LibraryReleaseSummary } from '@granete/storage';

afterEach(() => cleanup());

const published: LibraryReleaseSummary = {
  id: 'rel-1',
  libraryId: 'lib-std',
  version: '0.3.4',
  schemaVersion: 1,
  status: 'published',
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
};

const draft: LibraryReleaseSummary = {
  ...published,
  id: 'rel-draft',
  version: '0.3.5',
  status: 'draft',
};

describe('LibraryDraftWorkspaceBanner (#1102)', () => {
  it('offers opening a draft when none is open, showing the published version', () => {
    const onOpenDraft = vi.fn();
    render(
      <LibraryDraftWorkspaceBanner
        currentPublished={published}
        currentDraft={null}
        suggestedVersion="0.3.5"
        loading={false}
        opening={false}
        error={null}
        onOpenDraft={onOpenDraft}
      />,
    );

    expect(screen.getByTestId('library-draft-workspace-banner').textContent).toContain('Sin borrador abierto');
    expect(screen.getByTestId('library-published-badge').textContent).toContain('v0.3.4');
    const button = screen.getByTestId('library-draft-open-btn');
    expect(button.textContent).toContain('v0.3.5');
    fireEvent.click(button);
    expect(onOpenDraft).toHaveBeenCalledTimes(1);
  });

  it('shows the editing state when a draft is open and hides the open button', () => {
    render(
      <LibraryDraftWorkspaceBanner
        currentPublished={published}
        currentDraft={draft}
        suggestedVersion="0.3.6"
        loading={false}
        opening={false}
        error={null}
        onOpenDraft={vi.fn()}
      />,
    );

    expect(screen.getByTestId('library-draft-workspace-banner').textContent).toContain('próxima versión v0.3.5');
    expect(screen.queryByTestId('library-draft-open-btn')).toBeNull();
  });

  it('renders a distinct alert state when the workspace cannot load', () => {
    render(
      <LibraryDraftWorkspaceBanner
        currentPublished={null}
        currentDraft={null}
        suggestedVersion="0.1.0"
        loading={false}
        opening={false}
        error="Tu sesión ya no tiene autoridad de plataforma; recargá para sincronizar."
        onOpenDraft={vi.fn()}
      />,
    );

    const banner = screen.getByTestId('library-draft-workspace-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('autoridad de plataforma');
    expect(screen.queryByTestId('library-draft-open-btn')).toBeNull();
  });

  it('renders the loading state without content promises', () => {
    render(
      <LibraryDraftWorkspaceBanner
        currentPublished={null}
        currentDraft={null}
        suggestedVersion="0.1.0"
        loading
        opening={false}
        error={null}
        onOpenDraft={vi.fn()}
      />,
    );

    expect(screen.getByTestId('library-draft-workspace-loading')).toBeTruthy();
  });
});
