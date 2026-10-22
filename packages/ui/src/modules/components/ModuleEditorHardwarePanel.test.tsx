/**
 * #1404 — vinculación opcional herraje ↔ componente en el panel Herrajes.
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Component, Hardware, OptionGroup } from '@granete/domain';
import { emptyModuleDraft, type ModuleDraft } from '../moduleHelpers';
import { ModuleEditorHardwarePanel } from './ModuleEditorHardwarePanel';

afterEach(() => {
  cleanup();
});

const optionGroups: OptionGroup[] = [
  {
    id: 'g3',
    code: 'BISAGRA',
    name: 'Bisagra',
    kind: 'hardware',
    required: true,
    optionIds: ['hw-1'],
  },
];

const hardware: Hardware[] = [
  {
    id: 'hw-1',
    code: 'HW-01',
    name: 'Bisagra 35',
    unit: 'piece',
    costPerUnit: 10,
    active: true,
  },
];

const catalogComponents: Component[] = [
  {
    id: 'comp-ent',
    code: 'COM-ENT',
    name: 'Entrepaño',
    placement: 'interno',
    geometry: {
      kind: 'rectangular_board',
      lengthMm: 560,
      widthMm: 560,
      thicknessMm: 18,
    },
    defaultEdges: [],
    optionRoles: ['INTERIOR'],
    active: true,
  },
];

function baseDraft(): ModuleDraft {
  return {
    ...emptyModuleDraft(),
    hardwareLines: [
      {
        id: 'hl1',
        quantity: 4,
        descriptionOverride: '',
        mode: 'role',
        optionRole: 'BISAGRA',
        hardwareId: '',
        componentId: '',
      },
    ],
  };
}

type Setup = {
  readonly onUpdate: ReturnType<typeof vi.fn>;
};

function setup(draft: ModuleDraft = baseDraft()): Setup {
  const onUpdate = vi.fn();
  render(
    <ModuleEditorHardwarePanel
      hardwareLines={draft.hardwareLines}
      hardwareRoles={optionGroups}
      activeHardware={hardware}
      catalogComponents={catalogComponents}
      onAdd={vi.fn()}
      onRemove={vi.fn()}
      onUpdate={onUpdate}
      onGridKeyDown={vi.fn()}
      hidden={false}
    />,
  );
  return { onUpdate };
}

async function pickComponent(optionName: RegExp): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Componente (opcional)'));
  await user.click(screen.getByRole('option', { name: optionName }));
}

describe('ModuleEditorHardwarePanel — vínculo con componente (#1404)', () => {
  it('muestra el hint de escalado ×N y el placeholder sin vínculo', () => {
    setup();
    const hint = screen.getByTestId('module-hardware-component-hint');
    expect(hint.textContent).toMatch(/escala ×N con las copias/);
    expect(hint.textContent).toMatch(/soportes de entrepaño/);
    expect(
      screen.getByLabelText('Componente (opcional)').textContent,
    ).toContain('Sin componente (no escala)');
  });

  it('vincular: elegir un componente llama onUpdate con su componentId', async () => {
    const { onUpdate } = setup();
    await pickComponent(/COM-ENT — Entrepaño/);
    expect(onUpdate).toHaveBeenCalledWith('hl1', {
      componentId: 'comp-ent',
    });
  });

  it('desvincular: Quitar selección vuelve el vínculo a vacío', async () => {
    const user = userEvent.setup();
    const draft = baseDraft();
    draft.hardwareLines = [
      { ...draft.hardwareLines[0]!, componentId: 'comp-ent' },
    ];
    const { onUpdate } = setup(draft);

    const trigger = screen.getByLabelText('Componente (opcional)');
    expect(trigger.textContent).toContain('COM-ENT — Entrepaño');
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Quitar selección' }));
    expect(onUpdate).toHaveBeenCalledWith('hl1', { componentId: '' });
  });
});
