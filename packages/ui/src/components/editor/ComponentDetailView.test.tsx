/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component } from '@granete/domain';
import { ComponentDetailView } from './ComponentDetailView';

const mockComponent: Component = {
  id: 'comp-1',
  code: 'COM-PUE-01',
  name: 'Puerta',
  placement: 'puerta',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 717,
    widthMm: 296,
    thicknessMm: 18,
  },
  defaultEdges: [
    { side: 'L1', enabled: true },
    { side: 'L2', enabled: true },
    { side: 'W1', enabled: true },
    { side: 'W2', enabled: true },
  ],
  optionRoles: ['FRENTE'],
  active: true,
};

describe('ComponentDetailView — Duplicar (C3 #1019)', () => {
  afterEach(() => {
    cleanup();
  });

  it('offers Duplicar in the Más menu and forwards the id', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    render(
      <ComponentDetailView
        component={mockComponent}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onToggleActive={vi.fn()}
        onDuplicate={onDuplicate}
        canMutate={true}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    await user.click(screen.getByRole('menuitem', { name: /Duplicar/i }));
    expect(onDuplicate).toHaveBeenCalledWith('comp-1');
  });

  it('hides the Más overflow when onDuplicate is not wired', () => {
    render(
      <ComponentDetailView
        component={mockComponent}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Más$/i })).toBeNull();
  });
});
