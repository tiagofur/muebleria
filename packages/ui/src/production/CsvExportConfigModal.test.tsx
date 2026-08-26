/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProductionCutRow } from '@granete/domain';
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

    expect(screen.getByTestId('csv-modal')).toBeTruthy();
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

  it('exposes role=dialog with resolvable aria-labelledby title', () => {
    render(
      <CsvExportConfigModal isOpen={true} onClose={vi.fn()} cutRows={mockCutRows} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(
      'Exportar CSV Configurable',
    );
  });

  it('has an accessible name on the close button', () => {
    render(
      <CsvExportConfigModal isOpen={true} onClose={vi.fn()} cutRows={mockCutRows} />,
    );
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(
      <CsvExportConfigModal isOpen={true} onClose={handleClose} cutRows={mockCutRows} />,
    );
    await user.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the dialog', async () => {
    const user = userEvent.setup();
    render(
      <CsvExportConfigModal isOpen={true} onClose={vi.fn()} cutRows={mockCutRows} />,
    );
    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    }
  });

  it('returns focus to the trigger after closing', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Abrir CSV
          </button>
          <CsvExportConfigModal
            isOpen={open}
            onClose={() => setOpen(false)}
            cutRows={mockCutRows}
          />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Abrir CSV' });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(trigger);
  });
});
