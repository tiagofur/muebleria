/**
 * @vitest-environment jsdom
 *
 * #1648 scope item 3 — «Entregas en riesgo» filter in Producción and Estado de
 * Planta: late or due-this-week orders only; the others hide; clearing works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { localIsoDate, type Project } from '@granete/domain';
import { ProductionQueue } from './ProductionQueue';
import { PlantBoardScreen } from './PlantBoardScreen';

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

function project(id: string, name: string, committedDeliveryDate?: string): Project {
  return {
    id,
    name,
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [{ id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...(committedDeliveryDate ? { committedDeliveryDate } : {}),
  };
}

const projects = [
  project('late', 'Obra atrasada', dayOffset(-2)),
  project('soon', 'Obra esta semana', dayOffset(3)),
  project('far', 'Obra lejana', dayOffset(30)),
  project('none', 'Obra sin fecha'),
];

afterEach(() => cleanup());

describe('ProductionQueue — Entregas en riesgo (#1648)', () => {
  it('filtra atrasadas y que vencen esta semana, y se puede limpiar', async () => {
    const user = userEvent.setup();
    render(
      <ProductionQueue projects={projects} customerLabelFor={() => 'Ana'} salePriceFor={() => null} onOpenOrder={vi.fn()} onMarkProduced={vi.fn()} />,
    );
    const toggle = screen.getByTestId('prod-delivery-risk-toggle');
    expect(toggle.textContent).toBe('Entregas en riesgo (2)');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);

    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const names = screen.getAllByRole('listitem').map((li) => li.querySelector('h3')?.textContent);
    expect(names).toEqual(['Obra atrasada', 'Obra esta semana']);

    await user.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('sin entregas en riesgo muestra un vacío propio con «Ver todas»', async () => {
    const user = userEvent.setup();
    render(
      <ProductionQueue
        projects={[project('far', 'Obra lejana', dayOffset(30))]}
        customerLabelFor={() => 'Ana'}
        salePriceFor={() => null}
        onMarkProduced={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId('prod-delivery-risk-toggle'));
    expect(screen.getByText('Ninguna entrega en riesgo')).toBeTruthy();
    await user.click(screen.getByTestId('prod-delivery-risk-clear'));
    expect(screen.getByText('Obra lejana')).toBeTruthy();
  });
});

describe('PlantBoardScreen — Entregas en riesgo (#1648)', () => {
  it('filtra las filas del tablero y ordena la más urgente primero', async () => {
    const user = userEvent.setup();
    render(<PlantBoardScreen projects={projects} />);
    const rowNames = () =>
      Array.from(screen.getByTestId('plant-board-table').querySelectorAll('tbody tr')).map(
        (tr) => tr.querySelector('th, td')?.textContent ?? '',
      );
    expect(rowNames()).toHaveLength(4);
    expect(rowNames()[0]).toContain('Obra atrasada');
    const toggle = screen.getByTestId('plant-board-delivery-risk-toggle');
    expect(toggle.textContent).toBe('Entregas en riesgo (2)');
    await user.click(toggle);
    const filtered = rowNames();
    expect(filtered).toHaveLength(2);
    expect(filtered[0]).toContain('Obra atrasada');
    expect(filtered[1]).toContain('Obra esta semana');
  });

  it('sin obras en fábrica no muestra el filtro', () => {
    render(<PlantBoardScreen projects={[]} />);
    expect(screen.queryByTestId('plant-board-delivery-risk-toggle')).toBeNull();
    expect(screen.getByText('Sin obras en fábrica')).toBeTruthy();
  });
});
