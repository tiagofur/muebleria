/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('manages onboarding tour preference in storage', () => {
    setHasSeenOnboardingTour(false);
    expect(getHasSeenOnboardingTour()).toBe(false);

    setHasSeenOnboardingTour(true);
    expect(getHasSeenOnboardingTour()).toBe(true);

    setHasSeenOnboardingTour(false);
    expect(getHasSeenOnboardingTour()).toBe(false);
  });
});
