/**
 * F104 — Page chrome composition: catalogs + option groups render through the
 * shared PageHeader/PageToolbar skeleton (docs/design.md §4.1a).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { MaterialBoard } from '@muebles/domain';
import { MaterialsCatalog } from './materials/MaterialsCatalog';
import { EdgesCatalog } from './EdgesCatalog';
import { HardwareCatalog } from './HardwareCatalog';
import { AmbientMaterialsCatalog } from './AmbientMaterialsCatalog';
import { OptionGroupsScreen } from '../optionGroups/OptionGroupsScreen';

afterEach(cleanup);

/** Asserts the shared header contract: h2 title, area icon-chip, one primary. */
function expectSharedHeader(title: string, primaryLabel?: string): void {
  const header = screen.getByTestId('page-header');
  expect(
    within(header).getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
  ).toEqual([title]);
  const icon = header.querySelector('.page-header__icon');
  expect(icon).not.toBeNull();
  expect(icon?.querySelector('svg')).not.toBeNull();
  const primaries = header.querySelectorAll('.btn--primary');
  if (primaryLabel) {
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(primaryLabel);
  } else {
    expect(primaries).toHaveLength(0);
  }
}

describe('F104 page chrome — catalogs', () => {
  it('Materiales renders header with icon-chip, single primary and toolbar when list has items', () => {
    const material: MaterialBoard = {
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
    render(
      <MaterialsCatalog
        materials={[material]}
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        onCreateEdge={vi.fn(() => 'edge-new')}
        getCostPerM2={() => 25}
      />,
    );
    expectSharedHeader('Materiales', 'Nuevo material');
    const toolbar = screen.getByTestId('page-toolbar');
    expect(within(toolbar).getByRole('searchbox')).toBeDefined();
    // No local header vocabulary remains on migrated screens.
    expect(document.querySelector('.catalog-page__header')).toBeNull();
    expect(document.querySelector('.catalog-page__title')).toBeNull();
  });

  it('Materiales hides the toolbar when the catalog is truly empty', () => {
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
    expectSharedHeader('Materiales', 'Nuevo material');
    expect(screen.queryByTestId('page-toolbar')).toBeNull();
  });

  it('Cantos renders the shared header', () => {
    render(
      <EdgesCatalog
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    expectSharedHeader('Cantos', 'Nuevo canto');
  });

  it('Herrajes renders the shared header', () => {
    render(
      <HardwareCatalog
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    expectSharedHeader('Herrajes', 'Nuevo herraje');
  });

  it('Acabados renders the shared header with nav label as title', () => {
    render(
      <AmbientMaterialsCatalog
        materials={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    // §4.1b: header title must match the nav label ("Acabados").
    expectSharedHeader('Acabados', 'Nuevo acabado');
  });

  it('Grupos renders the shared header', () => {
    render(
      <OptionGroupsScreen
        optionGroups={[]}
        materials={[]}
        edges={[]}
        hardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expectSharedHeader('Grupos', 'Nuevo grupo');
  });

  it('read-only catalogs (canMutate=false) keep the header without primary', () => {
    render(
      <EdgesCatalog
        edges={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
        canMutate={false}
      />,
    );
    expectSharedHeader('Cantos');
  });
});
