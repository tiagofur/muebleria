/**
 * Materials catalog — create handoff + smoke.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

describe('MaterialsCatalog create handoff (#33)', () => {
  it('opens create modal when requestCreateKey bumps', async () => {
    const { rerender } = render(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
        requestCreateKey={0}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <MaterialsCatalog
        materials={[sampleMaterial]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
        requestCreateKey={1}
      />,
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
