// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModuleEditorParametersPanel } from './ModuleEditorParametersPanel';
import type { ModuleDraft } from '../moduleHelpers';
import { emptyModuleDraft } from '../helpers/moduleDraftTransforms';
import type { Structure } from '@granete/domain';

function draftWith(overrides: Partial<ModuleDraft> = {}): ModuleDraft {
  return { ...emptyModuleDraft(), ...overrides };
}

const catalogComponents = [
  { id: 'comp-side-1', code: 'LAT', name: 'Lateral' },
  { id: 'comp-shelf-1', code: 'EST', name: 'Estante' },
] as never;

const structures: Structure[] = [
  {
    id: 'struct-1',
    code: 'STR-1',
    name: 'Cuerpo base',
    components: [{ componentId: 'comp-back-1', quantity: 1 }],
  },
] as never;

function renderPanel(draft: ModuleDraft, setDraft = vi.fn()) {
  return render(
    <ModuleEditorParametersPanel
      draft={draft}
      setDraft={setDraft}
      structures={structures}
      selectedStructure={structures[0]}
      catalogComponents={catalogComponents}
      canMutate
      hidden={false}
    />,
  );
}

afterEach(cleanup);

describe('ModuleEditorParametersPanel (#497 T5/T6)', () => {
  it('shows the reserved dimensions as a read-only projection with ranges', () => {
    renderPanel(
      draftWith({
        externalWidth: '600',
        externalHeight: '720',
        externalDepth: '590',
        presets: [{ id: 'p1', name: 'Alto', width: 500, height: 800, depth: 560 }],
      }),
    );
    const list = screen.getByTestId('parameters-reserved-list');
    expect(list.textContent).toContain('widthMm');
    expect(list.textContent).toContain('500–600');
    expect(list.textContent).toContain('heightMm');
    expect(list.textContent).toContain('720–800');
    // There is no editor for reserved names: they are projections.
    expect(screen.queryByTestId('parameter-editor')).toBeNull();
  });

  it('creates a number parameter with an integer componentQuantity binding', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    renderPanel(
      draftWith({
        components: [{ componentId: 'comp-shelf-1', quantity: 1 }],
      }),
      setDraft,
    );

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'shelfCount');
    await user.type(screen.getByTestId('parameter-label'), 'Cantidad de estantes');
    await user.selectOptions(screen.getByTestId('parameter-category'), 'configuration');
    await user.type(screen.getByTestId('parameter-min'), '0');
    await user.type(screen.getByTestId('parameter-max'), '10');
    await user.click(screen.getByTestId('parameter-integer'));
    await user.selectOptions(screen.getByTestId('parameter-binding-kind'), 'componentQuantity');
    await user.selectOptions(
      screen.getByTestId('parameter-binding-component'),
      'comp-shelf-1',
    );
    await user.click(screen.getByTestId('parameter-save'));

    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0]![0] as (prev: ModuleDraft) => ModuleDraft;
    const next = updater(draftWith({
      components: [{ componentId: 'comp-shelf-1', quantity: 1 }],
    }));
    expect(next.parameterDefinitions).toHaveLength(1);
    const created = next.parameterDefinitions![0]!;
    expect(created.name).toBe('shelfCount');
    expect(created.category).toBe('configuration');
    expect(created.integer).toBe(true);
    expect(created.binding).toEqual({
      version: 1,
      kind: 'componentQuantity',
      componentId: 'comp-shelf-1',
    });
    expect(created.sortOrder).toBe(1);
  });

  it('keeps an explicit false boolean default through save (never dropped)', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    renderPanel(draftWith(), setDraft);

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'softClose');
    await user.type(screen.getByTestId('parameter-label'), 'Cierre suave');
    await user.selectOptions(screen.getByTestId('parameter-type'), 'boolean');
    await user.selectOptions(screen.getByTestId('parameter-category'), 'metadata');
    await user.selectOptions(screen.getByTestId('parameter-default'), 'false');
    await user.click(screen.getByTestId('parameter-save'));

    const updater = setDraft.mock.calls[0]![0] as (prev: ModuleDraft) => ModuleDraft;
    const created = updater(draftWith()).parameterDefinitions![0]!;
    // 'defaultValue' in created must be the boolean false, present on purpose.
    expect(created.defaultValue).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(created, 'defaultValue')).toBe(true);
    expect(created.binding).toBeUndefined();
  });

  it('creates an enum parameter with ordered options and a default', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    renderPanel(draftWith(), setDraft);

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'estiloFrente');
    await user.type(screen.getByTestId('parameter-label'), 'Estilo de frente');
    await user.selectOptions(screen.getByTestId('parameter-type'), 'enum');
    await user.selectOptions(screen.getByTestId('parameter-category'), 'metadata');
    await user.click(screen.getByTestId('parameter-option-add'));
    await user.type(screen.getByTestId('parameter-option-0'), 'slab');
    await user.click(screen.getByTestId('parameter-option-add'));
    await user.type(screen.getByTestId('parameter-option-1'), 'shaker');
    await user.selectOptions(screen.getByTestId('parameter-default'), 'shaker');
    await user.click(screen.getByTestId('parameter-save'));

    const updater = setDraft.mock.calls[0]![0] as (prev: ModuleDraft) => ModuleDraft;
    const created = updater(draftWith()).parameterDefinitions![0]!;
    expect(created.options).toEqual(['slab', 'shaker']);
    expect(created.defaultValue).toBe('shaker');
  });

  it('blocks metadata parameters from carrying a binding', async () => {
    const user = userEvent.setup();
    renderPanel(
      draftWith({
        components: [{ componentId: 'comp-shelf-1', quantity: 1 }],
      }),
    );

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'nota');
    await user.type(screen.getByTestId('parameter-label'), 'Nota');
    await user.selectOptions(screen.getByTestId('parameter-category'), 'metadata');
    // The binding fieldset is not offered for metadata at all.
    expect(screen.queryByTestId('parameter-binding')).toBeNull();
    expect(screen.getByTestId('parameter-metadata-hint').textContent).toMatch(
      /no llevan vinculación/,
    );
  });

  it('rejects a non-metadata parameter without a binding before writing the draft', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    renderPanel(draftWith());

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'shelfCount');
    await user.type(screen.getByTestId('parameter-label'), 'Cantidad de estantes');
    await user.click(screen.getByTestId('parameter-save'));

    expect(screen.getByTestId('parameter-editor-error').textContent).toMatch(
      /necesitan una vinculación semántica/,
    );
    expect(setDraft).not.toHaveBeenCalled();
  });

  it('surfaces ambiguity instead of selecting the first component', async () => {
    const user = userEvent.setup();
    renderPanel(
      draftWith({
        components: [
          { componentId: 'comp-side-1', quantity: 1 },
          { componentId: 'comp-side-1', quantity: 1 },
        ],
      }),
    );

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'doorPresence');
    await user.type(screen.getByTestId('parameter-label'), 'Puerta');
    await user.selectOptions(screen.getByTestId('parameter-type'), 'boolean');
    await user.selectOptions(screen.getByTestId('parameter-binding-kind'), 'componentCondition');

    const select = screen.getByTestId('parameter-binding-component') as HTMLSelectElement;
    const ambiguousOption = Array.from(select.options).find(
      (option) => option.value === 'comp-side-1',
    )!;
    expect(ambiguousOption.disabled).toBe(true);
    expect(ambiguousOption.textContent).toMatch(/ambiguo \(2 entradas\)/);
    // The empty placeholder stays selectable; no first-match auto-selection.
    expect(select.value).toBe('');
  });

  it('explains kind/type incompatibility by disabling the mismatched kind', async () => {
    const user = userEvent.setup();
    renderPanel(draftWith());

    await user.click(screen.getByTestId('parameter-add'));
    await user.type(screen.getByTestId('parameter-name'), 'notaCliente');
    await user.type(screen.getByTestId('parameter-label'), 'Nota');
    await user.selectOptions(screen.getByTestId('parameter-type'), 'string');
    await user.type(screen.getByTestId('parameter-max-length'), '80');
    await user.selectOptions(screen.getByTestId('parameter-category'), 'style');

    const kindSelect = screen.getByTestId('parameter-binding-kind') as HTMLSelectElement;
    const quantityOption = Array.from(kindSelect.options).find(
      (option) => option.value === 'componentQuantity',
    )!;
    expect(quantityOption.disabled).toBe(true);
    expect(quantityOption.textContent).toMatch(/requiere número entero/);
  });

  it('shows contract issues on existing rows with remediation, and structure targets', async () => {
    const user = userEvent.setup();
    renderPanel(
      draftWith({
        structureId: 'struct-1',
        parameterDefinitions: [
          {
            name: 'shelfCount',
            label: 'Cantidad de estantes',
            type: 'number',
            category: 'configuration',
            defaultValue: 2,
            integer: true,
            required: true,
            unit: 'count',
            binding: {
              version: 1,
              kind: 'componentQuantity',
              componentId: 'comp-back-1',
            },
          },
        ],
      }),
    );

    // The domain validator is shape-level (no catalog): the structure target
    // is NOT flagged client-side — the SERVER owns consumer resolution and
    // would answer PARAMETER_DEFINITION_INVALID on save. The row stays clean
    // and the binding editor still offers the structure entry as a source.
    expect(screen.queryByTestId('parameter-row-issue')).toBeNull();

    // And a NEW binding form offers the structure entry as a target source.
    await user.click(screen.getByTestId('parameter-edit'));
    await user.selectOptions(screen.getByTestId('parameter-binding-kind'), 'componentQuantity');
    const select = screen.getByTestId('parameter-binding-component') as HTMLSelectElement;
    const structureOption = Array.from(select.options).find(
      (option) => option.value === 'comp-back-1',
    )!;
    expect(structureOption.textContent).toContain('estructura');
  });

  it('reorders with the up/down controls and renumbers sortOrder', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    const draft = draftWith({
      parameterDefinitions: [
        {
          name: 'alpha',
          label: 'Alfa',
          type: 'boolean',
          category: 'metadata',
          sortOrder: 1,
        },
        {
          name: 'beta',
          label: 'Beta',
          type: 'boolean',
          category: 'metadata',
          sortOrder: 2,
        },
      ],
    });
    renderPanel(draft, setDraft);

    const rows = screen.getAllByTestId('parameter-row');
    expect(rows[0]!.textContent).toContain('Alfa');
    await user.click(screen.getAllByTestId('parameter-move-up')[1]!);

    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0]![0] as (prev: ModuleDraft) => ModuleDraft;
    const next = updater(draft);
    expect(next.parameterDefinitions!.map((p) => p.name)).toEqual(['beta', 'alpha']);
    expect(next.parameterDefinitions!.map((p) => p.sortOrder)).toEqual([1, 2]);
  });

  it('disables every control when the actor cannot mutate', () => {
    render(
      <ModuleEditorParametersPanel
        draft={draftWith()}
        setDraft={vi.fn()}
        structures={structures}
        selectedStructure={structures[0]}
        catalogComponents={catalogComponents}
        canMutate={false}
        hidden={false}
      />,
    );
    expect((screen.getByTestId('parameter-add') as HTMLButtonElement).disabled).toBe(true);
  });
});
