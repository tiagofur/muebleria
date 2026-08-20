import type { ReactNode } from 'react';
import { Filter } from 'lucide-react';
import type { VendedorOption } from './salesDashboardHelpers';

export function VendedorFilter({
  vendedores,
  selectedId,
  onChange,
}: {
  readonly vendedores: readonly VendedorOption[];
  readonly selectedId: string | null;
  readonly onChange: (id: string | null) => void;
}): ReactNode {
  return (
    <div className="sales-filter">
      <Filter size={14} strokeWidth={1.5} />
      <label className="sales-filter__label" htmlFor="vendedor-filter">
        Vendedor:
      </label>
      <select
        id="vendedor-filter"
        className="sales-filter__select"
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Todos los vendedores</option>
        {vendedores.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}
