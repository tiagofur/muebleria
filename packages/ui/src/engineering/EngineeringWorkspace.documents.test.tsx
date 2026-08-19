/**
 * @vitest-environment jsdom
 *
 * Documentos tab of the engineering workspace (moved from the production hub
 * by the Hub trim, 2211e2c): CTAs are honest — "Ver tab" navigates to the
 * despiece tab, "Ir a Etiquetas" opens the labels tab.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductionCutRow, Project } from '@muebles/domain';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

import { EngineeringWorkspace } from './EngineeringWorkspace';

function makeProject(): Project {
  return {
    id: 'p1',
    name: 'Cocina López',
    customerId: 'c1',
    status: 'accepted',
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items: [],
  } as unknown as Project;
}

const pieceLabel = {
  moduleCode: 'GAB-01',
  moduleName: 'Gabinete',
  partCode: 'LAT',
  description: 'Lateral',
  quantity: 1,
  lengthMm: 720,
  widthMm: 560,
  materialCode: 'MAT-BLA',
  materialName: 'Blanco',
  L1: false,
  L2: false,
  W1: false,
  W2: false,
  edgeBandingInstruction: 'Sin encintar',
};

const cutRow: ProductionCutRow = {
  quantity: 1,
  lengthMm: 720,
  widthMm: 560,
  description: 'Lateral',
  materialName: 'Blanco',
  grain: 0,
  L1: 0,
  L2: 0,
  W1: 0,
  W2: 0,
};

const baseProps = {
  project: makeProject(),
  modules: [],
  catalog: null,
  cutRows: [cutRow],
  labels: [pieceLabel],
  moduleLabels: [],
  hardwareRows: [],
  readiness: {
    cutListOk: true,
    cutListError: null,
    cutRowCount: 1,
    moduleUnitCount: 1,
    moduleLineCount: 1,
    materialsResolved: true,
    hasKitchenLayout: false,
    hasPlacements: false,
    layoutCheckOk: true,
    optimizerGenerable: true,
    packGenerable: true,
    readyToCut: true,
    hasUnplacedItems: false,
  } satisfies ProductionOrderReadiness,
  onBack: () => undefined,
};

afterEach(() => cleanup());

describe('EngineeringWorkspace — Documentos (Hub trim)', () => {
  it('uses the shared peer-workspace tab family with ARIA linkage', () => {
    render(<EngineeringWorkspace {...baseProps} />);
    const tablist = screen.getByTestId('eng-tablist');
    const summary = screen.getByTestId('eng-tab-resumen');
    const modules = screen.getByTestId('eng-tab-modulos');
    expect(tablist.className).toContain('tabs--workspace');
    expect(summary.getAttribute('aria-controls')).toBe('eng-panel-resumen');
    expect(summary.getAttribute('tabindex')).toBe('0');
    expect(modules.getAttribute('tabindex')).toBe('-1');
  });

  it('moves engineering peer selection with roving keyboard keys and keeps controls valid', async () => {
    const user = userEvent.setup();
    render(<EngineeringWorkspace {...baseProps} />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).toBeTruthy();
    }
    const summary = screen.getByTestId('eng-tab-resumen');
    summary.focus();
    await user.keyboard('{End}');
    expect(screen.getByTestId('eng-tab-documentos').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Home}{ArrowRight}');
    expect(screen.getByTestId('eng-tab-modulos').getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById('eng-panel-modulos')?.getAttribute('aria-labelledby')).toBe('eng-tab-modulos');
  });

  it('despiece doc says "Ver tab" and navigates to the despiece tab', async () => {
    const user = userEvent.setup();
    render(<EngineeringWorkspace {...baseProps} />);

    await user.click(screen.getByRole('tab', { name: 'Documentos' }));
    const despieceBtn = screen.getByTestId('prod-doc-despiece');
    expect(despieceBtn.textContent).toContain('Ver tab');

    await user.click(despieceBtn);
    expect(screen.getByTestId('prod-hub-despiece')).toBeTruthy();
  });

  it('ZPL doc says "Ir a Etiquetas" and navigates to the labels tab', async () => {
    const user = userEvent.setup();
    render(<EngineeringWorkspace {...baseProps} />);

    await user.click(screen.getByRole('tab', { name: 'Documentos' }));
    const zplBtn = screen.getByTestId('prod-doc-labels-zpl');
    expect(zplBtn.textContent).toContain('Ir a Etiquetas');

    await user.click(zplBtn);
    expect(screen.getByTestId('prod-hub-etiquetas')).toBeTruthy();
  });

  it('keeps the despiece document gated by resolved materials', async () => {
    const user = userEvent.setup();
    render(
      <EngineeringWorkspace
        {...baseProps}
        readiness={{
          ...baseProps.readiness,
          materialsResolved: false,
        }}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Documentos' }));
    const despieceBtn = screen.getByTestId('prod-doc-despiece');
    expect(despieceBtn.hasAttribute('disabled')).toBe(true);
    // The reason is shown as hint text inside the same doc item.
    const item = despieceBtn.closest('li');
    expect(item?.textContent).toContain('Sin piezas de tablero');
  });

  it('wires the despiece download handler without a tab hop', async () => {
    const user = userEvent.setup();
    const onExportDespiecePdf = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps}
        onExportDespiecePdf={onExportDespiecePdf}
      />,
    );

    await user.click(screen.getByRole('tab', { name: 'Despiece' }));
    await user.click(screen.getByText('Imprimir A4'));
    expect(onExportDespiecePdf).toHaveBeenCalledTimes(1);
  });
});
