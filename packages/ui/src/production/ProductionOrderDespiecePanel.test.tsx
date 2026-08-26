/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductionCutRow } from '@granete/domain';
import { ProductionOrderDespiecePanel } from './ProductionOrderDespiecePanel';

afterEach(() => cleanup());

const mockCutRows: readonly ProductionCutRow[] = [
  {
    quantity: 2,
    lengthMm: 720,
    widthMm: 560,
    description: 'MOD-GAB-01-P01 · Costado · MOD-GAB-01',
    materialName: 'Blanco 18mm',
    grain: 0,
    L1: 1,
    L2: 0,
    W1: 0,
    W2: 0,
    partName: 'Costado',
    partCode: 'P01',
    moduleCode: 'MOD-GAB-01',
    labelRef: 'P01',
    thicknessMm: 18,
    edgeBandCode: 'CAN-BLA-045',
    edgeBandName: 'Canto Blanco',
    edgeBandThicknessMm: 0.45,
  },
  {
    quantity: 1,
    lengthMm: 700,
    widthMm: 450,
    description: 'MOD-GAB-01-P02 · Puerta Frente · MOD-GAB-01',
    materialName: 'Roble 18mm',
    grain: 1,
    L1: 1,
    L2: 1,
    W1: 1,
    W2: 1,
    partName: 'Puerta Frente',
    partCode: 'P02',
    moduleCode: 'MOD-GAB-01',
    labelRef: 'P02',
    thicknessMm: 18,
    edgeBandCode: 'CAN-ROB-200',
    edgeBandName: 'Canto Roble 2mm',
    edgeBandThicknessMm: 2,
  },
];

describe('ProductionOrderDespiecePanel (PROD-1.3)', () => {
  it('renders table with thickness, material and assigned edge bands', () => {
    render(<ProductionOrderDespiecePanel cutRows={mockCutRows} />);

    expect(screen.getByTestId('prod-hub-despiece')).toBeTruthy();
    expect(screen.getAllByTestId('prod-despiece-table').length).toBeGreaterThan(0);
    expect(screen.getAllByText('18 mm').length).toBeGreaterThan(0);
    expect(screen.getByText('Canto Blanco (0.45mm)')).toBeTruthy();
    expect(screen.getByText('Canto Roble 2mm (2mm)')).toBeTruthy();
    expect(screen.getByText('L1')).toBeTruthy();
    expect(screen.getByText('L1+L2+W1+W2')).toBeTruthy();
  });

  it('filters by "Solo frentes" checkbox', async () => {
    const user = userEvent.setup();
    render(<ProductionOrderDespiecePanel cutRows={mockCutRows} />);

    expect(screen.getByText('2 líneas')).toBeTruthy();
    expect(screen.getByText(/Costado/)).toBeTruthy();
    expect(screen.getByText(/Puerta Frente/)).toBeTruthy();

    const frontFilter = screen.getByTestId('prod-despiece-filter-fronts');
    await user.click(frontFilter);

    expect(screen.getByText('1 línea')).toBeTruthy();
    expect(screen.queryByText(/Costado/)).toBeNull();
    expect(screen.getByText(/Puerta Frente/)).toBeTruthy();
  });

  it('filters by search query', async () => {
    const user = userEvent.setup();
    render(<ProductionOrderDespiecePanel cutRows={mockCutRows} />);

    const searchInput = screen.getByTestId('prod-despiece-search');
    await user.type(searchInput, 'Roble');

    expect(screen.getByText('1 línea')).toBeTruthy();
    expect(screen.queryByText(/Costado/)).toBeNull();
    expect(screen.getByText(/Puerta Frente/)).toBeTruthy();
  });

  it('switches grouping to module and none (lista)', async () => {
    const user = userEvent.setup();
    render(<ProductionOrderDespiecePanel cutRows={mockCutRows} />);

    await user.click(screen.getByTestId('prod-despiece-tab-module'));
    expect(screen.getByText('MOD-GAB-01')).toBeTruthy();

    await user.click(screen.getByTestId('prod-despiece-tab-none'));
    expect(screen.getByTestId('prod-despiece-table')).toBeTruthy();
  });
});

describe('ProductionOrderDespiecePanel tablist contract (F109)', () => {
  it('exposes workflow tablist with panel linkage and arrow-key roving', async () => {
    const user = userEvent.setup();
    render(<ProductionOrderDespiecePanel cutRows={mockCutRows} />);
    const tablist = screen.getByTestId('prod-despiece-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');
    expect(tablist.className).toContain('tabs--workflow');

    const material = screen.getByTestId('prod-despiece-tab-material');
    const mod = screen.getByTestId('prod-despiece-tab-module');
    expect(material.getAttribute('aria-controls')).toBe('prod-despiece-panel-material');
    expect(mod.getAttribute('aria-controls')).toBe('prod-despiece-panel-module');
    expect(
      document.getElementById('prod-despiece-panel-material')?.getAttribute('role'),
    ).toBe('tabpanel');

    material.focus();
    await user.keyboard('{ArrowRight}');
    expect(mod.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(mod);
    expect(document.getElementById('prod-despiece-panel-module')).toBeTruthy();
  });
});
