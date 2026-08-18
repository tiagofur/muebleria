/**
 * ScreenBoundary — per-screen fallback keeps the shell alive (Fase 5.4).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenBoundary } from './ScreenBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('boom-pantalla');
}

describe('ScreenBoundary', () => {
  it('shows the screen-scoped fallback instead of the root one', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ScreenBoundary screenLabel="Fábrica">
        <Boom />
      </ScreenBoundary>,
    );

    expect(screen.getByTestId('screen-error-fallback')).toBeTruthy();
    expect(screen.getByText('No pudimos mostrar Fábrica')).toBeTruthy();
    expect(screen.getByText('boom-pantalla')).toBeTruthy();
    expect(screen.queryByTestId('error-boundary-fallback')).toBeNull();
  });

  it('Reintentar recovers when the screen stops throwing, Ir al inicio escapes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    let shouldThrow = true;

    function MaybeBoom() {
      if (shouldThrow) throw new Error('temporary');
      return <p>cola de corte</p>;
    }

    const { rerender } = render(
      <ScreenBoundary screenLabel="Fábrica" onGoHome={onGoHome}>
        <MaybeBoom />
      </ScreenBoundary>,
    );
    expect(screen.getByTestId('screen-error-fallback')).toBeTruthy();
    expect(onGoHome).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Ir al inicio/i }));
    expect(onGoHome).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /Reintentar/i }));
    rerender(
      <ScreenBoundary screenLabel="Fábrica" onGoHome={onGoHome}>
        <MaybeBoom />
      </ScreenBoundary>,
    );
    expect(screen.getByText('cola de corte')).toBeTruthy();
    expect(screen.queryByTestId('screen-error-fallback')).toBeNull();
  });
});
