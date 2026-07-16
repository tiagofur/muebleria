/**
 * Loading primitives (issue #30).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InlineLoading } from './InlineLoading';
import { ListSkeleton } from './ListSkeleton';
import { PageLoading } from './PageLoading';
import { Spinner } from './Spinner';
import { submitBusyLabel } from './submitBusy';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  cleanup();
});

describe('submitBusyLabel', () => {
  it('switches idle and busy labels', () => {
    expect(submitBusyLabel(false, 'Guardar')).toBe('Guardar');
    expect(submitBusyLabel(true, 'Guardar')).toBe('Guardando…');
    expect(submitBusyLabel(true, 'Guardar', 'Enviando…')).toBe('Enviando…');
  });
});

describe('Spinner / PageLoading / InlineLoading / ListSkeleton', () => {
  it('renders page loading with label and busy status', () => {
    render(<PageLoading label="Cargando espacio…" />);
    const el = screen.getByTestId('page-loading');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.textContent).toMatch(/Cargando espacio/);
  });

  it('renders inline loading', () => {
    render(<InlineLoading label="Recalculando…" data-testid="inl" />);
    expect(screen.getByTestId('inl').textContent).toMatch(/Recalculando/);
  });

  it('renders list skeleton rows', () => {
    render(<ListSkeleton rows={3} />);
    expect(screen.getByTestId('list-skeleton').children).toHaveLength(3);
  });

  it('spinner uses size class', () => {
    const { container } = render(<Spinner size="lg" aria-label="Cargando" />);
    expect(container.querySelector('.ui-spinner--lg')).toBeTruthy();
  });

  it('CSS uses design tokens only (no hex colors)', () => {
    const css = readFileSync(join(here, 'loading.css'), 'utf8');
    expect(css).toMatch(/var\(--brand-500\)/);
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
