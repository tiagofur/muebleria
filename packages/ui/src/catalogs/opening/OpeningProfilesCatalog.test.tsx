/**
 * #1534 — the gola profile editor v2: material chips (L/C aluminio,
 * italiana melamine), per-position discounts with the manufacturer
 * suggestion, piezas por rol with the #1526 pickers, and the honest
 * per-position usability served by the API.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpeningProfilesCatalog, type OpeningProfileRow } from './OpeningProfilesCatalog';

afterEach(() => cleanup());

const hardwareOptions = [
  { id: 'hw-8006', code: '328.160', name: 'Perfil GOLA L 8006', active: true },
  { id: 'hw-su116', code: 'SU116', name: 'Soporte GOLA atornillar', active: true },
  { id: 'hw-caps', code: 'CF8006TP', name: 'Juego tapas terminales', active: true },
];

const componentOptions = [
  { id: 'comp-tira', code: 'TIRA-IT', name: 'Tira gola italiana', active: true },
];

const apiStub = {
  // Honest like the engine: a declared position WITHOUT its discount
  // produces the «falta» line (disponible ≠ válido), never a number.
  previewOpeningProfile: vi.fn(
    async (
      _token: string,
      body: {
        positions: readonly string[];
        frontDiscountTopMm?: number | null;
        frontDiscountBetweenMm?: number | null;
      },
    ) => {
      const previews: { key: string; preview: string }[] = [];
      if (body.positions.includes('top')) {
        previews.push(
          body.frontDiscountTopMm != null && body.frontDiscountTopMm > 0
            ? { key: 'una_puerta', preview: `Mueble de 720: una puerta = ${720 - body.frontDiscountTopMm}` }
            : { key: 'falta', preview: 'una puerta: falta el descuento superior' },
        );
      }
      if (body.positions.includes('between')) {
        previews.push(
          body.frontDiscountBetweenMm != null && body.frontDiscountBetweenMm > 0
            ? { key: 'dos_frentes', preview: `dos frentes con esta C = ${(720 - (body.frontDiscountTopMm ?? 0) - body.frontDiscountBetweenMm) / 2}` }
            : { key: 'falta', preview: 'dos frentes: falta el descuento entre frentes' },
        );
      }
      return { previews };
    },
  ),
};

function renderCatalog(onCreate = vi.fn(), profiles: readonly OpeningProfileRow[] = []) {
  render(
    <OpeningProfilesCatalog
      api={apiStub as unknown as import('@granete/storage').GraneteApiClient}
      token="tok"
      profiles={profiles}
      onCreate={onCreate}
      onUpdate={vi.fn()}
      onDeactivate={vi.fn()}
      hardwareOptions={hardwareOptions}
      componentOptions={componentOptions}
    />,
  );
  return onCreate;
}

async function openCreate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('opening-profile-create-btn'));
  await user.type(screen.getByTestId('gola-profile-code'), 'GOLA-L-8006');
  await user.type(screen.getByTestId('gola-profile-name'), 'Gola L 8006');
  // The v2 use rule requires the datasheet envelope (height/depth).
  await user.type(screen.getByTestId('gola-profile-height'), '56.5');
  await user.type(screen.getByTestId('gola-profile-depth'), '27.2');
}

async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  query: string,
  label: RegExp,
) {
  // The open listbox renders in a portal OUTSIDE the picker root — query at
  // document level; only one picker is open at a time.
  const root = screen.getByTestId(testId);
  fireEvent.click(within(root).getByRole('button'));
  // Every picker renders its search input; scope by the OPEN picker's root
  // (the trigger's aria-controls points at the listbox inside it).
  const search = await within(root).findByLabelText('Buscar…');
  await user.type(search, query);
  const option = await screen.findByRole('option', { name: label });
  // The picker selects on MOUSEDOWN, not click.
  fireEvent.mouseDown(option);
}

describe('OpeningProfilesCatalog — editor v2 de perfiles de gola (#1534)', () => {
  it('crea un perfil L con descuento 40 vía la sugerencia y guarda piezas por rol', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);

    await user.click(screen.getByTestId('gola-material-l'));
    await expect(screen.getByTestId('gola-position-top')).toBeChecked();

    await user.click(screen.getByTestId('gola-discount-suggest-top'));
    expect((screen.getByTestId('gola-discount-top') as HTMLInputElement).value).toBe('40');

    await pickOption(user, 'gola-part-profile', 'perfil gola', /Perfil GOLA L 8006/);
    await pickOption(user, 'gola-part-supports', 'SU116', /Soporte GOLA atornillar/);
    await user.type(screen.getByTestId('gola-part-supports-spacing'), '600');
    await pickOption(user, 'gola-part-endcaps', 'tapas', /Juego tapas terminales/);

    await user.click(screen.getByTestId('gola-profile-save'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const formError = screen.queryByTestId('gola-profile-error');
    expect(
      onCreate,
      `form error: ${formError?.textContent ?? 'ninguno'}`,
    ).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![1] as import('./openingProfileDraft').OpeningProfileDraft;
    expect(draft.material).toBe('aluminum');
    expect(draft.crossSection).toBe('L');
    expect(draft.frontDiscountTopMm).toBe('40');
    expect(draft.members.map((m) => [m.key, m.hardwareId])).toEqual([
      ['profile', 'hw-8006'],
      ['supports', 'hw-su116'],
      ['endCaps', 'hw-caps'],
    ]);
    expect(draft.members[1]!.spacingMm).toBe('600');
  });

  it('la italiana pre-carga 36/36, efectos de fábrica y la tira de componentes', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);

    await user.click(screen.getByTestId('gola-material-italiana'));
    expect(screen.getByTestId('gola-position-top')).toBeChecked();
    expect(screen.getByTestId('gola-position-between')).toBeChecked();
    expect((screen.getByTestId('gola-discount-top') as HTMLInputElement).value).toBe('36');
    expect((screen.getByTestId('gola-discount-between') as HTMLInputElement).value).toBe('36');
    expect((screen.getByTestId('gola-effect-depth') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('gola-effect-notch') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('gola-effect-bevel') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('gola-part-strip')).toBeDefined();

    await pickOption(user, 'gola-part-strip', 'TIRA', /Tira gola italiana/);
    expect((screen.getByTestId('gola-part-strip-height') as HTMLInputElement).value).toBe('70');

    await user.click(screen.getByTestId('gola-profile-save'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const draft = onCreate.mock.calls[0]![1] as import('./openingProfileDraft').OpeningProfileDraft;
    expect(draft.material).toBe('melamine');
    expect(draft.notchDepthSource).toBe('strip_thickness');
    expect(draft.notchClearanceMm).toBe('1');
    expect(draft.members.find((m) => m.key === 'strip')).toMatchObject({ kind: 'component', componentId: 'comp-tira', heightMm: '70' });
  });

  it('la vista previa es la sentencia del SERVIDOR, nunca un cálculo de React', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-l'));
    // Without a discount the preview is the honest «falta» line.
    await waitFor(() =>
      expect(screen.getByTestId('gola-profile-preview-falta').textContent).toContain('falta el descuento superior'),
    );
    // The manufacturer suggestion fills 40 → the server resolves 680.
    await user.click(screen.getByTestId('gola-discount-suggest-top'));
    await waitFor(() =>
      expect(screen.getByTestId('gola-profile-preview-una_puerta').textContent).toBe('Mueble de 720: una puerta = 680'),
    );
  });

  it('posición declarada sin descuento: la línea honesta «falta», no un número inventado', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-italiana'));
    await user.clear(screen.getByTestId('gola-discount-between'));
    await user.click(screen.getByTestId('gola-profile-preview-refresh'));
    await waitFor(() =>
      expect(screen.getByTestId('gola-profile-preview-falta').textContent).toContain('falta el descuento'),
    );
  });
});
