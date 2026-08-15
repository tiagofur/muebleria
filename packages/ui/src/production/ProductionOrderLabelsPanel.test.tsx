/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PieceLabel, Project } from '@muebles/domain';
import { ProductionOrderLabelsPanel } from './ProductionOrderLabelsPanel';
import {
  readLabelPrinterSettings,
  writeLabelPrinterSettings,
} from './labelPrinterSettings';

function projectFixture(): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [{ id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function label(overrides: Partial<PieceLabel> = {}): PieceLabel {
  return {
    moduleCode: 'GAB-01',
    moduleName: 'Gabinete',
    partCode: 'LAT',
    description: 'Lateral',
    quantity: 2,
    lengthMm: 720,
    widthMm: 560,
    materialCode: 'MAT-BLA',
    materialName: 'Melamina Blanca',
    L1: true,
    L2: false,
    W1: false,
    W2: true,
    edgeBandCode: 'CANT-ABS-BLA',
    edgeBandName: 'ABS Blanco 1 mm',
    edgeBandingInstruction: 'Encintar L1 y W2 con ABS Blanco 1 mm',
    ...overrides,
  };
}

const LABELS: readonly PieceLabel[] = [
  label(),
  label({
    moduleCode: 'CAJ-01',
    moduleName: 'Cajonera',
    partCode: 'FRN',
    description: 'Frente',
    quantity: 3,
    materialName: 'Roble',
    materialCode: 'MAT-ROB',
  }),
];

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

afterEach(() => {
  cleanup();
  localStorageMock.clear();
});

describe('ProductionOrderLabelsPanel', () => {
  it('renders the list and ZPL download with the full scope by default', () => {
    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={vi.fn()}
      />,
    );
    expect(screen.getByTestId('prod-hub-etiquetas')).toBeTruthy();
    expect(screen.getByTestId('prod-labels-count').textContent).toContain(
      '2 etiquetas',
    );
    expect(screen.getByTestId('prod-labels-download-zpl').textContent).toContain(
      '(2)',
    );
  });

  it('filters by module and material, and searches by code', async () => {
    const user = userEvent.setup();
    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByTestId('prod-labels-module-filter'),
      'CAJ-01',
    );
    expect(screen.getByTestId('prod-labels-count').textContent).toContain(
      '1 etiqueta',
    );

    await user.selectOptions(
      screen.getByTestId('prod-labels-module-filter'),
      'all',
    );
    await user.selectOptions(
      screen.getByTestId('prod-labels-material-filter'),
      'Roble',
    );
    expect(screen.getByTestId('prod-labels-count').textContent).toContain(
      '1 etiqueta',
    );

    await user.selectOptions(
      screen.getByTestId('prod-labels-material-filter'),
      'all',
    );
    await user.type(screen.getByTestId('prod-labels-search'), 'FRN');
    expect(screen.getByTestId('prod-labels-count').textContent).toContain(
      '1 etiqueta',
    );
  });

  it('per-unit mode multiplies copies by quantity', async () => {
    const user = userEvent.setup();
    const onDownloadZpl = vi.fn();
    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={vi.fn()}
        onDownloadZpl={onDownloadZpl}
      />,
    );

    await user.click(screen.getByTestId('prod-labels-per-unit'));
    // 2 (GAB LAT) + 3 (CAJ FRN) = 5 physical labels
    expect(screen.getByTestId('prod-labels-count').textContent).toContain(
      '5 impresiones',
    );

    await user.click(screen.getByTestId('prod-labels-download-zpl'));
    expect(onDownloadZpl).toHaveBeenCalledTimes(1);
    const [content, filename] = onDownloadZpl.mock.calls[0]!;
    expect(filename).toContain('cocina_ana');
    expect(filename).toContain('por_unidad');
    // 5 labels = 5 ^XA blocks
    expect(content.match(/\^XA/g)?.length).toBe(5);
  });

  it('ZPL batch carries the project id and edge info in the QR payload', async () => {
    const user = userEvent.setup();
    const onDownloadZpl = vi.fn();
    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={vi.fn()}
        onDownloadZpl={onDownloadZpl}
      />,
    );

    await user.click(screen.getByTestId('prod-labels-download-zpl'));
    const [content] = onDownloadZpl.mock.calls[0]!;
    const qrMatch = content.match(/\^FDMM,A(\{.*?\})\^FS/);
    expect(qrMatch).toBeTruthy();
    const payload = JSON.parse(qrMatch![1]!);
    expect(payload.v).toBe(2);
    expect(payload.projectId).toBe('p1');
    expect(payload.qty).toBe(2);
    expect(payload.edges).toBe('L1+W2');
    expect(payload.edge).toBe('CANT-ABS-BLA');
  });

  it('PDF button exports the scoped labels with the copy mode', async () => {
    const user = userEvent.setup();
    const onExportPdf = vi.fn();
    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={onExportPdf}
      />,
    );

    await user.selectOptions(
      screen.getByTestId('prod-labels-module-filter'),
      'CAJ-01',
    );
    await user.click(screen.getByTestId('prod-labels-per-unit'));
    await user.click(screen.getByTestId('prod-labels-download-pdf'));

    expect(onExportPdf).toHaveBeenCalledTimes(1);
    const [exported, perUnit] = onExportPdf.mock.calls[0]!;
    expect(exported).toHaveLength(1);
    expect(exported[0]!.moduleCode).toBe('CAJ-01');
    expect(perUnit).toBe(true);
  });

  it('persists printer settings and restores them on next mount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByTestId('prod-labels-preset'),
      '50x25',
    );
    await user.selectOptions(screen.getByTestId('prod-labels-dpi'), '300');
    unmount();

    expect(readLabelPrinterSettings()).toEqual({
      preset: '50x25',
      dpi: 300,
      includeBorder: true,
      printerName: '',
    });


    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={LABELS}
        onExportPdf={vi.fn()}
      />,
    );
    expect(
      (screen.getByTestId('prod-labels-preset') as HTMLSelectElement).value,
    ).toBe('50x25');
    expect(
      (screen.getByTestId('prod-labels-dpi') as HTMLSelectElement).value,
    ).toBe('300');
  });

  it('shows an error banner when labels fail to resolve', () => {
    render(
      <ProductionOrderLabelsPanel
        project={projectFixture()}
        labels={null}
        labelsError="Falta material del catálogo"
        onExportPdf={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('prod-hub-etiquetas').textContent,
    ).toContain('Falta material del catálogo');
  });

  it('printer settings helpers round-trip safely with junk data', () => {
    localStorageMock.setItem('muebles_label_printer_v1', '{not json');
    expect(readLabelPrinterSettings().preset).toBe('100x50');

    localStorageMock.setItem(
      'muebles_label_printer_v1',
      JSON.stringify({ preset: 'weird', dpi: 999 }),
    );
    const settings = readLabelPrinterSettings();
    expect(settings.preset).toBe('100x50');
    expect(settings.dpi).toBe(203);

    writeLabelPrinterSettings({ preset: '100x150', dpi: 300, includeBorder: false });
    expect(readLabelPrinterSettings()).toEqual({
      preset: '100x150',
      dpi: 300,
      includeBorder: false,
      printerName: '',
    });
  });

  it('shows raw-print controls only when the desktop bridge is present', async () => {
    const host = window as unknown as {

      electronAPI?: { printRaw?: unknown };
    };
    const render_ = () =>
      render(
        <ProductionOrderLabelsPanel
          project={projectFixture()}
          labels={LABELS}
          onExportPdf={vi.fn()}
        />,
      );

    // Web: no bridge, no print button.
    delete host.electronAPI;
    render_();
    expect(screen.queryByTestId('prod-labels-print-raw')).toBeNull();
    expect(screen.queryByTestId('prod-labels-printer-name')).toBeNull();
    cleanup();

    // Desktop: bridge present → printer name + print button + feedback.
    const printRaw = vi.fn(
      async (_printerName: string, _payload: string) => ({ ok: true }),
    );
    host.electronAPI = { printRaw };

    const user = userEvent.setup();
    render_();
    const nameInput = screen.getByTestId(
      'prod-labels-printer-name',
    ) as HTMLInputElement;
    await user.type(nameInput, 'Zebra-GK420');
    await user.click(screen.getByTestId('prod-labels-print-raw'));

    expect(printRaw).toHaveBeenCalledTimes(1);
    const [printerName, payload] = printRaw.mock.calls[0]!;
    expect(printerName).toBe('Zebra-GK420');
    expect(payload).toContain('^XA');
    expect(
      screen.getByTestId('prod-labels-print-feedback').textContent,
    ).toContain('Zebra-GK420');
    delete host.electronAPI;
  });
});
