import type { ReactNode } from 'react';

export type LibraryTypeValue = 'standard' | 'custom';

interface LibraryTypeOption {
  value: LibraryTypeValue;
  title: string;
  badge: string;
  description: string;
}

const OPTIONS: readonly LibraryTypeOption[] = [
  {
    value: 'standard',
    title: 'Biblioteca estándar',
    badge: 'Oficial Granete',
    description:
      'Usa los muebles oficiales de Granete. El taller configura sus precios, herrajes y políticas de unión, pero no edita la geometría.',
  },
  {
    value: 'custom',
    title: 'Biblioteca personalizada',
    badge: 'Módulo de Personalización',
    description:
      'Además de lo anterior, el taller crea y edita muebles, estructuras, componentes, agregados y acabados propios.',
  },
];

export interface LibraryTypeCardsProps {
  /** Unique prefix so create and edit modals never share element ids. */
  idPrefix: string;
  value: LibraryTypeValue;
  onChange: (next: LibraryTypeValue) => void;
  disabled?: boolean;
}

/**
 * Accessible radio cards for the organization library entitlement (#1382).
 * Native radio inputs keep keyboard and screen-reader behavior for free.
 */
export function LibraryTypeCards({
  idPrefix,
  value,
  onChange,
  disabled = false,
}: LibraryTypeCardsProps): ReactNode {
  const labelId = `${idPrefix}-library-type-label`;
  return (
    <div className="platform-form-group">
      <span className="platform-label" id={labelId}>
        Tipo de Librería de Manufactura
      </span>
      <div className="platform-radio-cards" role="radiogroup" aria-labelledby={labelId}>
        {OPTIONS.map((option) => {
          const inputId = `${idPrefix}-library-${option.value}`;
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={inputId}
              className={`platform-radio-card${selected ? ' platform-radio-card--selected' : ''}`}
            >
              <input
                id={inputId}
                type="radio"
                name={`${idPrefix}-library-type`}
                className="platform-radio-card__input"
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              <span className="platform-radio-card__header">
                <span className="platform-radio-card__title">{option.title}</span>
                <span className="platform-chip platform-chip--plan">{option.badge}</span>
              </span>
              <span className="platform-radio-card__description">{option.description}</span>
            </label>
          );
        })}
      </div>
      <p className="platform-help-text">
        Podés cambiarlo después. Pasar a estándar oculta la edición de geometría, pero no borra lo ya creado.
      </p>
    </div>
  );
}
