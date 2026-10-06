/**
 * LibraryWorkspaceScreen tests (#1184) — el hub del ciclo de revisiones.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibraryWorkspaceScreen, type LibraryWorkspaceScreenProps } from './LibraryWorkspaceScreen';
import type {
  LibraryReleaseSummary,
  StandardDraftDiffReport,
  StandardDraftValidationReport,
} from '@granete/storage';

afterEach(() => cleanup());

const published: LibraryReleaseSummary = {
  id: 'rel-1',
  libraryId: 'lib-std',
  version: '0.3.5',
  schemaVersion: 1,
  status: 'published',
  createdAt: '2026-10-05T00:00:00Z',
  updatedAt: '2026-10-05T00:00:00Z',
};

const draft: LibraryReleaseSummary = {
  ...published,
  id: 'rel-draft',
  version: '0.3.6',
  status: 'draft',
};

function diffAgainstPublished(): StandardDraftDiffReport {
  return {
    releaseId: draft.id,
    version: draft.version,
    base: { releaseId: published.id, version: published.version },
    added: [],
    modified: [],
    removed: [],
    unchanged: 4,
    computedAt: '2026-10-06T00:00:00Z',
  };
}

function baseProps(): LibraryWorkspaceScreenProps {
  return {
    onGoHome: vi.fn(),
    currentPublished: published,
    currentDraft: draft,
    suggestedVersion: '0.3.6',
    loading: false,
    opening: false,
    error: null,
    onOpenDraft: vi.fn(),
    onValidateDraft: vi.fn(),
    publishedReleases: [published],
    currentValidation: null,
    validating: false,
    currentDiff: null,
    diffLoading: false,
    onRequestDiff: vi.fn(),
    publishing: false,
    onPublish: vi.fn(async () => true),
    consumerPin: null,
    consumerProfiles: [],
    consumerLoading: false,
    consumerError: null,
    onPinConsumer: vi.fn(),
  };
}

describe('LibraryWorkspaceScreen (#1184)', () => {
  it('concentra banner, historial abierto por defecto y vista consumidor', () => {
    render(<LibraryWorkspaceScreen {...baseProps()} />);

    // El banner identifica el borrador y sus dos acciones.
    expect(screen.getByTestId('library-draft-workspace-banner').textContent).toContain(
      'próxima versión v0.3.6',
    );
    expect(screen.getByTestId('library-draft-validate-btn')).toBeTruthy();
    expect(screen.getByTestId('library-publish-open-btn')).toBeTruthy();
    // El historial del hub nace abierto (defaultOpen).
    expect(screen.getByTestId('library-publish-history-list')).toBeTruthy();
    expect(screen.getByTestId('library-publish-history-panel').textContent).toContain('v0.3.5');
    // La vista consumidor está presente sin pin todavía.
    expect(screen.getByTestId('library-consumer-view-panel').textContent).toContain(
      'todavía no fijó una versión',
    );
  });

  it('publicar abre el modal, pide el diff y confirma con el publish atómico', async () => {
    const props = baseProps();
    render(<LibraryWorkspaceScreen {...props} />);

    fireEvent.click(screen.getByTestId('library-publish-open-btn'));
    expect(props.onRequestDiff).toHaveBeenCalledTimes(1);
    const modal = await waitFor(() => screen.getByTestId('library-publish-modal'));

    // Sin diff el confirmar queda deshabilitado (fail-closed).
    const confirm = screen.getByTestId('library-publish-confirm-btn') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(modal.textContent).toContain('Publicar biblioteca v0.3.6');
  });

  it('el publish fallido deja el modal abierto con el error visible', async () => {
    const failing: LibraryWorkspaceScreenProps = {
      ...baseProps(),
      onPublish: vi.fn(async () => false),
      currentDiff: diffAgainstPublished(),
    };
    const { rerender } = render(<LibraryWorkspaceScreen {...failing} />);

    fireEvent.click(screen.getByTestId('library-publish-open-btn'));
    const confirm = await waitFor(() => screen.getByTestId('library-publish-confirm-btn'));
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(failing.onPublish).toHaveBeenCalledTimes(1));
    // Fallo → el modal sigue abierto (el error global se muestra en el
    // banner del hub; con diff presente el confirm se rehabilita, el
    // contrato de #1102 Slice C no cambia).
    rerender(
      <LibraryWorkspaceScreen
        {...failing}
        error="No se pudo publicar la biblioteca; el release vigente sigue intacto."
      />,
    );
    expect(screen.getByTestId('library-publish-modal')).toBeTruthy();
  });

  it('el publish exitoso cierra el modal', async () => {
    const succeeding: LibraryWorkspaceScreenProps = {
      ...baseProps(),
      currentDiff: diffAgainstPublished(),
    };
    render(<LibraryWorkspaceScreen {...succeeding} />);

    fireEvent.click(screen.getByTestId('library-publish-open-btn'));
    const ok = await waitFor(() => screen.getByTestId('library-publish-confirm-btn'));
    await waitFor(() => expect((ok as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(ok);
    await waitFor(() => expect(succeeding.onPublish).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId('library-publish-modal')).toBeNull(),
    );
  });

  it('sin borrador la acción primaria es abrir el borrador sugerido', () => {
    const props: LibraryWorkspaceScreenProps = { ...baseProps(), currentDraft: null };
    render(<LibraryWorkspaceScreen {...props} />);

    const open = screen.getByTestId('library-draft-open-btn');
    expect(open.textContent).toContain('Abrir borrador v0.3.6');
    fireEvent.click(open);
    expect(props.onOpenDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('library-publish-modal')).toBeNull();
  });
});
