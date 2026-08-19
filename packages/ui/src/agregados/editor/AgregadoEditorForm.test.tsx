/**
 * Tests for AgregadoEditorForm: live 3D preview wiring (Fase 3 UI) and the
 * General tab workspace (summary aside + dims readout + tab shortcuts).
 * @vitest-environment jsdom
 */

import type { FormEvent, Dispatch, SetStateAction } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component, Hardware } from '@muebles/domain';
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
}: {
  readonly catalogInput?: Module3DCatalogInput;
  readonly editorTab?: AgregadoEditorTab;
  readonly draft?: AgregadoDraft;
  readonly onSetEditorTab?: Dispatch<SetStateAction<AgregadoEditorTab>>;
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
      setDraft={vi.fn() as Dispatch<SetStateAction<AgregadoDraft>>}
      editingId={null}
      catalogComponents={[mockComponent]}
      catalogHardware={[] as unknown as readonly Hardware[]}
      catalogInput={catalogInput}
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

  it('reflects combined bulk and positioned hardware in the Herrajes tab badge and general summary', () => {
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

    // Herrajes tab button badge should display 2 (1 bulk + 1 positioned)
    const hwTab = screen.getByTestId('agregado-editor-tab-hardware');
    expect(hwTab.textContent).toContain('2');

    // General summary count should also display 2
    expect(
      screen.getByTestId('agregado-general-count-hardware').textContent,
    ).toBe('2');
  });
});
