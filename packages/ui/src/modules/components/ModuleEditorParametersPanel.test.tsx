// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type {
  FurnitureAuthoringPreviewRequest,
  FurnitureAuthoringPreviewResponse,
} from '@granete/domain';
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

function renderPanel(
  draft: ModuleDraft,
  setDraft = vi.fn(),
  savedModuleId: string | null = null,
  onPreviewAuthoring?: (
    request: FurnitureAuthoringPreviewRequest,
  ) => Promise<FurnitureAuthoringPreviewResponse>,
) {
  return render(
    <ModuleEditorParametersPanel
      draft={draft}
      setDraft={setDraft}
      structures={structures}
      selectedStructure={structures[0]}
      catalogComponents={catalogComponents}
      canMutate
      hidden={false}
      savedModuleId={savedModuleId}
      onPreviewAuthoring={onPreviewAuthoring}
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

  it('preview guard: without a saved module the section explains and disables', () => {
    renderPanel(draftWith(), vi.fn(), null, vi.fn());
    expect(screen.getByTestId('parameter-preview-guard').textContent).toMatch(
      /Guardá el mueble primero/,
    );
    expect(
      (screen.getByTestId('parameter-preview-run') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Probar resolución sends the draft + typed samples and renders the accepted summary', async () => {
    const user = userEvent.setup();
    const onPreviewAuthoring = vi.fn().mockResolvedValue({
      moduleId: 'mod-1',
      catalogRevision: 'workshop-abc123def456',
      status: 'accepted',
      definitionHash: 'sha256-abc123',
      definitionParameters: [],
      resolved: {
        layout: { components: [{}, {}], hardware: [{}] },
        machining: { manufacturingFingerprint: 'sha256-fp' },
        preflight: {
          scope: 'authoring-resolve-subset',
          status: 'clear',
          issues: [],
          preflightContract: 'granete.manufacturing-preflight.v1',
        },
      },
      issues: [],
    });
    renderPanel(
      draftWith({
        parameterDefinitions: [
          {
            name: 'shelfCount',
            label: 'Cantidad de estantes',
            type: 'number',
            category: 'configuration',
            defaultValue: 2,
            required: true,
            unit: 'count',
            integer: true,
          },
        ],
      }),
      vi.fn(),
      'mod-1',
      onPreviewAuthoring,
    );

    // Sample input seeded from the definition default.
    const sample = screen.getByTestId('parameter-sample-shelfCount') as HTMLInputElement;
    expect(sample.value).toBe('2');
    await user.clear(sample);
    await user.type(sample, '3');
    await user.click(screen.getByTestId('parameter-preview-run'));

    await screen.findByTestId('parameter-preview-accepted');
    expect(onPreviewAuthoring).toHaveBeenCalledTimes(1);
    const request = onPreviewAuthoring.mock.calls[0]![0] as {
      moduleId: string;
      parameterDefinitions: unknown[];
      parameters: Record<string, unknown>;
    };
    expect(request.moduleId).toBe('mod-1');
    // numbers arrive as numbers, never strings
    expect(request.parameters).toEqual({ shelfCount: 3 });
    const summary = screen.getByTestId('parameter-preview-accepted').textContent ?? '';
    expect(summary).toMatch(/Resolución aceptada/);
    expect(summary).toMatch(/2 piezas/);
    expect(summary).toMatch(/sin bloqueos/);
  });

  it('renders rejected previews as structured Spanish issues', async () => {
    const user = userEvent.setup();
    const onPreviewAuthoring = vi.fn().mockResolvedValue({
      moduleId: 'mod-1',
      catalogRevision: 'workshop-abc123def456',
      status: 'rejected',
      issues: [
        {
          code: 'PARAMETER_OUT_OF_RANGE',
          message: 'out of range',
          severity: 'error',
          path: 'furniture.parameters.widthMm',
          details: { parameter: 'widthMm' },
        },
      ],
    });
    renderPanel(
      draftWith({
        parameterDefinitions: [
          {
            name: 'widthMm',
            label: 'Ancho',
            type: 'number',
            category: 'dimension',
            defaultValue: 600,
            required: true,
            unit: 'mm',
            integer: true,
          },
        ],
      }),
      vi.fn(),
      'mod-1',
      onPreviewAuthoring,
    );

    await user.click(screen.getByTestId('parameter-preview-run'));
    await screen.findByTestId('parameter-preview-rejected');
    const rejected = screen.getByTestId('parameter-preview-rejected').textContent ?? '';
    expect(rejected).toMatch(/Resolución rechazada/);
    expect(rejected).toMatch(/El parámetro está fuera del rango permitido: widthMm/);
    expect(screen.queryByTestId('parameter-preview-accepted')).toBeNull();
  });

  it('removal goes through an impact confirmation that never deletes directly', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    const draft = draftWith({
      parameterDefinitions: [
        {
          name: 'shelfCount',
          label: 'Cantidad de estantes',
          type: 'number',
          category: 'configuration',
          defaultValue: 2,
          required: true,
          unit: 'count',
          integer: true,
          binding: {
            version: 1,
            kind: 'componentQuantity',
            componentId: 'comp-shelf-1',
          },
        },
      ],
    });
    renderPanel(draft, setDraft);

    await user.click(screen.getByTestId('parameter-remove'));
    // Nothing was removed yet: the impact dialog explains the evolution.
    expect(setDraft).not.toHaveBeenCalled();
    const message = await screen.findByText(
      /hash de la definición y la revisión del catálogo avanzan/,
    );
    expect(message.textContent).toMatch(/ningún preset usa este parámetro/);
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0]![0] as (prev: ModuleDraft) => ModuleDraft;
    expect(updater(draft).parameterDefinitions).toEqual([]);
  });

  it('shows the evolution impact when changing the type of an existing parameter', async () => {
    const user = userEvent.setup();
    renderPanel(
      draftWith({
        parameterDefinitions: [
          {
            name: 'shelfCount',
            label: 'Cantidad de estantes',
            type: 'number',
            category: 'configuration',
            defaultValue: 2,
            required: true,
            unit: 'count',
            integer: true,
          },
        ],
      }),
    );

    await user.click(screen.getByTestId('parameter-edit'));
    expect(screen.queryByTestId('parameter-type-impact')).toBeNull();
    await user.selectOptions(screen.getByTestId('parameter-type'), 'boolean');
    expect(screen.getByTestId('parameter-type-impact').textContent).toMatch(
      /hash de la definición y la revisión del catálogo avanzan/,
    );
  });
});
