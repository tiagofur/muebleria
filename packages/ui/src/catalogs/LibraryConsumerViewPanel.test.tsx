/**
 * LibraryConsumerViewPanel tests (#1102 LIB-AUTH Slice D).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LibraryConsumerViewPanel } from './LibraryConsumerViewPanel';
import type { HardwareProfile, LibraryReleaseSummary } from '@granete/storage';

afterEach(() => cleanup());

function release(id: string, version: string): LibraryReleaseSummary {
  return {
    id,
    libraryId: 'lib-std',
    version,
    schemaVersion: 1,
    status: 'published',
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T00:00:00Z',
  };
}

const published = [release('rel-new', '0.3.5'), release('rel-old', '0.3.4')];
const profiles: ReadonlyArray<HardwareProfile> = [
  {
    id: 'p1', code: 'PERF-X', name: 'Perfil X', revision: 'r1', active: true, items: [],
    version: 1, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z',
  },
  {
    id: 'p2', code: 'PERF-BASE', name: 'Perfil Base', revision: 'r2', active: true, items: [],
    version: 1, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z',
  },
];

describe('LibraryConsumerViewPanel (#1102 Slice D)', () => {
  const baseProps = {
    published,
    profiles: [] as ReadonlyArray<HardwareProfile>,
    loading: false,
    error: null,
    onPin: vi.fn(),
  };

  it('offers pinning when the consumer has no release', () => {
    render(<LibraryConsumerViewPanel {...baseProps} pin={null} />);

    expect(screen.getByTestId('library-consumer-view-panel').textContent).toContain('todavía no fijó');
    const update = screen.getByTestId('library-consumer-update-btn');
    expect(update.textContent).toContain('Fijar consumidor a v0.3.5');
    fireEvent.click(update);
    expect(baseProps.onPin).toHaveBeenCalledWith('rel-new');
  });

  it('shows the pinned version and its frozen profiles', () => {
    render(<LibraryConsumerViewPanel {...baseProps} pin="rel-new" profiles={profiles} />);

    expect(screen.getByTestId('library-consumer-pin-badge').textContent).toContain('v0.3.5');
    expect(screen.getByTestId('library-consumer-content').textContent).toContain('PERF-X, PERF-BASE');
    // Fijado a la última: no hay botón de actualizar.
    expect(screen.queryByTestId('library-consumer-update-btn')).toBeNull();
  });

  it('explains that an outdated consumer stays behind until its own update', () => {
    const onPin = vi.fn();
    render(<LibraryConsumerViewPanel {...baseProps} pin="rel-old" profiles={profiles} onPin={onPin} />);

    const panel = screen.getByTestId('library-consumer-view-panel');
    expect(panel.textContent).toContain('quedó en la versión vieja');
    const update = screen.getByTestId('library-consumer-update-btn');
    expect(update.textContent).toContain('Actualizar a v0.3.5');
    fireEvent.click(update);
    expect(onPin).toHaveBeenCalledWith('rel-new');
    // Y puede fijarse manualmente a cualquier versión publicada.
    expect(screen.getByTestId('library-consumer-pin-select')).toBeTruthy();
  });

  it('renders the loading and error states', () => {
    render(<LibraryConsumerViewPanel {...baseProps} pin="rel-new" loading />);
    expect(screen.getByTestId('library-consumer-loading')).toBeTruthy();

    cleanup();
    render(
      <LibraryConsumerViewPanel
        {...baseProps}
        pin="rel-new"
        error="No se pudo leer el contenido del release pineado."
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('No se pudo leer');
  });
});
