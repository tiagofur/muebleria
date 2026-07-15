/**
 * Status filter chips: Todos / Activos / Inactivos — design.md §4.6.
 */

import type { ReactNode } from 'react';
import type { CatalogStatusFilter } from '../catalogs/catalogHelpers';
import './statusChips.css';

export type StatusChipsProps = {
  readonly value: CatalogStatusFilter;
  readonly onChange: (value: CatalogStatusFilter) => void;
  readonly 'aria-label'?: string;
};

const OPTIONS: readonly { value: CatalogStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
];

export function StatusChips({
  value,
  onChange,
  'aria-label': ariaLabel = 'Filtrar por estado',
}: StatusChipsProps): ReactNode {
  return (
    <div className="ui-status-chips" role="group" aria-label={ariaLabel}>
      {OPTIONS.map((opt) => {
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
