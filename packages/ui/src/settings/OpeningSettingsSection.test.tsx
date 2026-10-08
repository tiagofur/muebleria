/**
 * OpeningSettingsSection tests (#1134).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpeningSettingsSection } from './OpeningSettingsSection';
import { DEFAULT_OPENING_CAPABILITIES, type OpeningCapabilities } from '@granete/domain';

afterEach(() => cleanup());

describe('OpeningSettingsSection (#1134)', () => {
  it('muestra los defaults de biblioteca cuando no hay decisión de fábrica', () => {
    render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByTestId('settings-section-opening')).toBeTruthy();
    expect(screen.getByTestId('opening-system-handle-enabled')).toHaveProperty('checked', true);
    expect(screen.getByTestId('opening-system-gola-enabled')).toHaveProperty('checked', true);
    expect(screen.getByTestId('opening-system-bottom_overhang-enabled')).toHaveProperty('checked', true);
    expect(screen.getByText(/Sin decisión de fábrica todavía/)).toBeTruthy();
    // Gola sin curaduría: la oferta existe, los perfiles exactos quedan pendientes.
    expect(screen.getByTestId('opening-gola-profiles').textContent).toContain('Sin curaduría todavía');
  });

  it('marca como no disponible un sistema deshabilitado sin tocar los demás', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('opening-system-gola-enabled'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        grips: expect.objectContaining({
          handle: expect.objectContaining({ enabled: true }),
          gola: expect.objectContaining({ enabled: false, default: false }),
        }),
      }),
    );
  });

  it('mantiene un único sistema preseleccionado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('opening-system-gola-default'));
    const payload = onChange.mock.calls[0]?.[0] as OpeningCapabilities;
    const defaults = Object.values(payload.grips).filter((g) => g?.default);
    expect(defaults).toHaveLength(1);
    expect(payload.grips.gola?.default).toBe(true);
    expect(payload.grips.handle?.default).toBe(false);
  });

  it('restringe placements por tipo de mueble', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('opening-type-superior-gola-top'));
    const payload = onChange.mock.calls[0]?.[0] as OpeningCapabilities;
    expect(payload.byFurnitureType?.superior?.grips?.gola?.placements).toEqual(['top']);
  });

  it('guarda y muestra el error del servidor cuando falla', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const { rerender } = render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByTestId('opening-capabilities-save'));
    expect(onSave).toHaveBeenCalled();

    rerender(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={vi.fn()}
        onSave={onSave}
        error="solo administración de fábrica"
      />,
    );
    expect(screen.getByTestId('opening-capabilities-error').textContent).toContain(
      'solo administración de fábrica',
    );
  });
});
