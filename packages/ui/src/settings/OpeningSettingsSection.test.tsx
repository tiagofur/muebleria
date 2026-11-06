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

/** #1329 — two gola L of different makers + one gola C, curated. */
const curatedCapabilities = (): OpeningCapabilities => ({
  version: 1,
  grips: {
    handle: { enabled: true, default: true },
    gola: {
      enabled: true,
      default: false,
      profiles: ['profile.gola-l.scilm', 'profile.gola-l.marca-b', 'profile.gola-c.alu'],
    },
  },
});

const catalogProfiles = [
  {
    id: 'profile.gola-l.scilm',
    code: 'GOLA-L-SCILM-8006',
    name: 'Gola L SCILM 8006',
    manufacturer: 'SCILM',
    crossSection: 'L',
    active: true,
    datasheetStatus: 'verified',
  },
  {
    id: 'profile.gola-l.marca-b',
    code: 'GOLA-L-MARCA-B',
    name: 'Gola L Marca B',
    manufacturer: 'Marca B',
    crossSection: 'L',
    active: true,
    datasheetStatus: 'verified',
  },
  {
    id: 'profile.gola-c.alu',
    code: 'GOLA-C-ALU',
    name: 'Gola C aluminio',
    manufacturer: null,
    crossSection: 'C',
    active: true,
    datasheetStatus: 'verified',
  },
];

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
    expect(screen.getByText(/Todavía no guardaste esta configuración/)).toBeTruthy();
    // Gola sin perfiles elegidos: la oferta existe, aparecen todos los de ficha completa.
    expect(screen.getByTestId('opening-gola-profiles').textContent).toContain('Todavía no elegiste perfiles');
    // #1525: no internal jargon left in the section.
    const text = screen.getByTestId('settings-section-opening').textContent ?? '';
    for (const jargon of ['biblioteca fijada', 'curaduría', 'evidencia de campo', 'autoría']) {
      expect(text).not.toContain(jargon);
    }
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

  it('#1525 cada sistema dice qué habilita el check: «Ofrecer en SketchUp»', () => {
    render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    for (const system of ['handle', 'gola', 'bottom_overhang']) {
      const checkbox = screen.getByTestId(`opening-system-${system}-enabled`);
      expect(checkbox.closest('label')?.textContent).toContain('Ofrecer en SketchUp');
    }
  });

  it('#1525 no muestra los controles sin efecto (preselección y restricciones por tipo)', () => {
    render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('opening-by-furniture-type')).toBeNull();
    expect(screen.queryByTestId('opening-system-gola-default')).toBeNull();
    expect(screen.queryByText(/Sistema preseleccionado/)).toBeNull();
    expect(screen.queryByText(/Restricciones por tipo de mueble/)).toBeNull();
  });

  it('#1525 cambiar un sistema conserva byFurnitureType y default ya guardados', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const stored: OpeningCapabilities = {
      version: 1,
      grips: {
        handle: { enabled: true, default: true },
        gola: { enabled: true, default: false },
        bottom_overhang: { enabled: true, default: false },
      },
      byFurnitureType: { superior: { grips: { gola: { placements: ['top'], default: true } } } },
    };
    render(<OpeningSettingsSection capabilities={stored} decided onChange={onChange} onSave={vi.fn()} />);

    await user.click(screen.getByTestId('opening-system-bottom_overhang-enabled'));
    const payload = onChange.mock.calls[0]?.[0] as OpeningCapabilities;
    expect(payload.byFurnitureType).toEqual(stored.byFurnitureType);
    expect(payload.grips.handle?.default).toBe(true);
    expect(payload.grips.bottom_overhang?.enabled).toBe(false);
  });

  it('#1525 el rebase pide los milímetros y avisa que sin ellos queda bloqueado', async () => {
    const user = userEvent.setup();
    const onOverhangChange = vi.fn();
    const { rerender } = render(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={vi.fn()}
        onSave={vi.fn()}
        overhangMm=""
        onOverhangChange={onOverhangChange}
      />,
    );
    expect(screen.getByTestId('opening-overhang-hint').textContent).toContain('queda bloqueado en SketchUp');
    await user.type(screen.getByTestId('opening-overhang-mm'), '2');
    expect(onOverhangChange).toHaveBeenLastCalledWith('2');

    rerender(
      <OpeningSettingsSection
        capabilities={DEFAULT_OPENING_CAPABILITIES}
        decided
        onChange={vi.fn()}
        onSave={vi.fn()}
        overhangMm="20"
        onOverhangChange={onOverhangChange}
      />,
    );
    expect(screen.getByTestId('opening-overhang-mm')).toHaveProperty('value', '20');
    expect(screen.getByTestId('opening-overhang-hint').textContent).not.toContain('bloqueado');
  });

  it('#1329 nombra los perfiles curados con fabricante y sección', () => {
    render(
      <OpeningSettingsSection
        capabilities={curatedCapabilities()}
        decided
        onChange={vi.fn()}
        onSave={vi.fn()}
        profiles={catalogProfiles}
      />,
    );
    const list = screen.getByTestId('opening-gola-profiles');
    expect(list.textContent).toContain('GOLA-L-SCILM-8006 — Gola L SCILM 8006 (SCILM)');
    expect(list.textContent).toContain('GOLA-L-MARCA-B — Gola L Marca B (Marca B)');
    expect(list.textContent).toContain('GOLA-C-ALU — Gola C aluminio');
  });

  it('#1329 marca el estándar por sección: otra marca de la MISMA sección lo reemplaza', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Controlled component: feed each change back so the next click starts
    // from the state the caller would have committed.
    let current = curatedCapabilities();
    const { rerender } = render(
      <OpeningSettingsSection
        capabilities={current}
        decided
        onChange={(next) => {
          current = next;
          onChange(next);
        }}
        onSave={vi.fn()}
        profiles={catalogProfiles}
      />,
    );
    const rerenderWith = () =>
      rerender(
        <OpeningSettingsSection
          capabilities={current}
          decided
          onChange={(next) => {
            current = next;
            onChange(next);
          }}
          onSave={vi.fn()}
          profiles={catalogProfiles}
        />,
      );

    await user.click(screen.getByTestId('opening-standard-L-profile.gola-l.scilm'));
    rerenderWith();
    expect(current.grips.gola?.standardProfiles).toEqual({ L: 'profile.gola-l.scilm' });

    // Marcar el OTRO gola L reemplaza (una marca por sección)…
    await user.click(screen.getByTestId('opening-standard-L-profile.gola-l.marca-b'));
    rerenderWith();
    expect(current.grips.gola?.standardProfiles).toEqual({ L: 'profile.gola-l.marca-b' });

    // …y una sección distinta convive sin pisar la primera.
    await user.click(screen.getByTestId('opening-standard-C-profile.gola-c.alu'));
    rerenderWith();
    expect(current.grips.gola?.standardProfiles).toEqual({
      L: 'profile.gola-l.marca-b',
      C: 'profile.gola-c.alu',
    });
  });

  it('#1329 quitar estándar omite la sección; sin marcas la clave desaparece', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const withStandard: OpeningCapabilities = {
      ...curatedCapabilities(),
      grips: {
        ...curatedCapabilities().grips,
        gola: {
          ...curatedCapabilities().grips.gola!,
          standardProfiles: { L: 'profile.gola-l.scilm' },
        },
      },
    };
    render(
      <OpeningSettingsSection
        capabilities={withStandard}
        decided
        onChange={onChange}
        onSave={vi.fn()}
        profiles={catalogProfiles}
      />,
    );

    await user.click(screen.getByTestId('opening-standard-clear-L'));
    const payload = onChange.mock.calls[0]?.[0] as OpeningCapabilities;
    expect(payload.grips.gola?.standardProfiles).toBeUndefined();
  });

  it('#1329 fail-closed: el estándar que apunta a un perfil desactivado se lee como sin estándar', () => {
    const deadStandard: OpeningCapabilities = {
      ...curatedCapabilities(),
      grips: {
        ...curatedCapabilities().grips,
        gola: {
          ...curatedCapabilities().grips.gola!,
          standardProfiles: { L: 'profile.gola-l.scilm' },
        },
      },
    };
    render(
      <OpeningSettingsSection
        capabilities={deadStandard}
        decided
        onChange={vi.fn()}
        onSave={vi.fn()}
        profiles={catalogProfiles.map((p) =>
          p.id === 'profile.gola-l.scilm' ? { ...p, active: false } : p,
        )}
      />,
    );
    expect(screen.getByTestId('opening-standard-dead-L').textContent).toContain(
      'se lee como SIN estándar',
    );
    // El perfil desactivado no ofrece radio — no se puede estandarizar lo retirado.
    expect(screen.queryByTestId('opening-standard-L-profile.gola-l.scilm')).toBeNull();
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
