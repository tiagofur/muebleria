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
});
