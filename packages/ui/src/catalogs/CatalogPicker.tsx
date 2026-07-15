/**
 * Catalog select picker — inactive items hidden by default (CAT-05).
 */

import type { ReactNode } from 'react';
import { filterActiveForPicker } from './catalogHelpers';

export interface CatalogPickerOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

export interface CatalogPickerProps {
  readonly id?: string;
  readonly label: string;
  readonly items: readonly CatalogPickerOption[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** When true, inactive items appear (default false). */
  readonly includeInactive?: boolean;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export function CatalogPicker({
  id,
  label,
  items,
  value,
  onChange,
  includeInactive = false,
  placeholder = 'Seleccionar…',
  disabled = false,
}: CatalogPickerProps): ReactNode {
  const options = filterActiveForPicker(items, { includeInactive });

  return (
    <div className="catalog-picker">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.code} — {item.name}
            {!item.active ? ' (inactivo)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
