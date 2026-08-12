/**
 * Tests for AgregadoEditorForm live 3D preview wiring (Fase 3 UI).
 * Verifies the sticky preview mounts when the catalog slice is supplied and
 * gracefully degrades (single column) when it is not.
 * @vitest-environment jsdom
 */

import type { FormEvent, Dispatch, SetStateAction } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
}: {
  readonly catalogInput?: Module3DCatalogInput;
  readonly editorTab?: AgregadoEditorTab;
}) {
  render(
    <AgregadoEditorForm
      formId="form-1"
      error={null}
      onSubmit={vi.fn() as (e: FormEvent) => void}
      editorTab={editorTab}
      setEditorTab={vi.fn() as Dispatch<SetStateAction<AgregadoEditorTab>>}
      draft={doorDraft()}
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

  it('omits the 3D preview panel when catalogInput is missing (graceful degradation)', () => {
    renderForm({ catalogInput: undefined });
    expect(screen.queryByTestId('agregado-editor-3d-preview')).toBeNull();
  });

  it('does not render the 3D preview on the General tab', () => {
    renderForm({ catalogInput: mockCatalogInput, editorTab: 'general' });
    expect(screen.queryByTestId('agregado-editor-3d-preview')).toBeNull();
  });
});
