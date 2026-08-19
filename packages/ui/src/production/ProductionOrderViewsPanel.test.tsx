/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Project } from '@muebles/domain';

vi.mock('../projects/components/PresentationKitchenPlanSlide', () => ({
  PresentationKitchenPlanSlide: () => <div data-testid="kitchen-plan" />,
}));
vi.mock('./ProductionElevationPreview', () => ({
  ProductionElevationPreview: () => <div data-testid="elevation-preview" />,
}));
vi.mock('../preview3d/FurnitureScene3D', () => ({
  FurnitureScene3D: () => <div data-testid="scene-3d" />,
}));

import { ProductionOrderViewsPanel } from './ProductionOrderViewsPanel';

const project: Project = {
  id: 'p1', name: 'Cocina Ana', customerId: 'c1', currency: 'MXN',
  marginFactor: 1.35, laborFixedCost: 0, status: 'accepted', items: [],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

afterEach(cleanup);

describe('ProductionOrderViewsPanel F101 page chrome migration', () => {
  it('owns the only visible panel primary action in the shared header', () => {
    const onExportElevations = vi.fn();
    render(
      <ProductionOrderViewsPanel
        project={project}
        modules={[]}
        catalog={{ modules: [], structures: [], components: [], materials: [], edges: [], hardware: [], optionGroups: [] }}
        onExportElevations={onExportElevations}
      />,
    );
    const header = screen.getByTestId('page-header');
    expect(within(header).getByRole('heading', { level: 3, name: 'Vistas de producción' })).toBeTruthy();
    const secondarySlot = header.querySelector('.page-header__secondary-actions');
    expect(secondarySlot).not.toBeNull();
    const action = within(secondarySlot as HTMLElement).getByRole('button', { name: 'Descargar PDF elevaciones' });
    expect((action as HTMLButtonElement).disabled).toBe(true);
    expect(action.getAttribute('title')).toBe('Sin muros en el layout');
    expect(screen.queryAllByRole('button', { name: 'Descargar PDF elevaciones' })).toHaveLength(1);
    expect(action.className).toBe('btn');
    expect(header.querySelector('.page-header__primary-action')).toBeNull();
  });
});
