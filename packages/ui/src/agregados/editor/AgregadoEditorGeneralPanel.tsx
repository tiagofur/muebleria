/**
 * Agregado editor — General tab.
 *
 * 2-column workspace (mirrors ComponentEditorGeneralPanel): main column holds
 * identity, reference dimensions and notes; the aside shows a live summary of
 * the sub-assembly (dims readout + piece/hardware counts with tab shortcuts)
 * and a short guide of the W/H/D → Piezas → Herrajes workflow.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Layers, Ruler, Settings2 } from 'lucide-react';
import type { AgregadoEditorTab } from './AgregadoEditorForm';
import type { AgregadoDraft } from '../agregadoDraft';

export type AgregadoEditorGeneralPanelProps = {
  readonly formId: string;
  readonly draft: AgregadoDraft;
  readonly setDraft: Dispatch<SetStateAction<AgregadoDraft>>;
  readonly setEditorTab: Dispatch<SetStateAction<AgregadoEditorTab>>;
};

export function AgregadoEditorGeneralPanel({
  formId,
  draft,
  setDraft,
  setEditorTab,
}: AgregadoEditorGeneralPanelProps): ReactNode {
  const hasDims =
    draft.widthMm > 0 || draft.heightMm > 0 || draft.depthMm > 0;

  const totalHardwarePlacements = draft.components.reduce(
    (acc, c) => acc + (c.overrides?.hardwarePlacements?.length ?? 0),
    0,
  );
  const totalHardwareCount = draft.hardwareLines.length + totalHardwarePlacements;

  return (
    <div
      role="tabpanel"
      id="agregado-editor-panel-general"
      aria-labelledby="agregado-editor-tab-general"
      data-testid="agregado-tab-general"
      className="agregado-general__workspace"
    >
      <div className="agregado-general__main">
        <div className="agregado-general__card">
          <h3 className="agregado-general__card-title">Identidad</h3>

          <div className="catalog-form__row">
            <div className="catalog-form__field">
              <label className="catalog-form__label" htmlFor={`${formId}-code`}>
                Código
              </label>
              <input
                id={`${formId}-code`}
                type="text"
                className="catalog-form__input"
                value={draft.code}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, code: e.target.value }))
                }
                placeholder="Ej: PUERTA_BISAGRA_IZQ"
                required
                data-testid="agregado-field-code"
              />
            </div>
            <div className="catalog-form__field">
              <label className="catalog-form__label" htmlFor={`${formId}-name`}>
                Nombre
              </label>
              <input
                id={`${formId}-name`}
                type="text"
                className="catalog-form__input"
                value={draft.name}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Ej: Puerta Batiente Izquierda"
                required
                data-testid="agregado-field-name"
              />
            </div>
          </div>

          <fieldset className="catalog-form__fieldset">
            <legend className="catalog-form__legend">
              Dimensiones de referencia (mm)
            </legend>
            <p className="catalog-form__hint" data-testid="agregado-dims-hint">
              Medida del hueco / sub-espacio que ocupa este agregado. Las
              fórmulas de sus piezas y herrajes usan estas <code>W</code>,{' '}
              <code>H</code> y <code>D</code> locales, y la Vista 3D las toma
              como envolvente.
            </p>
            <div className="catalog-form__row catalog-form__row--3">
              <div className="catalog-form__field">
                <label className="catalog-form__label" htmlFor={`${formId}-w`}>
                  Ancho (W)
                </label>
                <input
                  id={`${formId}-w`}
                  type="number"
                  className="catalog-form__input"
                  value={draft.widthMm || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      widthMm: Math.max(0, Number(e.target.value)) || 0,
                    }))
                  }
                  min={0}
                  placeholder="Opcional"
                  data-testid="agregado-field-width"
                />
              </div>
              <div className="catalog-form__field">
                <label className="catalog-form__label" htmlFor={`${formId}-h`}>
                  Alto (H)
                </label>
                <input
                  id={`${formId}-h`}
                  type="number"
                  className="catalog-form__input"
                  value={draft.heightMm || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      heightMm: Math.max(0, Number(e.target.value)) || 0,
                    }))
                  }
                  min={0}
                  placeholder="Opcional"
                  data-testid="agregado-field-height"
                />
              </div>
              <div className="catalog-form__field">
                <label className="catalog-form__label" htmlFor={`${formId}-d`}>
                  Profundidad (D)
                </label>
                <input
                  id={`${formId}-d`}
                  type="number"
                  className="catalog-form__input"
                  value={draft.depthMm || ''}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      depthMm: Math.max(0, Number(e.target.value)) || 0,
                    }))
                  }
                  min={0}
                  placeholder="Opcional"
                  data-testid="agregado-field-depth"
                />
              </div>
            </div>
          </fieldset>

          <div className="catalog-form__field">
            <label className="catalog-form__label" htmlFor={`${formId}-desc`}>
              Descripción
            </label>
            <input
              id={`${formId}-desc`}
              type="text"
              className="catalog-form__input"
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Descripción breve del sub-ensamble…"
            />
          </div>

          <div className="catalog-form__field">
            <label className="catalog-form__label" htmlFor={`${formId}-notes`}>
              Notas de ensamblaje
            </label>
            <textarea
              id={`${formId}-notes`}
              className="catalog-form__input catalog-form__textarea"
              value={draft.notes}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, notes: e.target.value }))
              }
              rows={3}
              placeholder="Instrucciones especiales, orientación, etc."
            />
          </div>
        </div>
      </div>

      <div className="agregado-general__aside">
        <div
          className="agregado-general__card agregado-general__card--aside"
          data-testid="agregado-general-summary"
        >
          <h3 className="agregado-general__card-title">Resumen</h3>

          {hasDims ? (
            <span
              className="agregado-card__dims"
              data-testid="agregado-general-dims-readout"
            >
              {draft.widthMm} × {draft.heightMm} × {draft.depthMm} mm
            </span>
          ) : (
            <p className="catalog-form__hint">
              Sin dimensiones de referencia todavía.
            </p>
          )}

          <div className="agregado-general__summary-row">
            <span className="agregado-general__summary-meta">
              <Layers size={14} strokeWidth={1.5} aria-hidden />
              Piezas
              <strong
                className="agregado-general__count"
                data-testid="agregado-general-count-components"
              >
                {draft.components.length}
              </strong>
            </span>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setEditorTab('components')}
              data-testid="agregado-general-goto-components"
            >
              Ver piezas
            </button>
          </div>

          <div className="agregado-general__summary-row">
            <span className="agregado-general__summary-meta">
              <Settings2 size={14} strokeWidth={1.5} aria-hidden />
              Herrajes
              <strong
                className="agregado-general__count"
                data-testid="agregado-general-count-hardware"
              >
                {totalHardwareCount}
              </strong>
            </span>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setEditorTab('hardware')}
              data-testid="agregado-general-goto-hardware"
            >
              Ver herrajes
            </button>
          </div>
        </div>

        <div
          className="agregado-general__card agregado-general__card--aside"
          data-testid="agregado-general-guide"
        >
          <h3 className="agregado-general__card-title">
            <Ruler size={14} strokeWidth={1.5} aria-hidden /> Cómo se define
          </h3>
          <ol className="agregado-general__steps">
            <li className="agregado-general__step">
              <span className="agregado-general__step-num">1</span>
              <span className="agregado-general__step-text">
                Definí las <strong>dimensiones de referencia</strong> del hueco
                que ocupa el agregado.
              </span>
            </li>
            <li className="agregado-general__step">
              <span className="agregado-general__step-num">2</span>
              <span className="agregado-general__step-text">
                Armá las <strong>piezas</strong> de tablero: sus fórmulas usan
                las W, H y D locales de este agregado.
              </span>
            </li>
            <li className="agregado-general__step">
              <span className="agregado-general__step-num">3</span>
              <span className="agregado-general__step-text">
                Cargá los <strong>herrajes</strong>: por cantidad (solo costo) o
                posicionados (3D + perforaciones).
              </span>
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
