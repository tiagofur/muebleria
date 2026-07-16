/**
 * Materials catalog — empty vs no-results smoke (#32).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MaterialBoard } from '@muebles/domain';
import { MaterialsCatalog } from './MaterialsCatalog';

afterEach(() => cleanup());

const sampleMaterial: MaterialBoard = {
  id: 'mat-1',
  code: 'MAT-01',
  name: 'Melamina blanca 15',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 15,
  grainDefault: false,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 25,
  active: true,
};

describe('MaterialsCatalog empty states (#32)', () => {
  it('shows EmptyState when catalog is truly empty', () => {
    render(
      <MaterialsCatalog
        materials={[]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 0}
      />,
    );
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No hay materiales')).toBeTruthy();
    expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
  });

  it('shows no-results and Limpiar filtros restores search + status', async () => {
    const user = userEvent.setup();
    render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );

    expect(screen.getByText('MAT-01')).toBeTruthy();
    await user.type(
      screen.getByLabelText(/Buscar materiales/i),
      'zzzz-no-match',
    );
    await waitFor(() => {
      expect(screen.getByTestId('empty-state-no-results')).toBeTruthy();
    });
    expect(screen.getByText('Sin resultados')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Limpiar filtros/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('empty-state-no-results')).toBeNull();
    });
    expect(screen.getByText('MAT-01')).toBeTruthy();
    expect(
      (screen.getByLabelText(/Buscar materiales/i) as HTMLInputElement).value,
    ).toBe('');
  });
});
