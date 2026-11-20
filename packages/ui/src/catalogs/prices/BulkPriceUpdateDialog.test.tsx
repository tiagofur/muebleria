// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BulkPriceUpdateDialog, type PriceListReader } from './BulkPriceUpdateDialog';

const ITEM = 'a1000000-0000-4000-8000-000000001651';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const previewBody = {
  kind: 'material',
  changed: [{ id: ITEM, code: 'MEL-18', name: 'Melamina 18', currentPrice: 1000, newPrice: 1100, version: 3 }],
  unchanged: [],
  notFound: [{ line: 4, code: 'NUEVO', message: 'código inexistente en el catálogo' }],
  invalid: [{ line: 5, message: 'fila sin código' }],
};

const reader: PriceListReader = {
  read: vi.fn(async () => ({
    headers: ['Código', 'Descripción', 'Precio'],
    rows: [
      { line: 2, cells: ['MEL-18', 'Melamina', '1.100,00'] },
      { line: 4, cells: ['NUEVO', 'x', '5'] },
      { line: 5, cells: ['', 'y', '7'] },
    ],
  })),
  parseNumber: (raw) => {
    const n = Number(raw.replace(/\./g, '').replace(',', '.'));
    return raw.trim() === '' || Number.isNaN(n) ? null : n;
  },
  guessColumns: () => ({ code: 0, price: 2 }),
};

function renderDialog(fetchMock: ReturnType<typeof vi.fn>, onApplied = vi.fn()) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <BulkPriceUpdateDialog
      open
      onClose={() => {}}
      baseUrl="http://api.test/api"
      token="tok"
      kind="material"
      kindLabel="materiales"
      priceUnitLabel="precio por tablero"
      categories={[{ id: 'cat-1', name: 'Melaminas' }]}
      groups={['Egger']}
      reader={reader}
      onApplied={onApplied}
    />,
  );
  return onApplied;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BulkPriceUpdateDialog (#1651)', () => {
  it('ajuste por porcentaje: previsualiza en el servidor y aplica con la versión previsualizada', async () => {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (String(input).endsWith('/preview')) return json(200, previewBody);
      return json(200, { batchId: 'b0000000-0000-4000-8000-000000000001', applied: 1, appliedAt: '2026-11-20T10:00:00Z' });
    });
    const onApplied = renderDialog(fetchMock);
    fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'cat-1' } });
    fireEvent.click(screen.getByTestId('btn-preview-prices'));
    expect((await screen.findByTestId('price-change-MEL-18')).textContent).toContain('+10.0%');
    expect(bodies[0]).toEqual({ kind: 'material', mode: 'percent', percent: 10, filter: { categoryId: 'cat-1' } });

    fireEvent.click(screen.getByTestId('btn-apply-prices'));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(1));
    expect(bodies[1]).toEqual({ kind: 'material', source: 'percent', percent: 10, items: [{ id: ITEM, expectedVersion: 3, newPrice: 1100 }] });
  });

  it('importar: lee el archivo, envía filas por código y muestra los grupos', async () => {
    const bodies: unknown[] = [];
    renderDialog(vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return json(200, previewBody);
    }));
    fireEvent.click(screen.getByLabelText(/Importar lista del proveedor/));
    const file = new File(['x'], 'lista.xlsx');
    fireEvent.change(screen.getByLabelText('Archivo'), { target: { files: [file] } });
    await screen.findByLabelText('Columna de código');
    fireEvent.click(screen.getByTestId('btn-preview-prices'));
    await screen.findByTestId('bulk-prices-preview');
    expect(bodies[0]).toEqual({
      kind: 'material',
      mode: 'import',
      rows: [
        { line: 2, code: 'MEL-18', price: 1100 },
        { line: 4, code: 'NUEVO', price: 5 },
        { line: 5, code: '', price: 7 },
      ],
    });
    expect(screen.getByTestId('count-changed').textContent).toContain('1');
    expect(screen.getByTestId('count-not-found').textContent).toContain('1');
    expect(screen.getByTestId('count-invalid').textContent).toContain('1');
  });

  it('conflicto 412: no aplica nada y pide volver a previsualizar', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/preview')) return json(200, previewBody);
      return json(412, { code: 'VERSION_CONFLICT', message: 'cambió', fieldErrors: {}, requestId: '', retryable: false, details: { staleIds: [ITEM] } });
    });
    const onApplied = renderDialog(fetchMock);
    fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('btn-preview-prices'));
    fireEvent.click(await screen.findByTestId('btn-apply-prices'));
    expect((await screen.findByTestId('bulk-prices-error')).textContent).toContain('volvé a previsualizar');
    expect(screen.queryByTestId('btn-apply-prices')).toBeNull();
    expect(screen.getByTestId('btn-preview-prices')).toBeTruthy();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('un error de red conserva la clave de idempotencia para el reintento', async () => {
    const keys: string[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/preview')) return json(200, previewBody);
      keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
      attempt += 1;
      if (attempt === 1) return json(503, { code: 'INTERNAL_ERROR', message: 'caído', fieldErrors: {}, requestId: '', retryable: true, details: {} });
      return json(200, { batchId: 'b0000000-0000-4000-8000-000000000001', applied: 1, appliedAt: '2026-11-20T10:00:00Z' });
    });
    const onApplied = renderDialog(fetchMock);
    fireEvent.change(screen.getByLabelText('Porcentaje'), { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('btn-preview-prices'));
    fireEvent.click(await screen.findByTestId('btn-apply-prices'));
    await screen.findByTestId('bulk-prices-error');
    fireEvent.click(screen.getByTestId('btn-apply-prices'));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
