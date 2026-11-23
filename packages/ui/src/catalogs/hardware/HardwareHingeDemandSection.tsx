/**
 * #1579 — «Bisagras por altura de puerta»: la tabla que este herraje declara
 * para sí mismo (alto máximo → cantidad de bisagras). Las filas viven en el
 * draft como texto; la validación estricta corre al enviar.
 *
 * Abierta cuando el herraje es una bisagra (forma 3D `hinge`) o ya declara
 * una tabla; cerrada para el resto, porque un juego de bisagras (sin forma
 * propia) también puede declararla.
 */

import { useEffect, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ChevronRight } from 'lucide-react';

import { suggestedHingeDemandRows, type HardwareDraft, type HingeBandsDraftRow } from './hardwareDraft';

export function HardwareHingeDemandSection({
  draft,
  setDraft,
  canMutate,
  suggestOnCreate,
}: {
  readonly draft: HardwareDraft;
  readonly setDraft: Dispatch<SetStateAction<HardwareDraft>>;
  readonly canMutate: boolean;
  /** Al crear una bisagra, la tabla sugerida se carga sola (editable). */
  readonly suggestOnCreate: boolean;
}): ReactNode {
  const rows = draft.hingeDemandRows ?? [];
  const isHingeShape = draft.previewShape === 'hinge';
  const hasTable = rows.length > 0;

  // Los valores del fabricante como sugerencia: la escalera de librería. Sólo
  // al crear y sólo la primera vez que el herraje pasa a ser bisagra — nunca
  // pisa filas que el taller ya cargó.
  useEffect(() => {
    if (!suggestOnCreate || !isHingeShape) return;
    setDraft((prev) =>
      prev.hingeDemandRows && prev.hingeDemandRows.length > 0
        ? prev
        : { ...prev, hingeDemandRows: suggestedHingeDemandRows() },
    );
  }, [suggestOnCreate, isHingeShape, setDraft]);

  const updateRow = (idx: number, patch: Partial<HingeBandsDraftRow>) => {
    setDraft((prev) => ({
      ...prev,
      hingeDemandRows: (prev.hingeDemandRows ?? []).map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    }));
  };
  const removeRow = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      hingeDemandRows: (prev.hingeDemandRows ?? []).filter((_, i) => i !== idx),
    }));
  };
  const addRow = () => {
    setDraft((prev) => ({
      ...prev,
      hingeDemandRows: [...(prev.hingeDemandRows ?? []), { upToHeightMm: '', hinges: '2' }],
    }));
  };
  const loadSuggested = () => {
    setDraft((prev) => ({ ...prev, hingeDemandRows: suggestedHingeDemandRows() }));
  };

  const body = (
    <fieldset className="catalog-form__section" data-testid="hardware-hinge-demand-section">
      <legend className="catalog-form__section-title">Bisagras por altura de puerta</legend>
      <p className="catalog-form__hint">
        Cuántas bisagras de este modelo lleva una puerta según su alto. Se aplica cuando el
        mueble elige este herraje: gana a la política de fábrica y pierde ante la excepción
        del componente. Sin tabla, la puerta usa la política de fábrica y luego la escalera
        de librería.
      </p>

      {rows.map((row, idx) => (
        <div key={idx} className="catalog-form__row" data-testid={`hardware-hinge-band-${idx}`}>
          <div className="catalog-form__field catalog-form__field--narrow">
            <label htmlFor={`hinge-band-height-${idx}`}>Puertas de hasta (mm)</label>
            <input
              id={`hinge-band-height-${idx}`}
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={row.upToHeightMm}
              onChange={(e) => updateRow(idx, { upToHeightMm: e.target.value })}
              disabled={!canMutate}
              data-testid={`hardware-hinge-band-${idx}-height`}
            />
          </div>
          <div className="catalog-form__field catalog-form__field--narrow">
            <label htmlFor={`hinge-band-hinges-${idx}`}>Bisagras</label>
            <input
              id={`hinge-band-hinges-${idx}`}
              type="number"
              inputMode="numeric"
              min={2}
              max={5}
              step="1"
              value={row.hinges}
              onChange={(e) => updateRow(idx, { hinges: e.target.value })}
              disabled={!canMutate}
              data-testid={`hardware-hinge-band-${idx}-hinges`}
            />
          </div>
          <div className="catalog-form__field">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => removeRow(idx)}
              disabled={!canMutate}
              aria-label={`Quitar la banda ${idx + 1}`}
              data-testid={`hardware-hinge-band-${idx}-remove`}
            >
              Quitar
            </button>
          </div>
        </div>
      ))}

      <div className="catalog-form__row">
        <button
          type="button"
          className="btn btn--small"
          onClick={addRow}
          disabled={!canMutate}
          data-testid="hardware-hinge-band-add"
        >
          Añadir banda
        </button>
        {!hasTable ? (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={loadSuggested}
            disabled={!canMutate}
            data-testid="hardware-hinge-band-suggest"
          >
            Usar la tabla sugerida
          </button>
        ) : null}
      </div>

      {hasTable ? (
        <div className="catalog-form__field catalog-form__field--narrow">
          <label htmlFor="hinge-width-surge">Recargo por ancho desde (mm)</label>
          <input
            id="hinge-width-surge"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            placeholder="650"
            value={draft.hingeDemandWidthSurgeMm ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, hingeDemandWidthSurgeMm: e.target.value }))}
            disabled={!canMutate}
            data-testid="hardware-hinge-width-surge"
          />
          <p className="catalog-form__hint">
            +1 bisagra si la puerta es más ancha. Vacío usa 650 mm (regla de librería); 0
            desactiva el recargo.
          </p>
        </div>
      ) : null}
    </fieldset>
  );

  if (isHingeShape || hasTable) return body;

  return (
    <details className="catalog-form-advanced" data-testid="hardware-hinge-demand-disclosure">
      <summary style={{ cursor: 'pointer' }}>
        <ChevronRight size={14} strokeWidth={1.5} aria-hidden className="catalog-advanced-chevron" />
        Bisagras por altura de puerta
      </summary>
      {body}
    </details>
  );
}
