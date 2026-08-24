// @vitest-environment jsdom
/**
 * CatalogTable + ActiveBadge tests — expand affordance (design.md §4.2/§6.4,
 * F154) and single status-badge vocabulary (§5.2, F111).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActiveBadge, CatalogTable } from './CatalogTable';

interface Row {
  readonly id: string;
  readonly name: string;
}

const rows: readonly Row[] = [
  { id: 'r1', name: 'Primero' },
  { id: 'r2', name: 'Segundo' },
];

const columns = [{ key: 'name', header: 'Nombre', render: (r: Row) => r.name }];

afterEach(cleanup);

describe('CatalogTable — expand affordance (§4.2, F154)', () => {
  it('muestra chevron en cada fila cuando la tabla es expandible', () => {
    render(
      <CatalogTable
        columns={columns}
        rows={rows}
        expandedId={null}
        onRowClick={() => {}}
        renderExpandedDetail={(r: Row) => <div>detalle {r.name}</div>}
      />,
    );
    const chevrons = document.querySelectorAll('.catalog-table__expander');
    expect(chevrons).toHaveLength(2);
  });

  it('el chevron es decorativo (aria-hidden) — la fila es el control', () => {
    render(
      <CatalogTable
        columns={columns}
        rows={rows}
        expandedId={null}
        onRowClick={() => {}}
        renderExpandedDetail={(r: Row) => <div>detalle {r.name}</div>}
      />,
    );
    const svg = document.querySelector('.catalog-table__expander svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('la fila expone aria-expanded acorde al estado', () => {
    render(
      <CatalogTable
        columns={columns}
        rows={rows}
        expandedId="r1"
        onRowClick={() => {}}
        renderExpandedDetail={(r: Row) => <div>detalle {r.name}</div>}
      />,
    );
    const firstRow = screen.getByText('Primero').closest('tr');
    const secondRow = screen.getByText('Segundo').closest('tr');
    expect(firstRow?.getAttribute('aria-expanded')).toBe('true');
    expect(secondRow?.getAttribute('aria-expanded')).toBe('false');
  });

  it('marca data-expanded en el chevron de la fila expandida (rotación CSS)', () => {
    render(
      <CatalogTable
        columns={columns}
        rows={rows}
        expandedId="r1"
        onRowClick={() => {}}
        renderExpandedDetail={(r: Row) => <div>detalle {r.name}</div>}
      />,
    );
    const chevron = screen
      .getByText('Primero')
      .closest('tr')
      ?.querySelector('.catalog-table__expander');
    expect(chevron?.getAttribute('data-expanded')).toBe('true');
  });

  it('sin renderExpandedDetail no hay chevron ni aria-expanded (no promete expansión)', () => {
    render(
      <CatalogTable columns={columns} rows={rows} onRowClick={() => {}} />,
    );
    expect(document.querySelector('.catalog-table__expander')).toBeNull();
    const row = screen.getByText('Primero').closest('tr');
    expect(row?.getAttribute('aria-expanded')).toBeNull();
  });

  it('el click en la fila expande (comportamiento intacto con chevron presente)', () => {
    const onRowClick = vi.fn();
    render(
      <CatalogTable
        columns={columns}
        rows={rows}
        expandedId={null}
        onRowClick={onRowClick}
        renderExpandedDetail={(r: Row) => <div>detalle {r.name}</div>}
      />,
    );
    fireEvent.click(screen.getByText('Segundo'));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it('la cabecera del chevron tiene label accesible "Detalle"', () => {
    render(
      <CatalogTable
        columns={columns}
        rows={rows}
        expandedId={null}
        onRowClick={() => {}}
        renderExpandedDetail={(r: Row) => <div>detalle {r.name}</div>}
      />,
    );
    expect(screen.getByText('Detalle', { selector: '.visually-hidden' })).toBeTruthy();
  });
});

describe('ActiveBadge (status-badge vocabulary, §5.2)', () => {
  it('renders active state with status-badge--active, dot and label', () => {
    render(<ActiveBadge active={true} />);
    const badge = screen.getByText('Activo');
    expect(badge.className).toContain('status-badge--active');
    expect(badge.querySelector('.status-badge__dot')).not.toBeNull();
  });

  it('renders inactive state with status-badge--inactive, dot and label', () => {
    render(<ActiveBadge active={false} />);
    const badge = screen.getByText('Inactivo');
    expect(badge.className).toContain('status-badge--inactive');
    expect(badge.querySelector('.status-badge__dot')).not.toBeNull();
  });

  it('does not use the legacy catalog-badge family', () => {
    const { container } = render(<ActiveBadge active={true} />);
    expect(container.querySelector('.catalog-badge')).toBeNull();
    expect(container.querySelector('.status-badge--active')).not.toBeNull();
  });
});
