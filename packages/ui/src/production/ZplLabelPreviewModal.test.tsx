/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PieceLabel } from '@muebles/domain';
import { ZplLabelPreviewModal } from './ZplLabelPreviewModal';

const mockLabels: readonly PieceLabel[] = [
  {
    partCode: 'PZA-01',
    description: 'Lateral Izquierdo',
    moduleCode: 'MOD-01',
    moduleName: 'Bajo Mesada',
    materialCode: 'MEL-18',
    materialName: 'Melamina Blanco 18mm',
    lengthMm: 720,
    widthMm: 560,
    quantity: 1,
    L1: true,
    L2: false,
    W1: false,
    W2: false,
    edgeBandingInstruction: 'L1: Canto 1mm',
  },
  {
    partCode: 'PZA-02',
    description: 'Lateral Derecho',
    moduleCode: 'MOD-01',
    moduleName: 'Bajo Mesada',
    materialCode: 'MEL-18',
    materialName: 'Melamina Blanco 18mm',
    lengthMm: 720,
    widthMm: 560,
    quantity: 1,
    L1: true,
    L2: false,
    W1: false,
    W2: false,
    edgeBandingInstruction: 'L1: Canto 1mm',
  },
];

describe('ZplLabelPreviewModal', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <ZplLabelPreviewModal isOpen={false} onClose={vi.fn()} labels={mockLabels} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal overlay and active label details when isOpen is true', () => {
    render(
      <ZplLabelPreviewModal isOpen={true} onClose={vi.fn()} labels={mockLabels} />,
    );

    expect(screen.getByTestId('zpl-modal-overlay')).toBeDefined();
    expect(screen.getByText(/Etiquetas ZPL para Impresoras Térmicas/i)).toBeDefined();
    expect(screen.getAllByText('PZA-01')[0]).toBeDefined();
    expect(screen.getAllByText('Lateral Izquierdo')[0]).toBeDefined();
    expect(screen.getByText('Pieza 1 de 2')).toBeDefined();
  });

  it('switches size presets and updates dot metrics display', () => {
    render(
      <ZplLabelPreviewModal isOpen={true} onClose={vi.fn()} labels={mockLabels} />,
    );

    const presetSelect = screen.getByTestId('zpl-preset-select') as HTMLSelectElement;
    fireEvent.change(presetSelect, { target: { value: '100x150' } });
    expect(presetSelect.value).toBe('100x150');
    expect(screen.getByText(/100x150 mm @ 203 DPI/i)).toBeDefined();
  });

  it('navigates between piece labels using next and previous buttons', () => {
    render(
      <ZplLabelPreviewModal isOpen={true} onClose={vi.fn()} labels={mockLabels} />,
    );

    const nextBtn = screen.getByTestId('zpl-next-btn');
    fireEvent.click(nextBtn);

    expect(screen.getAllByText('PZA-02')[0]).toBeDefined();
    expect(screen.getAllByText('Lateral Derecho')[0]).toBeDefined();
    expect(screen.getByText('Pieza 2 de 2')).toBeDefined();
  });

  it('toggles raw ZPL code view', () => {
    render(
      <ZplLabelPreviewModal isOpen={true} onClose={vi.fn()} labels={mockLabels} />,
    );

    const toggleBtn = screen.getByTestId('zpl-toggle-code');
    fireEvent.click(toggleBtn);

    expect(screen.getByTestId('zpl-code-view')).toBeDefined();
    expect(screen.getByText(/^\^XA/)).toBeDefined();
  });

  it('calls onDownloadZpl or triggers download when download button is clicked', () => {
    const handleDownload = vi.fn();
    render(
      <ZplLabelPreviewModal
        isOpen={true}
        onClose={vi.fn()}
        labels={mockLabels}
        onDownloadZpl={handleDownload}
      />,
    );

    const downloadBtn = screen.getByTestId('zpl-download-btn');
    fireEvent.click(downloadBtn);

    expect(handleDownload).toHaveBeenCalledTimes(1);
    expect(handleDownload.mock.calls[0]?.[0]).toContain('^XA');
  });
});
