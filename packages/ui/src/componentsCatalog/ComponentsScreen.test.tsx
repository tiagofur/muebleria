/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { FurnitureComponent, OptionGroup } from '@muebles/domain';
import { ComponentsScreen } from './ComponentsScreen';

const groups: OptionGroup[] = [
  {
    id: 'g1',
    code: 'FRENTE',
    name: 'Frente',
    kind: 'board',
    required: true,
    optionIds: ['mat-1'],
  },
];

const sample: FurnitureComponent = {
  id: 'c1',
  code: 'COMP-PUERTA-01',
  name: 'Puerta simple',
  kind: 'puerta',
  boardParts: [
    {
      id: 'p1',
      description: 'Puerta',
      quantity: 1,
      lengthMm: 700,
      widthMm: 400,
      edges: [
        { side: 'L1', enabled: false },
        { side: 'L2', enabled: false },
        { side: 'W1', enabled: false },
        { side: 'W2', enabled: false },
      ],
      optionRole: 'FRENTE',
    },
  ],
  hardwareLines: [],
  active: true,
};

describe('ComponentsScreen (H06/H08)', () => {
  it('lists components and exposes create action', () => {
    render(
      <ComponentsScreen
        components={[sample]}
        optionGroups={groups}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    expect(screen.getByTestId('components-screen')).toBeTruthy();
    expect(screen.getByTestId('component-card-c1')).toBeTruthy();
    expect(screen.getByTestId('component-create')).toBeTruthy();
  });
});
