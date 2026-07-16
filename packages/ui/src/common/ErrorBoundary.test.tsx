/**
 * ErrorBoundary — render throw must show fallback instead of blanking the tree.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Boom(): never {
  throw new Error('boom-test');
}

describe('ErrorBoundary', () => {
  it('renders fallback when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();
    expect(screen.getByText('Algo salió mal')).toBeTruthy();
    expect(screen.getByText('boom-test')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Recargar/i }),
    ).toBeTruthy();
  });

  it('reset clears error and re-renders children when they stop throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    let shouldThrow = true;

    function MaybeBoom() {
      if (shouldThrow) throw new Error('temporary');
      return <p>recovered</p>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-fallback')).toBeTruthy();

    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /Intentar de nuevo/i }));
    rerender(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('recovered')).toBeTruthy();
  });
});
