/**
 * LibraryDraftContextLine tests (#1184) — la línea contextual de las
 * superficies de autoría (reemplazo del stack de revisiones).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LibraryDraftContextLine } from './LibraryDraftContextLine';

afterEach(() => cleanup());

describe('LibraryDraftContextLine (#1184)', () => {
  it('identifica el borrador y sale al hub con un link real', () => {
    render(<LibraryDraftContextLine draftVersion="0.3.6" href="/library" />);

    const line = screen.getByTestId('library-draft-context-line');
    expect(line.getAttribute('role')).toBe('status');
    expect(line.textContent).toContain('borrador v0.3.6');
    expect(line.textContent).toContain('tus edits entran a esta versión');
    const link = screen.getByTestId('library-draft-context-link');
    expect(link.getAttribute('href')).toBe('/library');
    expect(link.textContent).toContain('Ir a Biblioteca');
  });
});
