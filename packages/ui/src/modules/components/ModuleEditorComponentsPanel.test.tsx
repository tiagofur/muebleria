/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Component } from '@granete/domain';
import { emptyModuleDraft, type ModuleDraft } from '../moduleHelpers';
import { ModuleEditorComponentsPanel } from './ModuleEditorComponentsPanel';

afterEach(() => {
  cleanup();
});

const mockComponent: Component = {
  id: 'comp-door-1',
  code: 'CMP-DOOR',
  name: 'Puerta batiente',
  placement: 'puerta',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 700,
    widthMm: 400,
    thicknessMm: 18,
  },
  defaultEdges: [],
  optionRoles: [],
  active: true,
};

const initialDraft: ModuleDraft = {
  ...emptyModuleDraft(),
  code: 'MOD-01',
  name: 'Módulo Base',
  structureId: 'struct-1',
  components: [
    {
      componentId: 'comp-door-1',
      quantity: 1,
    },
  ],
};

describe('ModuleEditorComponentsPanel', () => {
  it('renders components and duplicates instance when clicking duplicate button', async () => {
    const user = userEvent.setup();
    let currentDraft = initialDraft;
    const setDraft = vi.fn((updater) => {
      currentDraft = typeof updater === 'function' ? updater(currentDraft) : updater;
    });

    render(
      <ModuleEditorComponentsPanel
        draft={currentDraft}
        setDraft={setDraft}
        catalogComponents={[mockComponent]}
        composedEnabled={true}
        onRequestAdd={vi.fn()}
        hidden={false}
      />,
    );

    expect(screen.getByTestId('component-instance-0')).toBeTruthy();
    expect(screen.getByText(/CMP-DOOR — Puerta batiente/i)).toBeTruthy();

    const dupBtn = screen.getByTestId('duplicate-component-0');
    expect(dupBtn).toBeTruthy();
    await user.click(dupBtn);

    expect(setDraft).toHaveBeenCalled();
    expect(currentDraft.components).toHaveLength(2);
    expect(currentDraft.components[0]?.componentId).toBe('comp-door-1');
    expect(currentDraft.components[1]?.componentId).toBe('comp-door-1');
  });
});
