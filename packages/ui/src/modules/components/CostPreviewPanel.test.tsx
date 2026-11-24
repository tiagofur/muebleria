/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CostPreviewPanel } from './CostPreviewPanel';

afterEach(() => {
  cleanup();
});

describe('CostPreviewPanel (F087 follow-up)', () => {
  it('shows the honest domain error behind a blocked preview', () => {
    render(
      <CostPreviewPanel
        costPreview={null}
        previewBlocked
        missingGroups={['ZOCLO_PERFIL']}
        groupLabels={{ ZOCLO_PERFIL: 'Zoclo perfil (ml)' }}
        previewError="Missing hardware for line m1-zoclo-perfil-auto"
      />,
    );
    expect(
      screen.getByText('Zoclo perfil (ml)'),
    ).toBeTruthy();
    expect(
      screen.getByText('Missing hardware for line m1-zoclo-perfil-auto'),
    ).toBeTruthy();
  });

  it('blocked without missing groups nor error stays clean', () => {
    render(
      <CostPreviewPanel costPreview={null} previewBlocked missingGroups={[]} />,
    );
    expect(
      screen.getByText(/Preview bloqueado: faltan grupos o no se pudo calcular/),
    ).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('#1579: muestra los avisos del motor junto al costo, y nada cuando no hay', () => {
    const breakdown = {
      materialsCost: 10,
      edgeTotal: 1,
      hardwareTotal: 340,
      directCost: 351,
      laborModular: 0,
      laborFixedCost: 0,
      marginFactor: 1.35,
      salePrice: 474,
    };
    const notice =
      'La puerta mide 2600 mm: supera la última banda de la tabla (2400 mm). Se aplican 5 bisagras por puerta.';

    render(
      <CostPreviewPanel
        costPreview={{ ...breakdown, notices: [notice] }}
        previewBlocked={false}
        missingGroups={[]}
      />,
    );
    // El aviso informa, no bloquea: el costo y el precio de venta siguen ahí.
    expect(screen.getByText(notice)).toBeTruthy();
    expect(screen.getByTestId('module-cost-preview-notices')).toBeTruthy();
    expect(screen.getByText(/Precio de venta:/)).toBeTruthy();
    cleanup();

    render(
      <CostPreviewPanel costPreview={breakdown} previewBlocked={false} missingGroups={[]} />,
    );
    expect(screen.queryByTestId('module-cost-preview-notices')).toBeNull();
    expect(screen.queryByText(/La puerta mide/)).toBeNull();
  });
});
