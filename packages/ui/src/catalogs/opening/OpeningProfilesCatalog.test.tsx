/**
 * #1526 — the opening profile editor: hardware picked by name or code (no
 * UUID typing), members keyed by the roles the engine reads, spacing and
 * envelope editable, and grip types that are not profiles kept out of new
 * profiles.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpeningProfilesCatalog, type OpeningProfileRow } from './OpeningProfilesCatalog';
import type { OpeningProfileDraft } from './openingProfileDraft';

afterEach(() => cleanup());

const hardwareOptions = [
  { id: 'hw-8006', code: '328.160', name: 'Perfil GOLA L 8006', active: true },
  { id: 'hw-su116', code: 'SU116', name: 'Soporte GOLA atornillar', active: true },
  { id: 'hw-caps', code: 'CF8006TP', name: 'Juego tapas terminales', active: true },
];

const componentOptions = [
  { id: 'comp-tira', code: 'TIRA-IT', name: 'Tira gola italiana', active: true },
];

function legacyHandleRow(): OpeningProfileRow {
  return {
    id: 'profile.handle-old',
    code: 'JAL-OLD',
    name: 'Jaladera antigua',
    manufacturer: null,
    gripType: 'handle',
    crossSection: null,
    placements: ['top'],
    datasheetStatus: 'pending',
    frontReductionMm: null,
    gripClearanceMm: null,
    doorReductionMm: null,
    profileHeightMm: null,
    profileDepthMm: null,
    geometryOrigin: null,
    bodyModifiers: [],
    bomMemberKeys: ['perfil'],
    bomMembers: { perfil: { hardware_id: 'hw-8006', rule: 'interior_width' } },
    active: true,
    version: 3,
  };
}

function renderCatalog(onCreate = vi.fn(), profiles: readonly OpeningProfileRow[] = []) {
  render(
    <OpeningProfilesCatalog
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

async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('opening-profile-create-btn'));
  await user.type(screen.getByTestId('opening-profile-id-input'), 'profile.gola-l-8006');
  await user.type(screen.getByTestId('opening-profile-code-input'), 'GOLA-L-8006');
  await user.type(screen.getByTestId('opening-profile-name-input'), 'Gola L 8006');
}

async function pickFromRow(user: ReturnType<typeof userEvent.setup>, row: HTMLElement, query: string, label: RegExp) {
  const picker = within(row).getByTestId('opening-profile-member-picker');
  await user.click(within(picker).getByRole('button'));
  await user.type(within(picker).getByLabelText('Nombre o código'), query);
  await user.click(within(picker).getByRole('option', { name: label }));
}

describe('OpeningProfilesCatalog — editor de elementos (#1526)', () => {
  it('elige el herraje buscando por nombre o por código, con rol fijo y regla por defecto', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await fillIdentity(user);

    // Perfil: buscado por NOMBRE.
    await user.click(screen.getByTestId('opening-profile-member-add'));
    let rows = screen.getAllByTestId('opening-profile-member-row');
    await user.selectOptions(within(rows[0]!).getByTestId('opening-profile-member-role'), 'profile');
    expect(within(rows[0]!).getByTestId('opening-profile-member-rule')).toHaveValue('interior_width');
    await pickFromRow(user, rows[0]!, 'perfil gola', /Perfil GOLA L 8006/);

    // Soportes: buscado por CÓDIGO; la regla por largo pide el espaciado.
    await user.click(screen.getByTestId('opening-profile-member-add'));
    rows = screen.getAllByTestId('opening-profile-member-row');
    await user.selectOptions(within(rows[1]!).getByTestId('opening-profile-member-role'), 'supports');
    expect(within(rows[1]!).getByTestId('opening-profile-member-rule')).toHaveValue('per_length');
    await pickFromRow(user, rows[1]!, 'SU116', /Soporte GOLA atornillar/);
    await user.type(within(rows[1]!).getByTestId('opening-profile-member-spacing'), '600');
    await user.type(within(rows[1]!).getByTestId('opening-profile-member-dim-0'), '39.5');
    await user.type(within(rows[1]!).getByTestId('opening-profile-member-dim-1'), '16.5');
    await user.type(within(rows[1]!).getByTestId('opening-profile-member-dim-2'), '20');

    // No UUID field is ever shown when the catalog is loaded.
    expect(screen.queryByTestId('opening-profile-member-ref')).toBeNull();

    await user.click(screen.getByTestId('opening-profile-form-submit-btn'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0]![1] as OpeningProfileDraft;
    expect(draft.members.map((m) => [m.key, m.hardwareId, m.rule])).toEqual([
      ['profile', 'hw-8006', 'interior_width'],
      ['supports', 'hw-su116', 'per_length'],
    ]);
    expect(draft.members[0]!.unit).toBe('meter');
    expect(draft.members[1]!.spacingMm).toBe('600');
    expect(draft.members[1]!.dims).toEqual(['39.5', '16.5', '20']);
  });

  it('no deja crear un herraje sin rol ni soportes sin espaciado', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await fillIdentity(user);

    await user.click(screen.getByTestId('opening-profile-member-add'));
    const row = screen.getAllByTestId('opening-profile-member-row')[0]!;
    await pickFromRow(user, row, 'tapas', /Juego tapas terminales/);
    await user.click(screen.getByTestId('opening-profile-form-submit-btn'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Perfil, Soportes o Tapas');

    await user.selectOptions(within(row).getByTestId('opening-profile-member-role'), 'supports');
    await user.click(screen.getByTestId('opening-profile-form-submit-btn'));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('cada cuántos mm');
  });

  it('un componente (tira italiana) se elige del catálogo de componentes con clave sugerida', async () => {
    const user = userEvent.setup();
    const onCreate = renderCatalog();
    await fillIdentity(user);

    await user.click(screen.getByTestId('opening-profile-member-add'));
    const row = screen.getAllByTestId('opening-profile-member-row')[0]!;
    await user.selectOptions(within(row).getByTestId('opening-profile-member-kind'), 'component');
    expect(within(row).getByTestId('opening-profile-member-key')).toHaveValue('tira');
    await pickFromRow(user, row, 'TIRA', /Tira gola italiana/);
    await user.click(screen.getByTestId('opening-profile-form-submit-btn'));

    const draft = onCreate.mock.calls[0]![1] as OpeningProfileDraft;
    expect(draft.members[0]).toMatchObject({ kind: 'component', key: 'tira', componentId: 'comp-tira' });
  });

  it('un perfil nuevo sólo puede ser gola', async () => {
    const user = userEvent.setup();
    renderCatalog();
    await user.click(screen.getByTestId('opening-profile-create-btn'));
    const options = within(screen.getByTestId('opening-profile-grip-select')).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['gola']);
  });

  it('un perfil existente de otro tipo se abre sin cambiar su tipo y conserva su clave anterior', async () => {
    const user = userEvent.setup();
    render(
      <OpeningProfilesCatalog
        profiles={[legacyHandleRow()]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        openEntityId="profile.handle-old"
        hardwareOptions={hardwareOptions}
        componentOptions={componentOptions}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Editar/ }));
    const grip = screen.getByTestId('opening-profile-grip-select');
    expect(grip).toBeDisabled();
    expect(grip).toHaveValue('handle');
    expect(screen.getByTestId('opening-profile-grip-legacy')).toHaveTextContent('Ajustes › Apertura');
    // The legacy key stays visible as what it is, with the explanation.
    const row = screen.getAllByTestId('opening-profile-member-row')[0]!;
    expect(within(row).getByTestId('opening-profile-member-role')).toHaveValue('perfil');
    expect(within(row).getByTestId('opening-profile-member-legacy')).toHaveTextContent('no es un rol que el motor lea');
  });
});
