/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductionCutRow } from '@muebles/domain';
import { CsvExportConfigModal } from './CsvExportConfigModal';

const mockCutRows: readonly ProductionCutRow[] = [
  {
    quantity: 2,
    lengthMm: 1200,
    widthMm: 600,
    description: 'P001 · Lateral · MOD-01',
    partName: 'Lateral',
    partCode: 'P001',
    moduleCode: 'MOD-01',
    materialName: 'Melamina 18mm',
    grain: 1,
    L1: 1,
    L2: 0,
    W1: 0,
    W2: 0,
  },
];

afterEach(() => cleanup());

describe('CsvExportConfigModal', () => {
  it('renders modal with options and preview text', () => {
    render(
      <CsvExportConfigModal
        isOpen={true}
        onClose={vi.fn()}
        cutRows={mockCutRows}
        projectName="Cocina"
      />,
    );

    expect(screen.getByTestId('csv-modal-overlay')).toBeTruthy();
    expect(screen.getByTestId('csv-preset-select')).toBeTruthy();
    expect(screen.getByTestId('csv-preview-text').textContent).toContain('piece_code;module_code;material');
  });

  it('updates preview when preset is changed to Lepton', async () => {
    const user = userEvent.setup();
    render(
      <CsvExportConfigModal
        isOpen={true}
        onClose={vi.fn()}
        cutRows={mockCutRows}
      />,
    );

    await user.selectOptions(screen.getByTestId('csv-preset-select'), 'lepton');
    expect(screen.getByTestId('csv-preview-text').textContent).toContain('CODIGO;CANTIDAD;LARGO;ANCHO');
  });

  it('triggers download callback with generated CSV and filename', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(
      <CsvExportConfigModal
        isOpen={true}
        onClose={vi.fn()}
        cutRows={mockCutRows}
        projectName="Casa"
        onDownloadCsv={onDownload}
      />,
    );

    await user.click(screen.getByTestId('csv-download-btn'));
    expect(onDownload).toHaveBeenCalledWith(
      expect.stringContaining('piece_code;module_code'),
      'plan_corte_casa_standard.csv',
    );
  });
});
