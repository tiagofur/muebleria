/**
 * Attach reusable catalog components to a furniture template (H07 / #102).
 */
import type { ReactNode } from 'react';
import type { FurnitureComponent } from '@muebles/domain';
import {
  furnitureComponentKindLabelEs,
  isFurnitureComponentKind,
} from '@muebles/domain';
import { Plus, Trash2 } from 'lucide-react';

export type ModuleComponentRefDraft = {
  componentId: string;
  quantity: number;
};

export type ModuleComponentsSectionProps = {
  readonly componentsCatalog: readonly FurnitureComponent[];
  readonly refs: readonly ModuleComponentRefDraft[];
  readonly onChange: (refs: ModuleComponentRefDraft[]) => void;
  readonly canMutate?: boolean;
};

export function ModuleComponentsSection({
  componentsCatalog,
  refs,
  onChange,
  canMutate = true,
}: ModuleComponentsSectionProps): ReactNode {
  const activeCatalog = componentsCatalog.filter((c) => c.active !== false);

  const addRow = () => {
    const first = activeCatalog[0];
    onChange([
      ...refs,
      { componentId: first?.id ?? '', quantity: 1 },
    ]);
  };

  const patch = (index: number, patch: Partial<ModuleComponentRefDraft>) => {
    onChange(refs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const remove = (index: number) => {
    onChange(refs.filter((_, i) => i !== index));
  };

  return (
    <section
      className="module-section"
      data-testid="module-components-section"
      aria-label="Componentes del mueble"
    >
      <header className="module-section__header">
        <h3 className="module-section__title">Componentes</h3>
        {canMutate ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={addRow}
            disabled={activeCatalog.length === 0}
            data-testid="module-component-add"
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden />
            Añadir componente
          </button>
        ) : null}
      </header>
      <p className="form-hint">
        Piezas reutilizables del catálogo de Ingeniería (puerta, entrepaño…). Se
        expanden al cotizar según la medida del mueble.
      </p>
      {activeCatalog.length === 0 ? (
        <p className="catalog-empty" data-testid="module-components-empty-catalog">
          No hay componentes activos. Creá uno en Ingeniería → Componentes.
        </p>
      ) : refs.length === 0 ? (
        <p className="catalog-empty" data-testid="module-components-empty">
          Sin componentes. El mueble puede ser solo estructura o piezas fijas.
        </p>
      ) : (
        <ul className="structure-presets-list" data-testid="module-components-list">
          {refs.map((ref, idx) => {
            const comp = componentsCatalog.find((c) => c.id === ref.componentId);
            const kindLabel =
              comp && isFurnitureComponentKind(comp.kind)
                ? furnitureComponentKindLabelEs(comp.kind)
                : '';
            return (
              <li key={`${ref.componentId}-${idx}`} className="structure-presets-list__row">
                <label className="field">
                  <span className="field__label">Componente</span>
                  <select
                    className="input"
                    value={ref.componentId}
                    disabled={!canMutate}
                    onChange={(e) => patch(idx, { componentId: e.target.value })}
                    data-testid={`module-component-select-${idx}`}
                  >
                    <option value="">Elegí…</option>
                    {activeCatalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name}
                        {isFurnitureComponentKind(c.kind)
                          ? ` (${furnitureComponentKindLabelEs(c.kind)})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Cantidad</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    step={1}
                    value={ref.quantity}
                    disabled={!canMutate}
                    onChange={(e) =>
                      patch(idx, {
                        quantity: Math.max(1, Math.floor(Number(e.target.value)) || 1),
                      })
                    }
                    data-testid={`module-component-qty-${idx}`}
                  />
                </label>
                {kindLabel ? (
                  <p className="form-hint" style={{ alignSelf: 'end' }}>
                    {kindLabel}
                  </p>
                ) : null}
                {canMutate ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => remove(idx)}
                    aria-label="Quitar componente"
                    data-testid={`module-component-remove-${idx}`}
                  >
                    <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
