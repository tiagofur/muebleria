/**
 * #1417 — «Partes del diseño» section: declares the internal parts of the
 * hardware's pinned SKP by SketchUp component name, each with its
 * fijo/móvil membership (#1376 vocabulary) and optional finish key/label.
 * Empty rows are dropped on submit; strict validation runs in the domain
 * (via the store payload builder) and the modal surfaces its errors.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';

import type { HardwareDraft } from './hardwareDraft';

const MEMBERSHIP_OPTIONS = [
  { value: 'body', label: 'Fija al cuerpo (body)' },
  { value: 'actor:drawer', label: 'Parte móvil del cajón (actor:drawer)' },
];

export function HardwareDesignPartsSection({
  draft,
  setDraft,
}: {
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
}): ReactNode {
  const rows = draft.designParts ?? [];
  type DesignPartRow = NonNullable<HardwareDraft['designParts']>[number];
  const updateRow = (idx: number, patch: Partial<DesignPartRow>) => {
    setDraft((prev) => ({
      ...prev,
      designParts: (prev.designParts ?? []).map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  };
  const removeRow = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      designParts: (prev.designParts ?? []).filter((_, i) => i !== idx),
    }));
  };
  const addRow = () => {
    setDraft((prev) => ({
      ...prev,
      designParts: [
        ...(prev.designParts ?? []),
        { componentName: '', actorMembership: 'body', label: '', finishKey: '' },
      ],
    }));
  };

  return (
    <fieldset className="catalog-form__section" data-testid="hardware-design-parts-section">
      <legend className="catalog-form__section-title">Partes del diseño (opcional)</legend>
      <p className="catalog-form__hint">
        Si el SKP del herraje trae varias piezas (ej. riel fijo + riel móvil),
        declaralas acá por nombre de componente para que se separen al abrir y
        puedan llevar acabado distinto. Sin partes, el herraje se comporta
        como una sola pieza.
      </p>
      {rows.map((row, idx) => (
        <div key={idx} className="catalog-form__field" data-testid={`hardware-design-part-${idx}`}>
          <div>
            <label htmlFor={`hdp-name-${idx}`}>Componente del SKP</label>
            <input
              id={`hdp-name-${idx}`}
              value={row.componentName}
              onChange={(e) => updateRow(idx, { componentName: e.target.value })}
              placeholder="ej. riel_fijo"
              autoComplete="off"
              data-testid={`hardware-design-part-${idx}-name`}
            />
          </div>
          <div>
            <label htmlFor={`hdp-membership-${idx}`}>Al abrir</label>
            <select
              id={`hdp-membership-${idx}`}
              value={row.actorMembership}
              onChange={(e) => updateRow(idx, { actorMembership: e.target.value })}
              data-testid={`hardware-design-part-${idx}-membership`}
            >
              {MEMBERSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`hdp-finish-${idx}`}>Clave de acabado (opcional)</label>
            <input
              id={`hdp-finish-${idx}`}
              value={row.finishKey}
              onChange={(e) => updateRow(idx, { finishKey: e.target.value })}
              placeholder="ej. body"
              autoComplete="off"
              data-testid={`hardware-design-part-${idx}-finish`}
            />
          </div>
          <div>
            <label htmlFor={`hdp-label-${idx}`}>Etiqueta (opcional)</label>
            <input
              id={`hdp-label-${idx}`}
              value={row.label}
              onChange={(e) => updateRow(idx, { label: e.target.value })}
              placeholder="ej. Riel fijo"
              autoComplete="off"
              data-testid={`hardware-design-part-${idx}-label`}
            />
          </div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => removeRow(idx)}
            aria-label={`Eliminar parte ${idx + 1}`}
            data-testid={`hardware-design-part-${idx}-remove`}
          >
            Eliminar
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={addRow}
        data-testid="hardware-design-parts-add"
      >
        Añadir parte
      </button>
    </fieldset>
  );
}
