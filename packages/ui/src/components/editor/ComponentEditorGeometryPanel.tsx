/**
 * Component editor — Geometry tab.
 */

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { ComponentDraft } from '../componentDraft';

export type ComponentEditorGeometryPanelProps = {
  readonly formId: string;
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly hidden: boolean;
};

export function ComponentEditorGeometryPanel({
  formId,
  draft,
  setDraft,
  hidden,
}: ComponentEditorGeometryPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="component-editor-panel-geometry"
      aria-labelledby="component-editor-tab-geometry"
      hidden={hidden}
      data-testid="component-editor-panel-geometry"
    >
      <p className="text-small text-muted mb-4">
        Dimensiones de la pieza de tablero rectangular.
      </p>
      <div className="module-editor__grid mb-4">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-length`}>Largo Base (mm)</label>
          <input
            id={`${formId}-length`}
            type="number"
            min={1}
            value={draft.lengthMm || ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                lengthMm: Math.max(0, Number(e.target.value)),
              }))
            }
            required
            data-testid="input-length"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-width`}>Ancho Base (mm)</label>
          <input
            id={`${formId}-width`}
            type="number"
            min={1}
            value={draft.widthMm || ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                widthMm: Math.max(0, Number(e.target.value)),
              }))
            }
            required
            data-testid="input-width"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-thickness`}>Espesor Base (mm)</label>
          <input
            id={`${formId}-thickness`}
            type="number"
            min={1}
            value={draft.thicknessMm || ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                thicknessMm: Math.max(0, Number(e.target.value)),
              }))
            }
            required
            data-testid="input-thickness"
          />
        </div>
      </div>

      <div className="module-editor__grid mb-4">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-length-formula`}>
            Fórmula de Largo (e.g. PH - 31)
          </label>
          <input
            id={`${formId}-length-formula`}
            type="text"
            value={draft.lengthFormula}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                lengthFormula: e.target.value,
              }))
            }
            placeholder="H"
            data-testid="input-length-formula"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-width-formula`}>
            Fórmula de Ancho (e.g. PW - 31)
          </label>
          <input
            id={`${formId}-width-formula`}
            type="text"
            value={draft.widthFormula}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                widthFormula: e.target.value,
              }))
            }
            placeholder="D"
            data-testid="input-width-formula"
          />
        </div>
      </div>

      <div className="module-editor__grid mb-4">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-x-formula`}>
            Fórmula Posición X (e.g. i * (PW - T))
          </label>
          <input
            id={`${formId}-x-formula`}
            type="text"
            value={draft.xFormula}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                xFormula: e.target.value,
              }))
            }
            placeholder="0"
            data-testid="input-x-formula"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-y-formula`}>Fórmula Posición Y</label>
          <input
            id={`${formId}-y-formula`}
            type="text"
            value={draft.yFormula}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                yFormula: e.target.value,
              }))
            }
            placeholder="0"
            data-testid="input-y-formula"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-z-formula`}>Fórmula Posición Z</label>
          <input
            id={`${formId}-z-formula`}
            type="text"
            value={draft.zFormula}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                zFormula: e.target.value,
              }))
            }
            placeholder="0"
            data-testid="input-z-formula"
          />
        </div>
      </div>

      <div className="module-editor__grid mb-4">
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-rotate-x`}>Rotación X (grados)</label>
          <input
            id={`${formId}-rotate-x`}
            type="number"
            value={draft.rotateX ?? ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                rotateX:
                  e.target.value === '' ? null : Number(e.target.value),
              }))
            }
            placeholder="auto"
            data-testid="input-rotate-x"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-rotate-y`}>Rotación Y (grados)</label>
          <input
            id={`${formId}-rotate-y`}
            type="number"
            value={draft.rotateY ?? ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                rotateY:
                  e.target.value === '' ? null : Number(e.target.value),
              }))
            }
            placeholder="auto"
            data-testid="input-rotate-y"
          />
        </div>
        <div className="catalog-form__field">
          <label htmlFor={`${formId}-rotate-z`}>Rotación Z (grados)</label>
          <input
            id={`${formId}-rotate-z`}
            type="number"
            value={draft.rotateZ ?? ''}
            onChange={(e) =>
              setDraft((prev) => ({
                ...prev,
                rotateZ:
                  e.target.value === '' ? null : Number(e.target.value),
              }))
            }
            placeholder="auto"
            data-testid="input-rotate-z"
          />
        </div>
      </div>
    </div>
  );
}
