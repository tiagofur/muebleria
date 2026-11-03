/**
 * Tests for AgregadoEditorForm: live 3D preview wiring (Fase 3 UI) and the
 * General tab workspace (summary aside + dims readout + tab shortcuts).
 * @vitest-environment jsdom
 */

import type { FormEvent, Dispatch, SetStateAction } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component, Hardware, OptionGroup } from '@granete/domain';
import type { Module3DCatalogInput } from '../../modules/module3dPreview';
import {
  AgregadoEditorForm,
  type AgregadoEditorTab,
} from './AgregadoEditorForm';
import {
  createEmptyAgregadoDraft,
  type AgregadoDraft,
} from '../agregadoDraft';

const mockComponent: Component = {
  id: 'c-puerta',
  code: 'PRT-STD',
  name: 'Hoja de Puerta',
  placement: 'puerta',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 0,
    widthMm: 0,
    thicknessMm: 18,
    lengthFormula: 'H',
    widthFormula: 'W',
  },
  defaultEdges: [],
  optionRoles: ['PUERTA'],
  active: true,
};

const mockCatalogInput: Module3DCatalogInput = {
  modules: [],
  structures: [],
  components: [mockComponent],
  materials: [
    {
      id: 'mat-1',
      code: 'MDF18',
      name: 'MDF 18mm',
      widthMm: 1830,
      lengthMm: 2600,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 20,
      active: true,
    },
  ],
  edges: [],
  hardware: [],
  optionGroups: [
    {
      id: 'og-puerta',
      code: 'PUERTA',
      name: 'Puerta',
      kind: 'board',
      required: true,
      optionIds: ['mat-1'],
    },
  ],
};

function doorDraft(): AgregadoDraft {
  return {
    ...createEmptyAgregadoDraft(),
    code: 'PRT-1',
    name: 'Puerta',
    widthMm: 600,
    heightMm: 720,
    depthMm: 18,
    components: [
      { componentId: 'c-puerta', quantity: 1, placementOverride: 'puerta' },
    ],
  };
}

function renderForm({
  catalogInput,
  editorTab = 'components',
  draft = doorDraft(),
  onSetEditorTab,
  optionGroups,
  setDraft,
  catalogComponents = [mockComponent],
  catalogHardware = [] as unknown as readonly Hardware[],
}: {
  readonly catalogInput?: Module3DCatalogInput;
  readonly editorTab?: AgregadoEditorTab;
  readonly draft?: AgregadoDraft;
  readonly onSetEditorTab?: Dispatch<SetStateAction<AgregadoEditorTab>>;
  readonly optionGroups?: readonly OptionGroup[];
  readonly setDraft?: Dispatch<SetStateAction<AgregadoDraft>>;
  readonly catalogComponents?: readonly Component[];
  readonly catalogHardware?: readonly Hardware[];
}) {
  render(
    <AgregadoEditorForm
      formId="form-1"
      error={null}
      onSubmit={vi.fn() as (e: FormEvent) => void}
      editorTab={editorTab}
      setEditorTab={
        onSetEditorTab ??
        (vi.fn() as Dispatch<SetStateAction<AgregadoEditorTab>>)
      }
      draft={draft}
      setDraft={setDraft ?? (vi.fn() as Dispatch<SetStateAction<AgregadoDraft>>)}
      editingId={null}
      catalogComponents={catalogComponents}
      catalogHardware={catalogHardware}
      catalogInput={catalogInput}
      optionGroups={optionGroups}
    />,
  );
}

describe('AgregadoEditorForm — live 3D preview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the 3D preview panel in the Piezas tab when catalogInput is provided', () => {
    renderForm({ catalogInput: mockCatalogInput });
    expect(screen.getByTestId('agregado-editor-3d-preview')).toBeTruthy();
  });

  it('renders the 3D preview panel in the Herrajes tab when catalogInput is provided', () => {
    renderForm({ catalogInput: mockCatalogInput, editorTab: 'hardware' });
    expect(screen.getByTestId('agregado-editor-3d-preview')).toBeTruthy();
  });

  it('omits the 3D preview panel when catalogInput is missing (graceful degradation)', () => {
    renderForm({ catalogInput: undefined });
    expect(screen.queryByTestId('agregado-editor-3d-preview')).toBeNull();
  });

  it('does not render the 3D preview on the General tab', () => {
    renderForm({ catalogInput: mockCatalogInput, editorTab: 'general' });
    expect(screen.queryByTestId('agregado-editor-3d-preview')).toBeNull();
  });
});

describe('AgregadoEditorForm — General tab', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the reference dims readout and piece/hardware counts in the summary aside', () => {
    const draft = doorDraft();
    draft.hardwareLines = [
      { id: 'hl-1', quantity: 2, optionRole: 'BISAGRA' },
    ];
    renderForm({ editorTab: 'general', draft });

    expect(
      screen.getByTestId('agregado-general-dims-readout').textContent,
    ).toBe('600 × 720 × 18 mm');
    expect(
      screen.getByTestId('agregado-general-count-components').textContent,
    ).toBe('1');
    expect(
      screen.getByTestId('agregado-general-count-hardware').textContent,
    ).toBe('1');
  });

  it('omits the dims readout when the draft has no reference dims', () => {
    renderForm({ editorTab: 'general', draft: createEmptyAgregadoDraft() });
    expect(
      screen.queryByTestId('agregado-general-dims-readout'),
    ).toBeNull();
    expect(screen.getByTestId('agregado-general-summary')).toBeTruthy();
  });

  it('summary shortcuts jump to the Piezas and Herrajes tabs', () => {
    const setEditorTab = vi.fn() as Dispatch<
      SetStateAction<AgregadoEditorTab>
    >;
    renderForm({ editorTab: 'general', onSetEditorTab: setEditorTab });

    fireEvent.click(screen.getByTestId('agregado-general-goto-components'));
    expect(setEditorTab).toHaveBeenCalledWith('components');

    fireEvent.click(screen.getByTestId('agregado-general-goto-hardware'));
    expect(setEditorTab).toHaveBeenCalledWith('hardware');
  });

  it('exposes the tabpanel contract (role + aria-labelledby)', () => {
    renderForm({ editorTab: 'general' });
    const panel = screen.getByTestId('agregado-tab-general');
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'agregado-editor-tab-general',
    );
    expect(screen.getByTestId('agregado-editor-tab-general').id).toBe(
      'agregado-editor-tab-general',
    );
  });

  it('F109: uses WorkspaceTabs (tablist contract + roving arrows)', () => {
    const setEditorTab = vi.fn() as Dispatch<
      SetStateAction<AgregadoEditorTab>
    >;
    renderForm({ editorTab: 'general', onSetEditorTab: setEditorTab });

    const tablist = screen.getByTestId('agregado-editor-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');

    const general = screen.getByTestId('agregado-editor-tab-general');
    expect(general.getAttribute('role')).toBe('tab');
    expect(general.getAttribute('aria-controls')).toBe(
      'agregado-editor-panel-general',
    );
    const panel = screen.getByTestId('agregado-tab-general');
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'agregado-editor-tab-general',
    );

    // Roving tabindex + arrow navigation (selection follows focus).
    expect(general.getAttribute('tabindex')).toBe('0');
    const components = screen.getByTestId('agregado-editor-tab-components');
    expect(components.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(setEditorTab).toHaveBeenCalledWith('components');
    expect(document.activeElement).toBe(components);
  });

  it('reflects hardware per level in the Herrajes tab badge and general summary (#1451)', () => {
    const draft = doorDraft();
    draft.hardwareLines = [{ id: 'hl-1', quantity: 1, optionRole: 'BISAGRA' }];
    draft.components[0] = {
      ...draft.components[0]!,
      overrides: {
        hardwarePlacements: [
          {
            hardwareId: 'hw-1',
            anchorFace: 'front',
            relativePosition: { xMm: 30, yMm: 50 },
          },
        ],
      },
    };

    renderForm({ editorTab: 'general', draft });

    // Herrajes tab badge shows levels, never the raw sum: «1 + 1 pos.»
    const hwTab = screen.getByTestId('agregado-editor-tab-hardware');
    expect(hwTab.textContent).toContain('1 + 1 pos.');

    // General summary count keeps the combined total
    expect(
      screen.getByTestId('agregado-general-count-hardware').textContent,
    ).toBe('2');
  });

  it('allows configuring presentation motion and open angle in the General tab (#529)', () => {
    let draft = createEmptyAgregadoDraft();
    const setDraft = vi.fn((updater) => {
      draft = typeof updater === 'function' ? updater(draft) : updater;
    });

    const renderWithDraft = (d: AgregadoDraft) =>
      render(
        <AgregadoEditorForm
          formId="form-1"
          error={null}
          onSubmit={vi.fn()}
          editorTab="general"
          setEditorTab={vi.fn()}
          draft={d}
          setDraft={setDraft}
          editingId={null}
          catalogComponents={[mockComponent]}
          catalogHardware={[]}
        />,
      );

    const { rerender } = renderWithDraft(draft);

    const motionSelect = screen.getByTestId('agregado-field-motion-type') as HTMLSelectElement;
    expect(motionSelect.value).toBe('none');
    expect(screen.queryByTestId('agregado-field-open-angle')).toBeNull();

    // Select rotate_left
    fireEvent.change(motionSelect, { target: { value: 'rotate_left' } });
    expect(setDraft).toHaveBeenCalled();

    // Rerender with updated draft
    draft = { ...draft, motionType: 'rotate_left', openAngleDeg: 110 };
    rerender(
      <AgregadoEditorForm
        formId="form-1"
        error={null}
        onSubmit={vi.fn()}
        editorTab="general"
        setEditorTab={vi.fn()}
        draft={draft}
        setDraft={setDraft}
        editingId={null}
        catalogComponents={[mockComponent]}
        catalogHardware={[]}
      />,
    );

    const angleInput = screen.getByTestId('agregado-field-open-angle') as HTMLInputElement;
    expect(angleInput).toBeTruthy();
    expect(angleInput.value).toBe('110');
    fireEvent.change(angleInput, { target: { value: '95' } });
    expect(setDraft).toHaveBeenCalled();
  });
});

describe('AgregadoEditorForm — governed hardware role (S4 #1009)', () => {
  afterEach(() => {
    cleanup();
  });

  const hardwareGroups: OptionGroup[] = [
    {
      id: 'og-bisagra',
      code: 'BISAGRA',
      name: 'Bisagras',
      kind: 'hardware',
      required: false,
      optionIds: [],
    },
    {
      id: 'og-correderea',
      code: 'CORREDERA',
      name: 'Correderas',
      kind: 'hardware',
      required: false,
      optionIds: [],
    },
    {
      id: 'og-tablero',
      code: 'MADERA',
      name: 'Madera (board — no es rol de herraje)',
      kind: 'board',
      required: false,
      optionIds: [],
    },
  ];

  function hwDraft(optionRole: string): AgregadoDraft {
    const draft = doorDraft();
    draft.hardwareLines = [{ id: 'hl-1', quantity: 1, optionRole }];
    return draft;
  }

  it('renders the role as a select fed by hardware-kind option groups only', () => {
    renderForm({ editorTab: 'hardware', draft: hwDraft('BISAGRA'), optionGroups: hardwareGroups });

    const roleSelect = screen.getByTestId('agregado-hw-0-role') as HTMLSelectElement;
    expect(roleSelect.tagName).toBe('SELECT');
    const values = Array.from(roleSelect.options).map((o) => o.value);
    expect(values).toContain('BISAGRA');
    expect(values).toContain('CORREDERA');
    // Board groups are not hardware roles — never offered.
    expect(values).not.toContain('MADERA');
    expect(roleSelect.value).toBe('BISAGRA');
  });

  it('keeps a saved role outside the catalog visible instead of rewriting it', () => {
    renderForm({ editorTab: 'hardware', draft: hwDraft('BISAGRS'), optionGroups: hardwareGroups });

    const roleSelect = screen.getByTestId('agregado-hw-0-role') as HTMLSelectElement;
    expect(roleSelect.value).toBe('BISAGRS');
    expect(
      Array.from(roleSelect.options).find((o) => o.value === 'BISAGRS')?.textContent,
    ).toContain('(guardado)');
  });

  it('propagates the selection to the draft', () => {
    const setDraft = vi.fn() as Dispatch<SetStateAction<AgregadoDraft>>;
    renderForm({
      editorTab: 'hardware',
      draft: hwDraft('BISAGRA'),
      optionGroups: hardwareGroups,
      setDraft,
    });

    fireEvent.change(screen.getByTestId('agregado-hw-0-role'), {
      target: { value: 'CORREDERA' },
    });
    expect(setDraft).toHaveBeenCalled();
  });

  it('degrades to the free-text input when option groups are not provided', () => {
    renderForm({ editorTab: 'hardware', draft: hwDraft('BISAGRA') });

    const roleInput = screen.getByTestId('agregado-hw-0-role') as HTMLInputElement;
    expect(roleInput.tagName).toBe('INPUT');
    expect(roleInput.value).toBe('BISAGRA');
  });
});

describe('AgregadoEditorForm — component picker (S5 #1009)', () => {
  afterEach(() => {
    cleanup();
  });

  const extraComponent: Component = {
    id: 'c-base',
    code: 'PRT-BASE',
    name: 'Base de Cajón',
    placement: 'base',
    geometry: {
      kind: 'rectangular_board',
      lengthMm: 0,
      widthMm: 0,
      thicknessMm: 15,
    },
    defaultEdges: [],
    optionRoles: ['CAJON'],
    active: true,
  };

  it('opens the searchable picker from Añadir Pieza and appends the picked instance', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn();
    renderForm({
      setDraft: setDraft as unknown as Dispatch<SetStateAction<AgregadoDraft>>,
      catalogComponents: [mockComponent, extraComponent],
    });

    await user.click(screen.getByTestId('agregado-add-component'));

    // Modal mounts through a double-rAF animation bootstrap — findBy waits for it.
    const modal = await screen.findByTestId('component-adder-modal');
    expect(modal).toBeTruthy();

    // Search filters the catalog (radio per component, code+name in spans).
    const search = screen.getByTestId('comp-adder-search') as HTMLInputElement;
    await user.type(search, 'Base');
    expect(screen.getByTestId('comp-radio-PRT-BASE')).toBeTruthy();
    expect(screen.queryByTestId('comp-radio-PRT-STD')).toBeNull();

    await user.click(screen.getByTestId('comp-radio-PRT-BASE'));
    await user.click(screen.getByTestId('confirm-add-component'));

    expect(setDraft).toHaveBeenCalledTimes(1);
    const updater = setDraft.mock.calls[0]?.[0] as (prev: AgregadoDraft) => AgregadoDraft;
    const next = updater(doorDraft());
    expect(next.components.at(-1)?.componentId).toBe('c-base');
    expect(next.components.at(-1)?.quantity).toBe(1);
  });

  it('shows the catalog components without search when the picker opens', async () => {
    const user = userEvent.setup();
    const setDraft = vi.fn() as Dispatch<SetStateAction<AgregadoDraft>>;
    renderForm({ setDraft });

    await user.click(screen.getByTestId('agregado-add-component'));
    await screen.findByTestId('component-adder-modal');
    expect(screen.getByTestId('comp-radio-PRT-STD')).toBeTruthy();
  });
});

describe('AgregadoEditorForm — herrajes por grupo (#1046)', () => {
  afterEach(() => {
    cleanup();
  });

  const grupoOptionGroups: OptionGroup[] = [
    {
      id: 'og-bisagra',
      code: 'BISAGRA',
      name: 'Bisagras',
      kind: 'hardware',
      required: true,
      optionIds: ['hw-blum', 'hw-eco'],
    },
  ];

  function specificDraft(): AgregadoDraft {
    const draft = doorDraft();
    draft.hardwareLines = [
      { id: 'hl-1', quantity: 2, optionRole: 'BISAGRA', hardwareId: 'hw-blum' },
    ];
    return draft;
  }

  it('a line with concrete hardware renders the searchable picker with its value', () => {
    renderForm({
      editorTab: 'hardware',
      draft: specificDraft(),
      optionGroups: grupoOptionGroups,
      catalogHardware: [
        {
          id: 'hw-blum',
          code: 'BIS-BLUM',
          name: 'Bisagra Blum',
          active: true,
        } as unknown as Hardware,
      ],
    });

    expect(screen.getByTestId('agregado-hw-0-mode')).toBeTruthy();
    // #1451: the specific author is a CatalogPicker (searchable), never a
    // raw select — and it shows the picked hardware, not a placeholder.
    const picker = screen.getByTestId('agregado-hw-0-select');
    expect(picker.textContent).not.toContain('Seleccionar herraje…');
    expect(picker.textContent).toContain('BIS-BLUM');
  });

  it('switching a line to group mode clears hardwareId, keeps the role and lists members', () => {
    const setDraftMock = vi.fn();
    const setDraft = setDraftMock as unknown as Dispatch<SetStateAction<AgregadoDraft>>;
    renderForm({
      editorTab: 'hardware',
      draft: specificDraft(),
      optionGroups: grupoOptionGroups,
      setDraft,
    });

    fireEvent.change(screen.getByTestId('agregado-hw-0-mode'), {
      target: { value: 'grupo' },
    });

    const updater = setDraftMock.mock.calls.at(-1)![0] as (
      prev: AgregadoDraft,
    ) => AgregadoDraft;
    const next = updater(specificDraft());
    const line = next.hardwareLines[0]!;
    expect(line.hardwareId).toBeUndefined();
    expect(line.optionRole).toBe('BISAGRA');
  });

  it('a group line lists its members with the quote-time choice hint', () => {
    const draft = specificDraft();
    draft.hardwareLines = [
      { id: 'hl-1', quantity: 2, optionRole: 'BISAGRA' },
    ];
    renderForm({
      editorTab: 'hardware',
      draft,
      optionGroups: grupoOptionGroups,
    });

    // El harness de este formulario pasa catalogHardware vacío: el hint
    // honesto es "Sin miembros activos." (los miembros con costo se cubren en
    // HardwarePlacementsEditor.test).
    expect(screen.getByTestId('agregado-hw-0-members').textContent).toContain(
      'Se elige al cotizar',
    );
  });

  it('without option groups the Modo selector is absent and behavior is unchanged', () => {
    renderForm({ editorTab: 'hardware', draft: specificDraft() });
    expect(screen.queryByTestId('agregado-hw-0-mode')).toBeNull();
    expect(screen.getByTestId('agregado-hw-0-select')).toBeTruthy();
  });
});

describe('AgregadoEditorForm — Herrajes por nivel de anclaje (#1451)', () => {
  afterEach(() => {
    cleanup();
  });

  const hwFixture = [
    { id: 'hw-corr', code: 'CORR-500', name: 'Corredera Telescópica 500mm', active: true },
    { id: 'hw-jal', code: 'JAL-120', name: 'Jaladera 120mm', active: true },
  ] as unknown as Hardware[];

  const memberDraft = (): AgregadoDraft => {
    const draft = doorDraft();
    draft.rigidMembers = [
      {
        memberId: 'miembro-1',
        role: 'fixed_rail',
        source: { kind: 'fixed', fixed: { hardwareId: 'hw-corr' } },
        placement: {
          x: { ref: 'min', offsetMm: 0 },
          y: { ref: 'min', offsetMm: 0 },
          z: { ref: 'min', offsetMm: 0 },
        },
        bomRole: 'separately_purchased',
      },
    ];
    return draft;
  };

  it('el «+ Añadir herraje» de la sección Del ensamble agrega un miembro sin default encubierto (#1462)', async () => {
    const user = userEvent.setup();
    const setDraftMock = vi.fn();
    renderForm({
      editorTab: 'hardware',
      setDraft: setDraftMock as unknown as Dispatch<SetStateAction<AgregadoDraft>>,
      catalogHardware: hwFixture,
    });

    // #1462: la sección es el punto de entrada — sin chooser global.
    expect(screen.queryByTestId('agregado-add-hardware')).toBeNull();
    expect(screen.queryByTestId('agregado-hw-chooser')).toBeNull();
    await user.click(screen.getByTestId('agregado-cajon-hardware-add-member'));

    const updater = setDraftMock.mock.calls.at(-1)![0] as (
      prev: AgregadoDraft,
    ) => AgregadoDraft;
    const next = updater(doorDraft());
    expect(next.rigidMembers).toHaveLength(1);
    expect(next.rigidMembers![0]!.source.kind).toBe('fixed');
    // Nace sin herraje: el picker lo exige — nunca catalogHardware[0].
    expect(next.rigidMembers![0]!.source.fixed?.hardwareId).toBe('');
    expect(next.rigidMembers![0]!.bomRole).toBe('separately_purchased');
  });

  it('el «+ Añadir insumo» de Por cantidad agrega la línea sin herraje ni rol (#1462)', async () => {
    const user = userEvent.setup();
    const setDraftMock = vi.fn();
    renderForm({
      editorTab: 'hardware',
      setDraft: setDraftMock as unknown as Dispatch<SetStateAction<AgregadoDraft>>,
      catalogHardware: hwFixture,
    });

    await user.click(screen.getByTestId('agregado-hw-cantidad-add'));

    const updater = setDraftMock.mock.calls.at(-1)![0] as (
      prev: AgregadoDraft,
    ) => AgregadoDraft;
    const next = updater(doorDraft());
    expect(next.hardwareLines.at(-1)!.hardwareId).toBeUndefined();
    expect(next.hardwareLines.at(-1)!.optionRole).toBe('');
  });

  it('the Del agregado level shows the member with workshop labels and the identity error', () => {
    const draft = memberDraft();
    draft.rigidMembers![0] = {
      ...draft.rigidMembers![0]!,
      source: { kind: 'fixed', fixed: { hardwareId: '' } },
      placement: {
        x: { ref: 'max', offsetMm: -10 },
        y: { ref: 'min', offsetMm: 0 },
        z: { ref: 'min', offsetMm: 0 },
      },
      bomRole: 'included_in_kit',
    };
    renderForm({ editorTab: 'hardware', draft, catalogHardware: hwFixture });

    expect(screen.getByTestId('agregado-hw-level-cajon')).toBeTruthy();
    const card = screen.getByTestId('agregado-cajon-hardware-member-0');
    expect(card.textContent).toContain('miembro-1');
    expect(card.textContent).toContain('derecha');
    expect(
      screen.getByTestId('agregado-cajon-hardware-member-0-identity-error'),
    ).toBeTruthy();
    // La sección de piezas enseña en vez de mentir (solo-herraje mixto).
    expect(screen.getByTestId('agregado-hw-level-piezas')).toBeTruthy();
  });

  it('la plantilla «Par izq/der» crea 4 miembros separados izquierda/derecha (nunca espejo) (#1462)', async () => {
    const user = userEvent.setup();
    const setDraftMock = vi.fn();
    renderForm({
      editorTab: 'hardware',
      setDraft: setDraftMock as unknown as Dispatch<SetStateAction<AgregadoDraft>>,
      catalogHardware: hwFixture,
    });

    // #1462: las plantillas viven en el menú de la sección.
    await user.click(screen.getByTestId('agregado-cajon-hardware-templates'));
    await user.click(screen.getByTestId('agregado-cajon-hardware-template-pair'));
    // DropdownMenu común: el menú se cierra al elegir (Esc/click-afuera
    // incluidos — sugerencia de review #1463).
    expect(
      screen.queryByTestId('agregado-cajon-hardware-template-pair'),
    ).toBeNull();

    const updater = setDraftMock.mock.calls.at(-1)![0] as (
      prev: AgregadoDraft,
    ) => AgregadoDraft;
    const next = updater(doorDraft());
    expect(next.rigidMembers).toHaveLength(4);
    expect(next.rigidMembers!.map((m) => m.placement.x.ref)).toEqual([
      'min',
      'max',
      'min',
      'max',
    ]);
    expect(next.rigidMembers!.map((m) => m.actorMembership)).toEqual([
      'body',
      'body',
      'actor:drawer',
      'actor:drawer',
    ]);
    expect(next.rigidMembers!.every((m) => m.source.fixed?.hardwareId === '')).toBe(
      true,
    );
  });

  it('con miembros existentes la plantilla pide confirmación primero (#1462)', async () => {
    const user = userEvent.setup();
    const setDraftMock = vi.fn();
    renderForm({
      editorTab: 'hardware',
      draft: memberDraft(),
      setDraft: setDraftMock as unknown as Dispatch<SetStateAction<AgregadoDraft>>,
      catalogHardware: hwFixture,
    });

    await user.click(screen.getByTestId('agregado-cajon-hardware-templates'));
    await user.click(screen.getByTestId('agregado-cajon-hardware-template-pair'));
    expect(
      screen.getByTestId('agregado-cajon-hardware-preset-confirm'),
    ).toBeTruthy();

    await user.click(screen.getByTestId('agregado-cajon-hardware-preset-confirm-yes'));
    const updater = setDraftMock.mock.calls.at(-1)![0] as (
      prev: AgregadoDraft,
    ) => AgregadoDraft;
    const next = updater(memberDraft());
    expect(next.rigidMembers).toHaveLength(4);
  });

  it('la plantilla «Riel centrado» arma 1 miembro con fórmula PW/2 (#1462, antes preset de Receta)', async () => {
    const user = userEvent.setup();
    const setDraftMock = vi.fn();
    renderForm({
      editorTab: 'hardware',
      setDraft: setDraftMock as unknown as Dispatch<SetStateAction<AgregadoDraft>>,
      catalogHardware: hwFixture,
    });

    await user.click(screen.getByTestId('agregado-cajon-hardware-templates'));
    await user.click(
      screen.getByTestId('agregado-cajon-hardware-template-center-rail'),
    );

    const updater = setDraftMock.mock.calls.at(-1)![0] as (
      prev: AgregadoDraft,
    ) => AgregadoDraft;
    const next = updater(doorDraft());
    expect(next.rigidMembers).toHaveLength(1);
    expect(next.rigidMembers![0]).toMatchObject({
      memberId: 'rail_center',
      actorMembership: 'body',
      placement: { x: { ref: 'min', offsetMm: 0, offsetFormula: 'PW/2' } },
    });
  });
});
