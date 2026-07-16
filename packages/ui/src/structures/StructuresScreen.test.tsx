// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { StructuresScreen } from './StructuresScreen';
import type { Structure } from '@muebles/domain';

const mockStructures: Structure[] = [
  {
    id: 's1',
    code: 'EST-GAB-720',
    name: 'Gabinete Bajo Estándar',
    notes: 'Estructura estándar de cocina para bajo mesada',
    active: true,
    externalDims: { width: 600, height: 720, depth: 560 },
    boardParts: [
      {
        id: 'p1',
        code: 'LAT-D',
        description: 'Costado Derecho',
        quantity: 1,
        lengthMm: 720,
        widthMm: 560,
        edges: [
          { side: 'L1', enabled: false },
          { side: 'L2', enabled: false },
          { side: 'W1', enabled: false },
          { side: 'W2', enabled: false },
        ],
        optionRole: 'LATERAL',
      },
    ],
  },
  {
    id: 's2',
    code: 'EST-ALTO-600',
    name: 'Alacena Estándar',
    notes: 'Estructura de colgar estándar',
    active: false,
    externalDims: { width: 600, height: 600, depth: 320 },
    boardParts: [],
  },
];

describe('StructuresScreen', () => {
  afterEach(cleanup);

  it('renders list of active structures by default', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.getByText('EST-GAB-720')).toBeTruthy();
    expect(screen.getByText('Gabinete Bajo Estándar')).toBeTruthy();
    // Default filters active only, so EST-ALTO-600 should not be rendered
    expect(screen.queryByText('EST-ALTO-600')).toBeNull();
  });

  it('renders empty state when there are no structures', () => {
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.getByText('Sin estructuras')).toBeTruthy();
  });

  it('opens modal and submits new structure draft', () => {
    const mockOptionGroups = [
      {
        id: 'og1',
        code: 'LATERAL',
        name: 'Lateral',
        kind: 'board' as const,
        active: true,
        required: false,
        optionIds: [],
        options: [],
      },
    ];

    const onCreate = vi.fn();
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={mockOptionGroups}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    // Click on create structure button in empty state
    const newBtn = screen.getByRole('button', { name: /Crear estructura/i });
    fireEvent.click(newBtn);

    // Fill metadata
    fireEvent.change(screen.getByLabelText(/Código de Estructura/i), {
      target: { value: 'EST-TEST' },
    });
    fireEvent.change(screen.getByLabelText(/^Nombre$/i), {
      target: { value: 'Estructura de Test' },
    });
    fireEvent.change(screen.getByLabelText(/Ancho Externo \(mm\)/i), {
      target: { value: '600' },
    });
    fireEvent.change(screen.getByLabelText(/Alto Externo \(mm\)/i), {
      target: { value: '720' },
    });
    fireEvent.change(screen.getByLabelText(/Profundidad \(mm\)/i), {
      target: { value: '560' },
    });

    // Add piece
    fireEvent.click(screen.getByRole('button', { name: /Agregar pieza/i }));

    expect(screen.getByTestId('part-item-0')).toBeTruthy();

    fireEvent.change(screen.getByTestId('part-code-0'), {
      target: { value: 'PIEZA-1' },
    });
    fireEvent.change(screen.getByTestId('part-desc-0'), {
      target: { value: 'Costado izquierdo' },
    });
    fireEvent.change(screen.getByTestId('part-qty-0'), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId('part-length-0'), {
      target: { value: '720' },
    });
    fireEvent.change(screen.getByTestId('part-width-0'), {
      target: { value: '560' },
    });
    fireEvent.change(screen.getByTestId('part-role-0'), {
      target: { value: 'LATERAL' },
    });

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).toHaveBeenCalledWith({
      code: 'EST-TEST',
      name: 'Estructura de Test',
      notes: '',
      widthMm: 600,
      heightMm: 720,
      depthMm: 560,
      active: true,
      boardParts: [
        expect.objectContaining({
          code: 'PIEZA-1',
          description: 'Costado izquierdo',
          quantity: 2,
          lengthMm: 720,
          widthMm: 560,
          optionRole: 'LATERAL',
        }),
      ],
    });
  });

  it('filters by status chips', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.queryByText('EST-ALTO-600')).toBeNull();

    // Click Inactivos
    fireEvent.click(screen.getByText('Inactivos'));

    expect(screen.queryByText('EST-GAB-720')).toBeNull();
    expect(screen.getByText('EST-ALTO-600')).toBeTruthy();
  });
});
