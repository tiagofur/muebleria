/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OnboardingTourModal,
  getHasSeenOnboardingTour,
  setHasSeenOnboardingTour,
} from './OnboardingTourModal';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

afterEach(() => {
  cleanup();
  localStorageMock.clear();
});

describe('OnboardingTourModal', () => {
  it('does not render when isOpen is false', () => {
    render(<OnboardingTourModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('onboarding-tour-modal')).toBeNull();
  });

  it('renders step 1 when isOpen is true', () => {
    render(<OnboardingTourModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('onboarding-tour-modal')).toBeTruthy();
    expect(screen.getByText(/¡Bienvenido a Muebles!/i)).toBeTruthy();
    expect(screen.getByTestId('onboarding-tour-next')).toBeTruthy();
  });

  it('advances steps when clicking Siguiente', async () => {
    const user = userEvent.setup();
    render(<OnboardingTourModal isOpen={true} onClose={vi.fn()} />);
    
    // Step 1 -> Step 2
    await user.click(screen.getByTestId('onboarding-tour-next'));
    expect(screen.getByText(/Catálogo de Muebles LatAm/i)).toBeTruthy();

    // Step 2 -> Step 3
    await user.click(screen.getByTestId('onboarding-tour-next'));
    expect(screen.getByText(/Exportación a Producción en 1 Clic/i)).toBeTruthy();
    expect(screen.getByTestId('onboarding-tour-finish')).toBeTruthy();
  });

  it('allows going back with Anterior', async () => {
    const user = userEvent.setup();
    render(<OnboardingTourModal isOpen={true} onClose={vi.fn()} />);
    
    await user.click(screen.getByTestId('onboarding-tour-next'));
    expect(screen.getByTestId('onboarding-tour-prev')).toBeTruthy();

    await user.click(screen.getByTestId('onboarding-tour-prev'));
    expect(screen.getByText(/¡Bienvenido a Muebles!/i)).toBeTruthy();
  });

  it('calls onLoadDemoProject and onClose when clicking Finish', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    const handleLoadDemo = vi.fn();

    render(
      <OnboardingTourModal
        isOpen={true}
        onClose={handleClose}
        onLoadDemoProject={handleLoadDemo}
      />,
    );

    // Go to step 3
    await user.click(screen.getByTestId('onboarding-tour-next'));
    await user.click(screen.getByTestId('onboarding-tour-next'));

    // Click Finish
    await user.click(screen.getByTestId('onboarding-tour-finish'));

    expect(handleLoadDemo).toHaveBeenCalledTimes(1);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('marks the tour as seen when dismissed with the header close button', async () => {
    const user = userEvent.setup();
    setHasSeenOnboardingTour(false);
    const handleClose = vi.fn();

    render(<OnboardingTourModal isOpen={true} onClose={handleClose} />);
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(getHasSeenOnboardingTour()).toBe(true);
  });

  it('marks the tour as seen when dismissed with Omitir', async () => {
    const user = userEvent.setup();
    setHasSeenOnboardingTour(false);
    const handleClose = vi.fn();

    render(<OnboardingTourModal isOpen={true} onClose={handleClose} />);
    await user.click(screen.getByTestId('onboarding-tour-skip'));

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(getHasSeenOnboardingTour()).toBe(true);
  });

  it('closes with Escape and marks the tour as seen', async () => {
    const user = userEvent.setup();
    setHasSeenOnboardingTour(false);
    const handleClose = vi.fn();

    render(<OnboardingTourModal isOpen={true} onClose={handleClose} />);
    await user.keyboard('{Escape}');

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(getHasSeenOnboardingTour()).toBe(true);
  });

  it('closes on overlay click and marks the tour as seen (skippable, never blocking)', async () => {
    const user = userEvent.setup();
    setHasSeenOnboardingTour(false);
    const handleClose = vi.fn();

    render(<OnboardingTourModal isOpen={true} onClose={handleClose} />);
    await user.click(screen.getByTestId('ui-modal-overlay'));

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(getHasSeenOnboardingTour()).toBe(true);
  });

  it('exposes role=dialog with resolvable aria-labelledby title', () => {
    render(<OnboardingTourModal isOpen={true} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(
      'Tour de Bienvenida — Muebles App',
    );
  });

  it('has an accessible name on the close button', () => {
    render(<OnboardingTourModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('traps Tab focus within the dialog', async () => {
    const user = userEvent.setup();
    render(<OnboardingTourModal isOpen={true} onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    }
  });

  it('returns focus to the trigger after closing', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir tour
          </button>
          <OnboardingTourModal isOpen={open} onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir tour' });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('manages onboarding tour preference in storage', () => {
    setHasSeenOnboardingTour(false);
    expect(getHasSeenOnboardingTour()).toBe(false);

    setHasSeenOnboardingTour(true);
    expect(getHasSeenOnboardingTour()).toBe(true);

    setHasSeenOnboardingTour(false);
    expect(getHasSeenOnboardingTour()).toBe(false);
  });
});
