/**
 * Reusable catalog table (presentation only).
 * Hover-revealed row actions; expand detail rows announce themselves with a
 * rotating chevron (design.md §4.2/§6.4 — the row opens; its affordance is
 * the chevron).
 */

import { Fragment, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

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

  // Rows only advertise expandability when clicking them reveals the inline
  // detail; without renderExpandedDetail the chevron would promise the wrong
  // thing (design.md §4.2).
  const expandable = Boolean(onRowClick && renderExpandedDetail);
  const colSpan =
    columns.length + (expandable ? 1 : 0) + (getRowActions ? 1 : 0);

  return (
    <div className="catalog-table-wrap">
      <table
        className="catalog-table"
        aria-rowcount={rows.length + 1}
      >
        <thead>
          <tr>
            {expandable ? (
              <th className="catalog-table__expander-head" scope="col">
                <span className="visually-hidden">Detalle</span>
              </th>
            ) : null}
            {columns.map((col) => (
              <th key={col.key} scope="col">
                {col.header}
              </th>
            ))}
            {getRowActions ? (
              <th className="catalog-table__actions-head" scope="col">
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
              // Ignore keys that originated on nested controls (actions).
              const target = event.target as HTMLElement | null;
              if (
                target &&
                target !== event.currentTarget &&
                target.closest('button, a, input, select, textarea, [role="button"]')
              ) {
                return;
              }
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
                  aria-expanded={expandable ? expanded : undefined}
                  data-expanded={expanded ? 'true' : undefined}
                >
                  {expandable ? (
                    <td className="catalog-table__expander-cell">
                      <span
                        className="catalog-table__expander"
                        data-expanded={expanded ? 'true' : undefined}
                      >
                        <ChevronRight
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden="true"
                        />
                      </span>
                    </td>
                  ) : null}
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
          ? 'status-badge status-badge--active'
          : 'status-badge status-badge--inactive'
      }
    >
      <span className="status-badge__dot" aria-hidden>
        ●
      </span>
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}
