/**
 * #1534 — the gola profile editor v2: material chips (L/C aluminio,
 * italiana melamine), per-position discounts with the SERVER suggestion
 * (GET /catalog/opening-profiles/suggestions — React never hardcodes the
 * manufacturer numbers), piezas por rol with the #1526 pickers, the honest
 * per-position usability served by the API, and the r1 validation rules
 * (issue acceptance: unit tests of the field validation by material and
 * position, of the server-calling preview and of the round-trip).
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  datasheetPendingReasons,
  emptyOpeningProfileDraft,
  membersMapOfDraft,
  toOpeningProfileDraft,
  type OpeningProfileDraft,
} from './openingProfileDraft';
import { OpeningProfilesCatalog, openingProfileWriteBody, type OpeningProfileRow } from './OpeningProfilesCatalog';

afterEach(() => cleanup());

const hardwareOptions = [
  { id: 'hw-8006', code: '328.160', name: 'Perfil GOLA L 8006', active: true },
  { id: 'hw-su116', code: 'SU116', name: 'Soporte GOLA atornillar', active: true },
  { id: 'hw-caps', code: 'CF8006TP', name: 'Juego tapas terminales', active: true },
];

const componentOptions = [
  { id: 'comp-tira', code: 'TIRA-IT', name: 'Tira gola italiana', active: true },
];

// The server's suggestions (#1530): the ONLY source of the manufacturer
// numbers. With a declared depth the italiana carries bevel = depth − 2.
const SUGGESTIONS = [
  {
    key: 'scilm-8006-l',
    label: 'Gola L 8006 (arriba)',
    source: 'Ficha SCILM 8006: H − 40',
    manufacturer: 'SCILM',
    material: 'aluminum',
    cross_section_shape: 'L',
    positions: ['top'],
    front_discount_top_mm: 40,
    front_discount_between_mm: null,
    body_modifiers: [{ role: 'horizontal', effect: 'depth_reduction' }],
    bom_members: {},
  },
  {
    key: 'scilm-8007-c',
    label: 'Gola C 8007 (entre frentes)',
    source: 'Ficha SCILM 8007: hueco de 36',
    manufacturer: 'SCILM',
    material: 'aluminum',
    cross_section_shape: 'C',
    positions: ['between'],
    front_discount_top_mm: null,
    front_discount_between_mm: 36,
    body_modifiers: [],
    bom_members: {},
  },
  {
    key: 'italiana',
    label: 'Gola italiana (arriba y entre frentes)',
    source: 'Valores del taller (#1524)',
    material: 'melamine',
    cross_section_shape: 'flat',
    positions: ['top', 'between'],
    front_discount_top_mm: 36,
    front_discount_between_mm: 36,
    body_modifiers: [
      { role: 'horizontal', effect: 'depth_reduction' },
      { role: 'lateral', notch_height_mm: 70, notch_depth_source: 'strip_thickness', notch_clearance_mm: 1, notch_at: 'top_front' },
      { role: 'door', bevel_angle_deg: 45, bevel_size_mm: null, bevel_at: 'top_front' },
    ],
    bom_members: { strip: { hardware_id: '', rule: 'interior_width', height_mm: 70 } },
  },
];

// Honest like the engine: a declared position WITHOUT its discount produces
// the «falta» line (disponible ≠ válido), never a number.
function previewStub() {
  return vi.fn(
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
            ? { key: 'dos_frentes', preview: `dos frentes = ${(720 - (body.frontDiscountTopMm ?? 0) - body.frontDiscountBetweenMm) / 2} y ${(720 - (body.frontDiscountTopMm ?? 0) - body.frontDiscountBetweenMm) / 2} mm` }
            : { key: 'falta', preview: 'dos frentes: falta el descuento entre frentes' },
        );
      }
      return { previews };
    },
  );
}

function apiStubWith(depthSuggestion: number | null) {
  const preview = previewStub();
  const request = vi.fn(async (_method: string, path: string) => {
    if (!path.includes('/catalog/opening-profiles/suggestions')) {
      throw new Error(`unexpected request: ${path}`);
    }
    if (path.includes('profile_depth_mm=') && depthSuggestion != null) {
      return SUGGESTIONS.map((s) =>
        s.key === 'italiana'
          ? {
              ...s,
              body_modifiers: s.body_modifiers.map((m) =>
                m.role === 'door' ? { ...m, bevel_size_mm: depthSuggestion } : m,
              ),
            }
          : s,
      );
    }
    return SUGGESTIONS;
  });
  return { previewOpeningProfile: preview, request };
}

function renderCatalog(
  onCreate = vi.fn(),
  profiles: readonly OpeningProfileRow[] = [],
  api: unknown = apiStubWith(null),
) {
  render(
    <OpeningProfilesCatalog
      api={api as unknown as import('@granete/storage').GraneteApiClient}
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
  const search = await within(root).findByLabelText('Buscar…');
  await user.type(search, query);
  const option = await screen.findByRole('option', { name: label });
  // The picker selects on MOUSEDOWN, not click.
  fireEvent.mouseDown(option);
}

describe('OpeningProfilesCatalog — editor v2 de perfiles de gola (#1534)', () => {
  it('crea un perfil L con descuento 40 vía la SUGERENCIA DEL SERVIDOR y guarda piezas por rol', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);

    await user.click(screen.getByTestId('gola-material-l'));
    await expect(screen.getByTestId('gola-position-top')).toBeChecked();
    // The suggestion button reads the SERVER value (SCILM 40) — never a
    // React constant.
    expect(screen.getByTestId('gola-discount-suggest-top').textContent).toContain('sugerencia: 40');
    await user.click(screen.getByTestId('gola-discount-suggest-top'));
    expect((screen.getByTestId('gola-discount-top') as HTMLInputElement).value).toBe('40');
    // The manufacturer arrives with the server suggestion (fill-only-empty).
    await waitFor(() =>
      expect((screen.getByTestId('gola-profile-manufacturer') as HTMLInputElement).value).toBe('SCILM'),
    );

    await pickOption(user, 'gola-part-profile', 'perfil gola', /Perfil GOLA L 8006/);
    await pickOption(user, 'gola-part-supports', 'SU116', /Soporte GOLA atornillar/);
    await user.type(screen.getByTestId('gola-part-supports-spacing'), '600');
    await pickOption(user, 'gola-part-endcaps', 'tapas', /Juego tapas terminales/);

    await user.click(screen.getByTestId('gola-profile-save'));
    await waitFor(() => {
      const err = screen.queryByTestId('gola-profile-error');
      expect(onCreate, `form error: ${err?.textContent ?? 'ninguno'}`).toHaveBeenCalledTimes(1);
    });
    const draft = onCreate.mock.calls[0]![1] as OpeningProfileDraft;
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

  it('la italiana pre-carga 36/36 del servidor, efectos de fábrica y la tira; el bisel llega derivado (profundidad − 2) con la profundidad declarada', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog(vi.fn(), [], apiStubWith(25.2));
    await openCreate(user);

    await user.click(screen.getByTestId('gola-material-italiana'));
    expect(screen.getByTestId('gola-position-top')).toBeChecked();
    expect(screen.getByTestId('gola-position-between')).toBeChecked();
    expect((screen.getByTestId('gola-discount-top') as HTMLInputElement).value).toBe('36');
    expect((screen.getByTestId('gola-discount-between') as HTMLInputElement).value).toBe('36');
    expect((screen.getByTestId('gola-effect-depth') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('gola-effect-notch') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('gola-effect-bevel') as HTMLInputElement).checked).toBe(true);
    // The bevel is the SERVER derivation (depth − 2 = 25.2, asked with
    // profile_depth_mm) — never a React constant.
    await waitFor(() =>
      expect((screen.getByTestId('gola-bevel-size') as HTMLInputElement).value).toBe('25.2'),
    );

    await pickOption(user, 'gola-part-strip', 'TIRA', /Tira gola italiana/);
    expect((screen.getByTestId('gola-part-strip-height') as HTMLInputElement).value).toBe('70');

    await user.click(screen.getByTestId('gola-profile-save'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const draft = onCreate.mock.calls[0]![1] as OpeningProfileDraft;
    expect(draft.material).toBe('melamine');
    expect(draft.notchDepthSource).toBe('strip_thickness');
    expect(draft.notchClearanceMm).toBe('1');
    expect(draft.bevelSizeMm).toBe('25.2');
    expect(draft.members.find((m) => m.key === 'strip')).toMatchObject({ kind: 'component', componentId: 'comp-tira', heightMm: '70' });
  });

  it('la vista previa es la sentencia del SERVIDOR, nunca un cálculo de React', async () => {
    const user = userEvent.setup();
    renderCatalog(vi.fn(), [], apiStubWith(null));
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-l'));
    // The server suggestion arrives with the chip: 40 → the server resolves
    // 680 (React never computed it).
    await waitFor(() =>
      expect(screen.getByTestId('gola-profile-preview-una_puerta-0').textContent).toBe('Mueble de 720: una puerta = 680'),
    );
    // Clearing the discount re-asks the server: the honest «falta» line.
    await user.clear(screen.getByTestId('gola-discount-top'));
    await waitFor(() =>
      expect(screen.getByTestId('gola-profile-preview-falta-0').textContent).toContain('falta el descuento superior'),
    );
  });

  it('posición declarada sin descuento: la línea honesta «falta», no un número inventado', async () => {
    const user = userEvent.setup();
    renderCatalog(vi.fn(), [], apiStubWith(null));
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-italiana'));
    await user.clear(screen.getByTestId('gola-discount-between'));
    await user.click(screen.getByTestId('gola-profile-preview-refresh'));
    await waitFor(() =>
      expect(screen.getByTestId('gola-profile-preview-falta-1').textContent).toContain('falta el descuento'),
    );
  });
});

describe('OpeningProfilesCatalog — validación por material y posición (#1534 aceptación 1)', () => {
  it('sin material el guardado se frena con el mensaje del editor (nunca una escritura legacy silenciosa)', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);
    await user.type(screen.getByTestId('gola-profile-height'), '56.5');
    await user.type(screen.getByTestId('gola-profile-depth'), '27.2');
    await user.click(screen.getByTestId('gola-profile-save'));
    const formError = await screen.findByTestId('gola-profile-error');
    expect(formError.textContent).toContain('Elegí el material del perfil');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('sin posiciones el guardado se frena con el mensaje honesto', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-l'));
    await user.click(screen.getByTestId('gola-position-top')); // the L preset turned it on: off again
    await user.click(screen.getByTestId('gola-profile-save'));
    const formError = await screen.findByTestId('gola-profile-error');
    expect(formError.textContent).toContain('Marcá al menos una posición');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('un descuento decimal se frena en el cliente con el mensaje en español (nunca el error inglés del cliente generado)', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-l'));
    await user.type(screen.getByTestId('gola-profile-height'), '56.5');
    await user.type(screen.getByTestId('gola-profile-depth'), '27.2');
    await user.clear(screen.getByTestId('gola-discount-top'));
    await user.type(screen.getByTestId('gola-discount-top'), '36.5');
    await user.click(screen.getByTestId('gola-profile-save'));
    const formError = await screen.findByTestId('gola-profile-error');
    expect(formError.textContent).toContain('El descuento superior debe ser un número entero mayor a 0');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('soportes sin espaciado se frenan en el cliente (el BOM fallaba después, dentro del diseño)', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-l'));
    await user.type(screen.getByTestId('gola-profile-height'), '56.5');
    await user.type(screen.getByTestId('gola-profile-depth'), '27.2');
    await pickOption(user, 'gola-part-supports', 'SU116', /Soporte GOLA atornillar/);
    await user.click(screen.getByTestId('gola-profile-save'));
    const formError = await screen.findByTestId('gola-profile-error');
    expect(formError.textContent).toContain('Indica cada cuántos mm van los soportes');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('italiana sin profundidad declarada: el bisel vacío se frena con el mensaje que enseña el arreglo', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog(vi.fn(), [], apiStubWith(null));
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-italiana'));
    // The depth stub never derives (bevel null) — dims OK, bisel empty.
    await user.type(screen.getByTestId('gola-profile-height'), '56.5');
    await user.type(screen.getByTestId('gola-profile-depth'), '27.2');
    await user.click(screen.getByTestId('gola-profile-save'));
    const formError = await screen.findByTestId('gola-profile-error');
    expect(formError.textContent).toContain('El bisel exige un tamaño mayor a 0');
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('OpeningProfilesCatalog — piezas y limpieza por material (#1534 r1)', () => {
  it('«Quitar selección» deja la pieza fuera del write (nunca una referencia vacía que 422)', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-l'));
    await user.click(screen.getByTestId('gola-discount-suggest-top'));
    await pickOption(user, 'gola-part-endcaps', 'tapas', /Juego tapas terminales/);
    // Clear the end caps: «Quitar selección» inside the picker.
    const root = screen.getByTestId('gola-part-endcaps');
    fireEvent.click(within(root).getByRole('button'));
    const clear = await within(root).findByText('Quitar selección');
    fireEvent.click(clear);
    await user.click(screen.getByTestId('gola-profile-save'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const draft = onCreate.mock.calls[0]![1] as OpeningProfileDraft;
    expect(draft.members.find((m) => m.key === 'endCaps')?.hardwareId ?? '').toBe('');
    // And the PERSISTED map carries no empty reference at all.
    expect(membersMapOfDraft(draft.members).endCaps).toBeUndefined();
  });

  it('cambiar italiana → aluminio quita la tira y el estado que la sigue (nada insalvable queda)', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog(vi.fn(), [], apiStubWith(null));
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-italiana'));
    expect(screen.getByTestId('gola-part-strip')).toBeDefined();
    await user.click(screen.getByTestId('gola-material-c'));
    expect(screen.queryByTestId('gola-part-strip')).toBeNull();
    // The strip-following notch source reset to the explicit depth variant.
    expect((screen.getByTestId('gola-effect-notch') as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByTestId('gola-profile-save'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const draft = onCreate.mock.calls[0]![1] as OpeningProfileDraft;
    expect(draft.material).toBe('aluminum');
    expect(draft.crossSection).toBe('C');
    expect(draft.members.find((m) => m.key === 'strip')).toBeUndefined();
  });

  it('un miembro con rol desconocido (mig 000180) se muestra con su baja revelada y no viaja en la escritura', () => {
    const row: OpeningProfileRow = {
      id: 'profile.legacy',
      code: 'LEGACY-1',
      name: 'Legacy',
      version: 1,
      gripType: 'gola',
      crossSection: null,
      placements: ['top'],
      datasheetStatus: 'pending',
      doorReductionMm: null,
      frontDiscountTopMm: 40,
      frontDiscountBetweenMm: null,
      material: 'aluminum',
      profileHeightMm: 56.5,
      profileDepthMm: 27.2,
      geometryOrigin: null,
      bodyModifiers: [],
      bomMembers: { profile: { hardware_id: 'hw-8006', rule: 'interior_width' }, legadoFoo: { hardware_id: 'hw-x', rule: '?' } },
      active: true,
      manufacturer: null,
    } as unknown as OpeningProfileRow;
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <OpeningProfilesCatalog
        api={apiStubWith(null) as unknown as import('@granete/storage').GraneteApiClient}
        token="tok"
        profiles={[row]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        hardwareOptions={hardwareOptions}
        componentOptions={componentOptions}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar LEGACY-1' }));
    const disclosure = screen.getByTestId('gola-unknown-member-legadoFoo');
    expect(disclosure.textContent).toContain('rol «legadoFoo»');
    expect(disclosure.textContent).toContain('Al guardar se quita');
    fireEvent.click(within(screen.getByTestId('gola-profile-editor')).getByTestId('gola-profile-save'));
    return vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const draft = onUpdate.mock.calls[0]![2] as OpeningProfileDraft;
      expect(membersMapOfDraft(draft.members).legadoFoo).toBeUndefined();
      expect(membersMapOfDraft(draft.members).profile).toBeDefined();
    });
  });
});

describe('OpeningProfilesCatalog — Uso honesto y round-trip (#1534 aceptación 1 y 3)', () => {
  const rowWithUsage: OpeningProfileRow = {
    id: 'profile.betweenless',
    code: 'BETW-1',
    name: 'Gola sin descuento entre frentes',
    version: 1,
    gripType: 'gola',
    crossSection: 'C',
    placements: ['top', 'between'],
    datasheetStatus: 'pending',
    doorReductionMm: 40,
    frontDiscountTopMm: 40,
    frontDiscountBetweenMm: null,
    material: 'aluminum',
    profileHeightMm: 56.5,
    profileDepthMm: 27.2,
    geometryOrigin: null,
    bodyModifiers: [],
    bomMembers: {},
    active: true,
    manufacturer: null,
    usage: {
      top: { usable: true, missing: [] },
      between: { usable: false, missing: ['front_discount_between_mm'], message: 'No se puede usar entre frentes: falta el descuento' },
    },
  } as unknown as OpeningProfileRow;

  it('la LISTA muestra el motivo exacto por posición servido por la API', () => {
    renderCatalog(vi.fn(), [rowWithUsage]);
    expect(screen.getByText('No se puede usar entre frentes: falta el descuento')).toBeInTheDocument();
  });

  it('el EDITOR muestra el estado guardado junto a los descuentos', () => {
    render(
      <OpeningProfilesCatalog
        api={apiStubWith(null) as unknown as import('@granete/storage').GraneteApiClient}
        token="tok"
        profiles={[rowWithUsage]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        hardwareOptions={hardwareOptions}
        componentOptions={componentOptions}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Editar BETW-1' }));
    const saved = screen.getByTestId('gola-profile-saved-usage');
    expect(saved.textContent).toContain('superior: OK');
    expect(saved.textContent).toContain('No se puede usar entre frentes: falta el descuento');
  });

  it('round-trip: draft → write body → row → draft conserva material, posiciones, descuentos y ficha derivada', () => {
    const base = emptyOpeningProfileDraft();
    const draft: OpeningProfileDraft = {
      ...base,
      material: 'melamine',
      crossSection: 'flat',
      top: true,
      between: true,
      frontDiscountTopMm: '36',
      frontDiscountBetweenMm: '36',
      profileHeightMm: '56.5',
      profileDepthMm: '27.2',
      geometryOrigin: 'Ficha SCILM 2022-04-01',
      notchEnabled: true,
      notchHeightMm: '70',
      notchDepthSource: 'strip_thickness',
      notchClearanceMm: '1',
      bevelEnabled: true,
      bevelSizeMm: '25.2',
      members: [{ key: 'strip', kind: 'component', hardwareId: '', componentId: 'comp-tira', rule: 'interior_width', unit: 'piece', spacingMm: '', dims: ['', '', ''] as [string, string, string], heightMm: '70' }],
    };
    const body = openingProfileWriteBody(draft);
    // The complete envelope WITH origin derives the verified datasheet —
    // the design opening authoring gate accepts it.
    expect(body.datasheet_status).toBe('verified');
    expect(body.material).toBe('melamine');
    expect(body.front_discount_top_mm).toBe(36);
    expect(body.front_discount_between_mm).toBe(36);
    expect(body.door_reduction_mm).toBe(36);
    const row = {
      id: draft.id,
      code: draft.code,
      name: draft.name,
      manufacturer: draft.manufacturer,
      gripType: body.grip_type,
      crossSection: body.cross_section_shape ?? null,
      placements: body.compatible_placements ?? [],
      datasheetStatus: body.datasheet_status,
      frontReductionMm: null,
      gripClearanceMm: null,
      doorReductionMm: body.door_reduction_mm ?? null,
      material: body.material ?? null,
      frontDiscountTopMm: body.front_discount_top_mm ?? null,
      frontDiscountBetweenMm: body.front_discount_between_mm ?? null,
      profileHeightMm: body.profile_height_mm ?? null,
      profileDepthMm: body.profile_depth_mm ?? null,
      geometryOrigin: body.geometry_origin ?? null,
      bodyModifiers: body.body_modifiers ?? [],
      bomMembers: membersMapOfDraft(draft.members),
    } as unknown as Parameters<typeof toOpeningProfileDraft>[0];
    const back = toOpeningProfileDraft(row);
    expect(back.material).toBe('melamine');
    expect(back.top).toBe(true);
    expect(back.between).toBe(true);
    expect(back.frontDiscountTopMm).toBe('36');
    expect(back.frontDiscountBetweenMm).toBe('36');
    expect(back.profileHeightMm).toBe('56.5');
    expect(back.profileDepthMm).toBe('27.2');
    expect(back.geometryOrigin).toBe('Ficha SCILM 2022-04-01');
    expect(back.notchDepthSource).toBe('strip_thickness');
    expect(back.bevelSizeMm).toBe('25.2');
    expect(back.members.find((m) => m.key === 'strip')).toMatchObject({ componentId: 'comp-tira', heightMm: '70' });
  });

  it('la ficha derivada: sin origen queda pendiente y la línea del editor nombra lo que falta; nunca democita una fila verificada', () => {
    const base = emptyOpeningProfileDraft();
    const withoutOrigin: OpeningProfileDraft = {
      ...base,
      material: 'aluminum',
      top: true,
      frontDiscountTopMm: '40',
      profileHeightMm: '56.5',
      profileDepthMm: '27.2',
    };
    const body = openingProfileWriteBody(withoutOrigin);
    expect(body.datasheet_status).toBe('pending');
    // A verified row opened for edit keeps verified even though the editor
    // hides the legacy pair fields (no silent demotion).
    const verifiedRow: OpeningProfileDraft = {
      ...withoutOrigin,
      datasheetStatus: 'verified',
      frontReductionMm: '30',
      gripClearanceMm: '4',
    };
    expect(openingProfileWriteBody(verifiedRow).datasheet_status).toBe('verified');
  });
});

describe('OpeningProfilesCatalog — ronda 2: defectos de la corrección (re-juicio)', () => {
  it('re-marcar «Bisel 45°» tras desmarcarlo vuelve a activarlo (con tamaño previo, sin esperar al servidor)', async () => {
    const user = userEvent.setup();
    renderCatalog(vi.fn(), [], apiStubWith(25.2));
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-italiana'));
    await waitFor(() =>
      expect((screen.getByTestId('gola-bevel-size') as HTMLInputElement).value).toBe('25.2'),
    );
    await user.click(screen.getByTestId('gola-effect-bevel'));
    expect((screen.getByTestId('gola-effect-bevel') as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByTestId('gola-effect-bevel'));
    expect((screen.getByTestId('gola-effect-bevel') as HTMLInputElement).checked).toBe(true);
    // The size the draft already held is kept — the server never rewrites it.
    expect((screen.getByTestId('gola-bevel-size') as HTMLInputElement).value).toBe('25.2');
  });

  it('una sesión nueva no hereda el marcador de bisel derivado: el bisel tecleado de una ficha guardada nunca se reescribe', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const savedItalian = {
      id: 'profile.it-manual',
      code: 'IT-MANUAL',
      name: 'Italiana con bisel tecleado',
      version: 1,
      gripType: 'gola',
      crossSection: 'flat',
      placements: ['top', 'between'],
      datasheetStatus: 'verified',
      doorReductionMm: 36,
      frontDiscountTopMm: 36,
      frontDiscountBetweenMm: 36,
      material: 'melamine',
      profileHeightMm: 56.5,
      profileDepthMm: 27.2,
      geometryOrigin: 'Ficha del taller',
      bodyModifiers: [{ role: 'door', bevel_angle_deg: 45, bevel_size_mm: 20, bevel_at: 'top_front' }],
      bomMembers: { strip: { hardware_id: '', component_id: 'comp-tira', rule: 'interior_width', height_mm: 70 } },
      active: true,
      manufacturer: null,
    } as unknown as OpeningProfileRow;
    render(
      <OpeningProfilesCatalog
        api={apiStubWith(28) as unknown as import('@granete/storage').GraneteApiClient}
        token="tok"
        profiles={[savedItalian]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onDeactivate={vi.fn()}
        hardwareOptions={hardwareOptions}
        componentOptions={componentOptions}
      />,
    );
    // Session 1 (create): the italiana chip arms the derived marker; cancel.
    await user.click(screen.getByTestId('opening-profile-create-btn'));
    await user.click(screen.getByTestId('gola-material-italiana'));
    await user.click(screen.getByTestId('gola-profile-cancel'));
    await vi.waitFor(() => expect(screen.queryByTestId('gola-profile-editor')).toBeNull());
    // Session 2 (edit the saved profile with the TYPED bevel 20): editing the
    // depth must NOT overwrite it with the server's 28.
    fireEvent.click(screen.getByRole('button', { name: 'Editar IT-MANUAL' }));
    await waitFor(() => expect(screen.getByTestId('gola-profile-editor')).toBeInTheDocument());
    expect((screen.getByTestId('gola-bevel-size') as HTMLInputElement).value).toBe('20');
    await user.clear(screen.getByTestId('gola-profile-depth'));
    await user.type(screen.getByTestId('gola-profile-depth'), '30');
    // Debounce (350ms) + server roundtrip would land 28 if the marker leaked.
    await new Promise((r) => setTimeout(r, 600));
    expect((screen.getByTestId('gola-bevel-size') as HTMLInputElement).value).toBe('20');
    await user.click(within(screen.getByTestId('gola-profile-editor')).getByTestId('gola-profile-save'));
    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const draft = onUpdate.mock.calls[0]![2] as OpeningProfileDraft;
      expect(draft.bevelSizeMm).toBe('20');
    });
  });

  it('un descuento inválido en una posición OCULTA no bloquea el guardado (la escritura la omite)', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await openCreate(user);
    await user.click(screen.getByTestId('gola-material-c'));
    // The C preset filled the between discount; corrupt it, then hide the
    // position: the write omits it and the save must pass.
    await user.clear(screen.getByTestId('gola-discount-between'));
    await user.type(screen.getByTestId('gola-discount-between'), '36.5');
    await user.click(screen.getByTestId('gola-position-between'));
    await user.click(screen.getByTestId('gola-position-top'));
    await user.clear(screen.getByTestId('gola-discount-top'));
    await user.type(screen.getByTestId('gola-discount-top'), '40');
    await user.click(screen.getByTestId('gola-profile-save'));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('gola-profile-error')).toBeNull();
  });

  it('la ficha derivada sólo cuenta posiciones DECLARADAS: sólo-entre-frentes queda pendiente con el motivo cierto y sin door_reduction fantasma', () => {
    const base = emptyOpeningProfileDraft();
    const betweenOnly: OpeningProfileDraft = {
      ...base,
      material: 'aluminum',
      crossSection: 'C',
      top: false,
      between: true,
      // Stale value left by a previous preset in the hidden top field.
      frontDiscountTopMm: '36',
      frontDiscountBetweenMm: '36',
      profileHeightMm: '56.5',
      profileDepthMm: '27.2',
      geometryOrigin: 'Ficha SCILM',
    };
    const body = openingProfileWriteBody(betweenOnly);
    expect(body.datasheet_status).toBe('pending');
    expect(body.front_discount_top_mm).toBeUndefined();
    expect(body.door_reduction_mm).toBeUndefined();
    expect(body.front_discount_between_mm).toBe(36);
    // The honest reason names the facade requirement, not a fictitious top
    // discount the profile cannot declare.
    const reasons = datasheetPendingReasons(betweenOnly);
    expect(reasons.join(' ')).toContain('la autoría por la fachada exige un perfil con posición superior');
    expect(reasons.join(' ')).not.toContain('el descuento superior');
  });

  it('una ficha verificada que pierde su descuento superior VISIBLE (sin par legacy) baja a pendiente — el guardado en progreso sigue siendo válido', () => {
    const base = emptyOpeningProfileDraft();
    const verifiedTop: OpeningProfileDraft = {
      ...base,
      material: 'aluminum',
      top: true,
      frontDiscountTopMm: '40',
      profileHeightMm: '56.5',
      profileDepthMm: '27.2',
      geometryOrigin: 'Ficha SCILM',
    };
    const withVerifiedRow: OpeningProfileDraft = { ...verifiedTop, datasheetStatus: 'verified' };
    expect(openingProfileWriteBody(withVerifiedRow).datasheet_status).toBe('verified');
    // Clearing the visible discount with no hidden legacy pair: pending.
    const cleared: OpeningProfileDraft = { ...withVerifiedRow, frontDiscountTopMm: '' };
    expect(openingProfileWriteBody(cleared).datasheet_status).toBe('pending');
    // The legacy pair (hidden fields) keeps the row verified.
    const withPair: OpeningProfileDraft = { ...cleared, frontReductionMm: '30', gripClearanceMm: '4' };
    expect(openingProfileWriteBody(withPair).datasheet_status).toBe('verified');
  });
});
