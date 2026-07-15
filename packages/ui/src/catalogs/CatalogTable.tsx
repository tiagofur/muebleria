/**
 * Reusable catalog table (presentation only).
 * Hover-revealed row actions; optional expand detail (design.md §4.2 / F020).
 */

import { Fragment, type KeyboardEvent, type ReactNode } from 'react';

export interface CatalogColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
}

export interface CatalogTableProps<T extends { readonly id: string }> {
  readonly columns: readonly CatalogColumn<T>[];
  readonly rows: readonly T[];
  readonly selectedId?: string | null;
  readonly expandedId?: string | null;
  readonly isInactive?: (row: T) => boolean;
  readonly emptyMessage?: string;
  readonly getRowActions?: (row: T) => ReactNode;
  /** Click row → expand / select (not edit). Action buttons stop propagation. */
  readonly onRowClick?: (row: T) => void;
  /** Rendered in a full-width row under the expanded item (read-only detail). */
  readonly renderExpandedDetail?: (row: T) => ReactNode;
}

export function CatalogTable<T extends { readonly id: string }>({
  columns,
  rows,
  selectedId,
  expandedId,
  isInactive,
  emptyMessage = 'No hay ítems para mostrar.',
  getRowActions,
  onRowClick,
  renderExpandedDetail,
}: CatalogTableProps<T>): ReactNode {
  if (rows.length === 0) {
    return <p className="catalog-empty">{emptyMessage}</p>;
  }

  const colSpan = columns.length + (getRowActions ? 1 : 0);

  return (
    <div className="catalog-table-wrap">
      <table className="catalog-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
            {getRowActions ? (
              <th className="catalog-table__actions-head">
                <span className="visually-hidden">Acciones</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inactive = isInactive?.(row) ?? false;
            const selected = selectedId === row.id;
            const expanded = expandedId === row.id;
            const className = [
              'catalog-table__row',
              inactive ? 'is-inactive' : '',
              selected || expanded ? 'is-selected' : '',
              onRowClick ? 'is-clickable' : '',
            ]
              .filter(Boolean)
              .join(' ');

            const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
              if (!onRowClick) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onRowClick(row);
              }
            };

            return (
              <Fragment key={row.id}>
                <tr
                  className={className || undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? handleKeyDown : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  data-expanded={expanded ? 'true' : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key}>{col.render(row)}</td>
                  ))}
                  {getRowActions ? (
                    <td className="catalog-table__actions-cell">
                      <div
                        className="catalog-table__actions"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {getRowActions(row)}
                      </div>
                    </td>
                  ) : null}
                </tr>
                {expanded && renderExpandedDetail ? (
                  <tr className="catalog-table__detail-row">
                    <td colSpan={colSpan}>
                      <div className="catalog-row-detail">
                        {renderExpandedDetail(row)}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ActiveBadge({ active }: { readonly active: boolean }): ReactNode {
  return (
    <span
      className={
        active
          ? 'catalog-badge catalog-badge--active'
          : 'catalog-badge catalog-badge--inactive'
      }
    >
      {active ? '● Activo' : '● Inactivo'}
    </span>
  );
}
