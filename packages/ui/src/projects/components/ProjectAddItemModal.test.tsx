/**
 * Regresión focalizada — selección efectiva del modal Agregar mueble vs filtro
 * de categoría. El valor visible del selector, los controles dependientes
 * (medidas/opciones) y el payload enviado deben referir al mismo mueble.
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type {
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionGroup,
} from '@granete/domain';
import { ProjectAddItemModal } from './ProjectAddItemModal';

afterEach(() => {
  cleanup();
});

// ── Fixtures: mueble A en Cocina (preset + INTERIOR requerido), B en Dormitorio ──

const categories: ModuleCategory[] = [
  { id: 'cat-cocina', name: 'Cocina', sortOrder: 1 },
  { id: 'cat-dormitorio', name: 'Dormitorio', sortOrder: 2 },
  { id: 'cat-oficina', name: 'Oficina', sortOrder: 3 },
];

const optionGroups: OptionGroup[] = [
  {
    id: 'g-interior',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a', 'mat-b'],
  },
];

const materials: MaterialBoard[] = [
  {
    id: 'mat-a',
    code: 'TAB-A',
    name: 'Blanco',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 44.65,
    costPerM2: 10,
    wastePercent: 0,
    active: true,
  },
  {
    id: 'mat-b',
    code: 'TAB-B',
    name: 'Roble',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 53.58,
    costPerM2: 12,
    wastePercent: 0,
    active: true,
  },
];

const modules: Module[] = [
  {
    id: 'mod-a',
    code: 'MOD-A',
    name: 'Mueble A',
    categoryId: 'cat-cocina',
    presets: [
      { id: 'pa-600', width: 600, height: 720, depth: 560 },
      { id: 'pa-800', width: 800, height: 720, depth: 560 },
    ],
    hardwareLines: [{ id: 'ha-1', quantity: 1, optionRole: 'INTERIOR' }],
  },
  {
    id: 'mod-b',
    code: 'MOD-B',
    name: 'Mueble B',
    categoryId: 'cat-dormitorio',
    hardwareLines: [],
  },
];

function renderModal(
  overrides: Partial<ComponentProps<typeof ProjectAddItemModal>> = {},
) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <ProjectAddItemModal
      open
      onClose={onClose}
      onSubmit={onSubmit}
      modules={modules}
      categories={categories}
      optionGroups={optionGroups}
      catalogs={{ materials, edges: [], hardware: [] }}
      // Identidades estables como el consumidor real (ProjectModalsContainer
      // pasa `catalogComponents ?? []`): sin esto, los defaults por render
      // del modal re-disparan el efecto de sincronización con catálogo vacío.
      catalogComponents={[]}
      catalogStructures={[]}
      catalogAgregados={[]}
      projectLevelChoices={{}}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

/** Selecciona un mueble desde el picker combobox (apertura + opción). */
async function pickModule(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByLabelText('Mueble'));
  await user.click(screen.getByRole('option', { name: label }));
}

/** Cambia la categoría nivel 1 del filtro del modal. */
async function selectCategory(
  user: ReturnType<typeof userEvent.setup>,
  categoryId: string,
) {
  await user.selectOptions(screen.getByLabelText('Categoría'), categoryId);
}

function addForm(): HTMLFormElement {
  const form = document.querySelector('form.project-add-item-form');
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('add-item form not rendered');
  }
  return form;
}

const addBtn = () => screen.getByRole('button', { name: 'Agregar' });

describe('ProjectAddItemModal — selección efectiva vs filtro de categoría', () => {
  it('oculta a A bajo un filtro que no la incluye: selector sin A, Agregar deshabilitado y sin envío', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    // Selección explícita de A bajo "Todas".
    await pickModule(user, /MOD-A — Mueble A/);
    await user.clear(screen.getByLabelText('Cantidad'));
    await user.type(screen.getByLabelText('Cantidad'), '3');

    // Cambio a Dormitorio (sólo existe B): A queda fuera del filtro.
    await selectCategory(user, 'cat-dormitorio');

    const trigger = screen.getByLabelText('Mueble');
    expect(trigger.textContent).not.toContain('MOD-A');
    expect(trigger.textContent).toContain('Seleccionar mueble…');

    expect(addBtn()).toBeDisabled();

    // Indicación breve en lugar de los controles del mueble oculto.
    expect(
      screen.getByText('Selecciona un mueble de la categoría actual.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('add-item-measure-preset'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Interior (INTERIOR)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Este mueble no tiene grupos de opción requeridos.'),
    ).not.toBeInTheDocument();

    await user.click(addBtn());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('un submit directo con el mueble oculto no envía el ID fuera del filtro', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await pickModule(user, /MOD-A — Mueble A/);
    await selectCategory(user, 'cat-dormitorio');

    fireEvent.submit(addForm());

    expect(onSubmit).not.toHaveBeenCalled();
    // El submit produce el error de validación (además de la indicación
    // estática del mismo mensaje bajo el selector).
    expect(
      screen.getByText('Selecciona un mueble de la categoría actual.', {
        selector: '.catalog-form__error',
      }),
    ).toBeInTheDocument();
  });

  it('seleccionar B muestra sus controles y envía el payload de B', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await selectCategory(user, 'cat-dormitorio');
    await pickModule(user, /MOD-B — Mueble B/);

    expect(screen.getByLabelText('Mueble').textContent).toContain('MOD-B');
    // B no tiene presets ni roles de opción: estado honesto, sin controles de A.
    expect(
      screen.getByText('Este mueble no tiene grupos de opción requeridos.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('add-item-measure-preset'),
    ).not.toBeInTheDocument();

    expect(addBtn()).toBeEnabled();
    await user.click(addBtn());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: 'mod-b', quantity: 1 }),
    );
    expect(onSubmit.mock.calls[0]?.[0]?.moduleId).not.toBe('mod-a');
  });

  it('volver al filtro que incluye a A recupera la selección y configuración previa', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await pickModule(user, /MOD-A — Mueble A/);
    await user.clear(screen.getByLabelText('Cantidad'));
    await user.type(screen.getByLabelText('Cantidad'), '3');
    await user.selectOptions(
      screen.getByTestId('add-item-measure-preset'),
      'pa-800',
    );
    await user.selectOptions(
      screen.getByLabelText('Interior (INTERIOR)'),
      'mat-b',
    );

    // Explorar Dormitorio no debe borrar el borrador de A.
    await selectCategory(user, 'cat-dormitorio');
    expect(screen.getByLabelText('Mueble').textContent).not.toContain('MOD-A');

    await selectCategory(user, '');
    expect(screen.getByLabelText('Mueble').textContent).toContain('MOD-A — Mueble A');
    expect(
      (screen.getByLabelText('Cantidad') as HTMLInputElement).value,
    ).toBe('3');
    expect(
      (screen.getByTestId('add-item-measure-preset') as HTMLSelectElement).value,
    ).toBe('pa-800');
    expect(
      (screen.getByLabelText('Interior (INTERIOR)') as HTMLSelectElement).value,
    ).toBe('mat-b');

    expect(addBtn()).toBeEnabled();
    await user.click(addBtn());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: 'mod-a',
        quantity: 3,
        optionChoices: { INTERIOR: 'mat-b' },
        measurePresetId: 'pa-800',
      }),
    );
  });

  it('un filtro que todavía incluye a A no invalida la selección ni pierde opciones', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await pickModule(user, /MOD-A — Mueble A/);
    await user.selectOptions(
      screen.getByLabelText('Interior (INTERIOR)'),
      'mat-b',
    );

    // Cocina sigue incluyendo a A: la selección permanece válida.
    await selectCategory(user, 'cat-cocina');

    expect(screen.getByLabelText('Mueble').textContent).toContain('MOD-A');
    expect(addBtn()).toBeEnabled();
    expect(
      (screen.getByLabelText('Interior (INTERIOR)') as HTMLSelectElement).value,
    ).toBe('mat-b');
    expect(
      screen.queryByText('Selecciona un mueble de la categoría actual.'),
    ).not.toBeInTheDocument();

    await user.click(addBtn());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: 'mod-a',
        optionChoices: { INTERIOR: 'mat-b' },
      }),
    );
  });

  it('categoría sin resultados y catálogo vacío nunca envían un mueble oculto', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await pickModule(user, /MOD-A — Mueble A/);
    // Oficina existe como categoría pero no tiene muebles.
    await selectCategory(user, 'cat-oficina');

    expect(screen.getByLabelText('Mueble').textContent).toContain(
      'Sin muebles en este filtro',
    );
    expect(addBtn()).toBeDisabled();
    fireEvent.submit(addForm());
    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();

    // Catálogo vacío: sin selección posible, el envío directo tampoco envía.
    const empty = renderModal({ modules: [], categories: [] });
    expect(addBtn()).toBeDisabled();
    fireEvent.submit(addForm());
    expect(empty.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Elegí un mueble del catálogo.')).toBeInTheDocument();
  });

  it('el envío normal conserva el payload y las validaciones previas', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderModal();

    await pickModule(user, /MOD-A — Mueble A/);
    await user.clear(screen.getByLabelText('Cantidad'));
    await user.type(screen.getByLabelText('Cantidad'), '2');
    await user.selectOptions(
      screen.getByTestId('add-item-measure-preset'),
      'pa-800',
    );
    await user.selectOptions(
      screen.getByLabelText('Interior (INTERIOR)'),
      'mat-b',
    );

    await user.click(addBtn());
    expect(onSubmit).toHaveBeenCalledWith({
      moduleId: 'mod-a',
      quantity: 2,
      optionChoices: { INTERIOR: 'mat-b' },
      measurePresetId: 'pa-800',
      baseMode: 'plinth_board',
    });

    // Validaciones existentes: opción requerida y cantidad siguen vigentes.
    cleanup();
    const second = renderModal();

    // Opción requerida vacía (heredar sin default de proyecto) → submit normal.
    await user.selectOptions(screen.getByLabelText('Interior (INTERIOR)'), '');
    await user.click(addBtn());
    expect(second.onSubmit).not.toHaveBeenCalled();
    expect(
      screen.getByText('Falta elegir: Interior (INTERIOR).'),
    ).toBeInTheDocument();

    // Cantidad 0: el input tiene min=1 nativo que bloquea el submit del
    // navegador; un submit programático que lo esquiva sigue topando con la
    // validación del modal.
    await user.clear(screen.getByLabelText('Cantidad'));
    await user.type(screen.getByLabelText('Cantidad'), '0');
    fireEvent.submit(addForm());
    expect(second.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('La cantidad debe ser ≥ 1.')).toBeInTheDocument();
  });
});
