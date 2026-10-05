/**
 * LibraryPublishConfirmContent + LibraryPublishHistoryPanel tests
 * (#1102 LIB-AUTH Slice C).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryPublishConfirmContent } from './LibraryPublishConfirmContent';
import { LibraryPublishHistoryPanel } from './LibraryPublishHistoryPanel';
import type { LibraryReleaseSummary, StandardDraftDiffReport } from '@granete/storage';

afterEach(() => cleanup());

const diff: StandardDraftDiffReport = {
  releaseId: 'rel-draft',
  version: '0.3.5',
  base: { releaseId: 'rel-base', version: '0.3.4' },
  added: [{ kind: 'hardware_profile', id: 'a0000010-0000-0000-0000-000000000001', code: 'PERF-X', name: 'Perfil X' }],
  modified: [{ kind: 'hardware', id: 'a0000003-0000-0000-0000-000000000013', code: 'BIS-CL200', name: 'Bisagra CL200' }],
  removed: [{ kind: 'hardware', id: 'a0000003-0000-0000-0000-000000000099', code: 'BIS-VIEJA', name: 'Bisagra vieja' }],
  unchanged: 5,
  computedAt: '2026-10-05T12:00:00Z',
};

const published: LibraryReleaseSummary = {
  id: 'rel-1',
  libraryId: 'lib-std',
  version: '0.3.4',
  schemaVersion: 1,
  status: 'published',
  manifestHash: 'sha256:abcdef0123456789abcdef',
  changelog: 'perfiles minifix',
  publishedAt: '2026-10-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('LibraryPublishConfirmContent (#1102 Slice C)', () => {
  const baseProps = {
    version: '0.3.5',
    loading: false,
    error: null,
    publishing: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('shows the loading state while the diff is computed', () => {
    render(<LibraryPublishConfirmContent {...baseProps} diff={null} loading />);
    expect(screen.getByTestId('library-publish-diff-loading')).toBeTruthy();
    // No se puede confirmar sin diff.
    expect((screen.getByTestId('library-publish-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the labeled diff summary against the published base', () => {
    render(<LibraryPublishConfirmContent {...baseProps} diff={diff} loading={false} />);
    expect(screen.getByTestId('library-publish-diff-summary').textContent).toContain('Sin cambios: 5');
    const panel = document.body.textContent ?? '';
    expect(panel).toContain('Cambios contra v0.3.4 (publicada)');
    const summary = screen.getByTestId('library-publish-diff-summary');
    expect(summary.textContent).toContain('Nuevos (1)');
    expect(summary.textContent).toContain('PERF-X');
    expect(summary.textContent).toContain('Modificados (1)');
    expect(summary.textContent).toContain('BIS-CL200');
    expect(summary.textContent).toContain('Eliminados (1)');
    expect(summary.textContent).toContain('BIS-VIEJA');
    expect(summary.textContent).toContain('Sin cambios: 5');
    expect((screen.getByTestId('library-publish-confirm-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('confirms and cancels through its buttons', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <LibraryPublishConfirmContent
        {...baseProps}
        diff={diff}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId('library-publish-confirm-btn'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('library-publish-cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables confirm while publishing and surfaces a diff error', () => {
    render(
      <LibraryPublishConfirmContent
        {...baseProps}
        diff={null}
        loading={false}
        error="El borrador no compila: perfil inválido"
      />,
    );
    expect(screen.getByTestId('library-publish-diff-error').textContent).toContain('no compila');
    expect((screen.getByTestId('library-publish-confirm-btn') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('LibraryPublishHistoryPanel (#1102 Slice C)', () => {
  it('renders collapsed by default and expands into the version list', () => {
    render(<LibraryPublishHistoryPanel releases={[published]} />);
    expect(screen.getByTestId('library-publish-history-toggle').textContent).toContain('Historial de versiones publicadas (1)');
    expect(screen.queryByTestId('library-publish-history-list')).toBeNull();

    fireEvent.click(screen.getByTestId('library-publish-history-toggle'));
    const list = screen.getByTestId('library-publish-history-list');
    expect(list.textContent).toContain('v0.3.4');
    expect(list.textContent).toContain('perfiles minifix');
    expect(list.textContent).toContain('sha256:abcdef012345…');
  });

  it('explains when nothing was published yet', () => {
    render(<LibraryPublishHistoryPanel releases={[published, { ...published, id: 'rel-2', version: '0.2.0' }]} />);
    fireEvent.click(screen.getByTestId('library-publish-history-toggle'));
    expect(screen.getByTestId('library-publish-history-list').textContent).toContain('v0.2.0');
  });
});
