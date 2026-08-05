/**
 * Component editor — Geometry tab.
 *
 * Hosts the live 3D preview of the component so the carpenter sees the piece as
 * they edit dimensions/position/rotation, without a separate "Vista 3D" tab.
 * The toggle "Mostrar en el mueble" frames the piece inside a ghost container
 * (PW×PH×PD) so position formulas (X/Y/Z) become visible in context.
 */

import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { ChevronDown, ChevronRight, Lightbulb, RotateCcw } from 'lucide-react';
import type { PlacementDims, ResolvedBoardPart } from '@muebles/domain';
import type {
  MaterialColorLookup,
  MaterialTextureLookup,
} from '../../preview3d';
import { FurnitureScene3D } from '../../preview3d';
import type { ComponentDraft } from '../componentDraft';

export type ComponentEditorGeometryPanelProps = {
  readonly formId: string;
  readonly draft: ComponentDraft;
  readonly setDraft: Dispatch<SetStateAction<ComponentDraft>>;
  readonly hidden: boolean;
  readonly previewParts: readonly ResolvedBoardPart[];
  readonly materialColors?: MaterialColorLookup;
  readonly materialTextures?: MaterialTextureLookup;
  readonly containerDims: PlacementDims;
  readonly onContainerDimsChange: (dims: PlacementDims) => void;
  readonly showInContext: boolean;
  readonly onShowInContextChange: (v: boolean) => void;
};

function FieldGroup({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <fieldset className="component-geometry__group">
      <legend className="component-geometry__group-title">
        {title}
        {hint ? <span className="component-geometry__group-hint">{hint}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}

/** Live summary of the position + rotation state, shown in the disclosure header. */
function advancedSummary(draft: ComponentDraft): string {
  // Position: list non-empty formulas, else "automática".
  const posParts: string[] = [];
  if (draft.xFormula.trim()) posParts.push(`X=${draft.xFormula.trim()}`);
  if (draft.yFormula.trim()) posParts.push(`Y=${draft.yFormula.trim()}`);
  if (draft.zFormula.trim()) posParts.push(`Z=${draft.zFormula.trim()}`);
  const posText = posParts.length ? posParts.join(', ') : 'automática';

  // Rotation: list non-null rotates, else "automática".
  const rotParts: string[] = [];
  if (draft.rotateX !== null) rotParts.push(`X=${draft.rotateX}°`);
  if (draft.rotateY !== null) rotParts.push(`Y=${draft.rotateY}°`);
  if (draft.rotateZ !== null) rotParts.push(`Z=${draft.rotateZ}°`);
  const rotText = rotParts.length ? rotParts.join(', ') : 'automática';

  return `Posición: ${posText} · Rotación: ${rotText}`;
}

export function ComponentEditorGeometryPanel({
  formId,
  draft,
  setDraft,
  hidden,
  previewParts,
  materialColors,
  materialTextures,
  containerDims,
  onContainerDimsChange,
  showInContext,
  onShowInContextChange,
}: ComponentEditorGeometryPanelProps): ReactNode {
  // Position + Rotation are advanced; collapsed by default so a first-time
  // carpenter sees only the base dimensions, size formulas, and the 3D preview.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showOutlines, setShowOutlines] = useState(true);

  // Inline dimension validation (P1): validate on blur, never coerce silently.
  // A wrong mm is the workshop's most expensive mistake — surface it at the
  // field instead of swallowing -5/abc into 0 and failing generically on save.
  type DimErrors = { length?: string; width?: string; thickness?: string };
  const [dimErrors, setDimErrors] = useState<DimErrors>({});

  const validateDim = (key: keyof DimErrors, label: string, v: number) => {
    const invalid = Number.isNaN(v) || v <= 0;
    setDimErrors((prev) => ({
      ...prev,
      [key]: invalid ? `El ${label} debe ser mayor a 0.` : undefined,
    }));
  };

  return (
    <div
      role="tabpanel"
      id="component-editor-panel-geometry"
      aria-labelledby="component-editor-tab-geometry"
      hidden={hidden}
      data-testid="component-editor-panel-geometry"
    >
      <div className="component-geometry__formula-guide" data-testid="formula-vars-guide">
        <p className="component-geometry__formula-guide-title">
          <Lightbulb size={14} strokeWidth={1.5} aria-hidden />
          Variables disponibles para fórmulas (matemática estándar +, -, *, /, ())
        </p>
        <div className="component-geometry__formula-vars">
          <span title="Ancho total del contenedor/mueble"><code>PW</code>: Ancho Mueble</span>
          <span title="Alto total del contenedor/mueble"><code>PH</code>: Alto Mueble</span>
          <span title="Profundidad del contenedor/mueble"><code>PD</code>: Profundidad</span>
          <span title="Espesor del tablero"><code>T</code>: Espesor</span>
          <span title="Índice de la copia (0, 1, 2...)"><code>i</code>: Índice Copia</span>
        </div>
      </div>

      <FieldGroup title="Dimensiones base" hint="tamaño fijo de la placa cuando no hay fórmula">
        <div className="module-editor__grid">
          <div className={`catalog-form__field${dimErrors.length ? ' catalog-form__field--error' : ''}`}>
            <label htmlFor={`${formId}-length`}>Largo Base (mm)</label>
            <input
              id={`${formId}-length`}
              type="number"
              min={1}
              value={draft.lengthMm || ''}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  lengthMm: Number(e.target.value) || 0,
                }))
              }
              onBlur={() => validateDim('length', 'largo', draft.lengthMm)}
              aria-invalid={dimErrors.length ? true : undefined}
              required
              data-testid="input-length"
            />
            {dimErrors.length ? (
              <p className="catalog-form__error-text" data-testid="input-length-error">
                {dimErrors.length}
              </p>
            ) : null}
          </div>
          <div className={`catalog-form__field${dimErrors.width ? ' catalog-form__field--error' : ''}`}>
            <label htmlFor={`${formId}-width`}>Ancho Base (mm)</label>
            <input
              id={`${formId}-width`}
              type="number"
              min={1}
              value={draft.widthMm || ''}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  widthMm: Number(e.target.value) || 0,
                }))
              }
              onBlur={() => validateDim('width', 'ancho', draft.widthMm)}
              aria-invalid={dimErrors.width ? true : undefined}
              required
              data-testid="input-width"
            />
            {dimErrors.width ? (
              <p className="catalog-form__error-text" data-testid="input-width-error">
                {dimErrors.width}
              </p>
            ) : null}
          </div>
          <div className={`catalog-form__field${dimErrors.thickness ? ' catalog-form__field--error' : ''}`}>
            <label htmlFor={`${formId}-thickness`}>Espesor Base (mm)</label>
            <input
              id={`${formId}-thickness`}
              type="number"
              min={1}
              value={draft.thicknessMm || ''}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  thicknessMm: Number(e.target.value) || 0,
                }))
              }
              onBlur={() => validateDim('thickness', 'espesor', draft.thicknessMm)}
              aria-invalid={dimErrors.thickness ? true : undefined}
              required
              data-testid="input-thickness"
            />
            {dimErrors.thickness ? (
              <p className="catalog-form__error-text" data-testid="input-thickness-error">
                {dimErrors.thickness}
              </p>
            ) : null}
          </div>
        </div>
      </FieldGroup>

      <FieldGroup title="Fórmulas de tamaño" hint="si se setean, reemplazan a las dimensiones base">
        <div className="module-editor__grid">
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
              placeholder="PH"
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
              placeholder="PD"
              data-testid="input-width-formula"
            />
          </div>
        </div>
      </FieldGroup>

      <div className="component-geometry__advanced">
        <button
          type="button"
          className="component-geometry__advanced-header"
          aria-expanded={advancedOpen}
          aria-controls="component-geometry-advanced-content"
          data-testid="component-geometry-advanced-toggle"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? (
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
          )}
          <span className="component-geometry__advanced-title">
            Avanzado: posición y rotación
          </span>
          <span className="component-geometry__advanced-summary">
            {advancedSummary(draft)}
          </span>
        </button>

        {advancedOpen ? (
          <div
            id="component-geometry-advanced-content"
            className="component-geometry__advanced-content"
          >
            <div className="component-geometry__advanced-actions">
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    xFormula: '',
                    yFormula: '',
                    zFormula: '',
                    rotateX: null,
                    rotateY: null,
                    rotateZ: null,
                  }))
                }
                data-testid="component-geometry-advanced-reset"
              >
                <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
                Restablecer a automático
              </button>
            </div>

            <FieldGroup title="Posición en el mueble" hint="dónde va la pieza dentro del contenedor">
              <div className="module-editor__grid">
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
                    placeholder="auto"
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
                    placeholder="auto"
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
                    placeholder="auto"
                    data-testid="input-z-formula"
                  />
                </div>
              </div>
            </FieldGroup>

            <FieldGroup title="Rotación" hint="vacío = automática según la ubicación; 0 es válido">
              <div className="module-editor__grid">
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
            </FieldGroup>
          </div>
        ) : null}
      </div>

      <div className="component-geometry__preview">
        <div className="component-geometry__preview-bar">
          <div className="component-geometry__container-fields">
            <span className="component-geometry__container-label">
              Mueble de referencia:
            </span>
            <label className="component-geometry__container-field">
              <span>Ancho</span>
              <input
                type="number"
                min={1}
                value={Math.round(containerDims.PW)}
                onChange={(e) =>
                  onContainerDimsChange({
                    ...containerDims,
                    PW: Math.max(1, Number(e.target.value)),
                  })
                }
                data-testid="container-pw"
              />
            </label>
            <label className="component-geometry__container-field">
              <span>Alto</span>
              <input
                type="number"
                min={1}
                value={Math.round(containerDims.PH)}
                onChange={(e) =>
                  onContainerDimsChange({
                    ...containerDims,
                    PH: Math.max(1, Number(e.target.value)),
                  })
                }
                data-testid="container-ph"
              />
            </label>
            <label className="component-geometry__container-field">
              <span>Prof.</span>
              <input
                type="number"
                min={1}
                value={Math.round(containerDims.PD)}
                onChange={(e) =>
                  onContainerDimsChange({
                    ...containerDims,
                    PD: Math.max(1, Number(e.target.value)),
                  })
                }
                data-testid="container-pd"
              />
            </label>
          </div>
          <label className="component-geometry__toggle">
            <input
              type="checkbox"
              checked={showInContext}
              onChange={(e) => onShowInContextChange(e.target.checked)}
              data-testid="show-in-context-toggle"
            />
            <span>Mostrar en el mueble</span>
          </label>
          <label className="component-geometry__toggle">
            <input
              type="checkbox"
              checked={showOutlines}
              onChange={(e) => setShowOutlines(e.target.checked)}
              data-testid="component-geometry-outlines-toggle"
            />
            <span>Contornos</span>
          </label>
        </div>

        <FurnitureScene3D
          modules={[
            {
              key: 'component-preview',
              parts: previewParts,
              width: containerDims.PW,
              height: containerDims.PH,
              depth: containerDims.PD,
              originX: 0,
              originY: 0,
              originZ: 0,
              showOuterGhost: showInContext,
            },
          ]}
          totalWidth={containerDims.PW}
          totalHeight={containerDims.PH}
          totalDepth={containerDims.PD}
          showFloor={false}
          colorMode="material"
          materialColors={materialColors}
          materialTextures={materialTextures}
          showOutlines={showOutlines}
          testId="component-geometry-3d"
        />
      </div>
    </div>
  );
}
