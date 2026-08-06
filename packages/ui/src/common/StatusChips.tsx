/**
 * Status / filter chips — design.md §4.6.
 *
 * Default options are catalog Todos/Activos/Inactivos. Pass `options` for
 * other domains (e.g. project workflow statuses on Cotizaciones).
 */

import type { ReactNode } from 'react';
import type { CatalogStatusFilter } from '../catalogs/catalogHelpers';
import './statusChips.css';

export type StatusChipOption<T extends string = string> = {
  readonly value: T;
  readonly label: string;
};

const CATALOG_OPTIONS: readonly StatusChipOption<CatalogStatusFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

export type StatusChipsProps<T extends string = CatalogStatusFilter> = {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options?: readonly StatusChipOption<T>[];
  readonly 'aria-label'?: string;
  readonly 'data-testid'?: string;
};

export function StatusChips<T extends string = CatalogStatusFilter>({
  value,
  onChange,
  options,
  'aria-label': ariaLabel = 'Filtrar por estado',
  'data-testid': dataTestId,
}: StatusChipsProps<T>): ReactNode {
  const opts = (options ??
    CATALOG_OPTIONS) as readonly StatusChipOption<T>[];

  return (
    <div
      className="ui-status-chips"
      role="group"
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      {opts.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={
              selected
                ? 'ui-status-chips__chip is-selected'
                : 'ui-status-chips__chip'
            }
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
