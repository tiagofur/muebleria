/**
 * Component editor — Geometry tab.
 *
 * Layout: form column + sticky 3D viewport (desktop). Formula guide
 * collapsed by default; opens on demand or when focusing a formula field.
 */

import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import type { PlacementDims, ResolvedBoardPart } from '@muebles/domain';
import type {
  MaterialColorLookup,
  MaterialTextureLookup,
} from '../../preview3d';
import type { ComponentDraft } from '../componentDraft';
import { ComponentGeometry3DViewport } from './ComponentGeometry3DViewport';
import { ComponentFormulaGuide } from './ComponentFormulaGuide';

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
        {hint ? (
          <span className="component-geometry__group-hint">{hint}</span>
        ) : null}
      </legend>
      {children}
    </fieldset>
  );
}

function advancedSummary(draft: ComponentDraft): string {
  const posParts: string[] = [];
  if (draft.xFormula.trim()) posParts.push(`X=${draft.xFormula.trim()}`);
  if (draft.yFormula.trim()) posParts.push(`Y=${draft.yFormula.trim()}`);
  if (draft.zFormula.trim()) posParts.push(`Z=${draft.zFormula.trim()}`);
  const posText = posParts.length ? posParts.join(', ') : 'automática';

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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  type DimErrors = { length?: string; width?: string; thickness?: string };
  const [dimErrors, setDimErrors] = useState<DimErrors>({});

  const validateDim = (key: keyof DimErrors, label: string, v: number) => {
    const invalid = Number.isNaN(v) || v <= 0;
    setDimErrors((prev) => ({
      ...prev,
      [key]: invalid ? `El ${label} debe ser mayor a 0.` : undefined,
    }));
  };

  // Clear stale length/width dim errors once a formula replaces the base (R3-S3).
  useEffect(() => {
    if (!draft.lengthFormula.trim()) return;
    setDimErrors((prev) =>
      prev.length ? { ...prev, length: undefined } : prev,
    );
  }, [draft.lengthFormula]);

  useEffect(() => {
    if (!draft.widthFormula.trim()) return;
    setDimErrors((prev) =>
      prev.width ? { ...prev, width: undefined } : prev,
    );
  }, [draft.widthFormula]);

  const openGuideOnFormulaFocus = () => {
    setGuideOpen(true);
  };

  return (
    <div
      role="tabpanel"
      id="component-editor-panel-geometry"
      aria-labelledby="component-editor-tab-geometry"
      hidden={hidden}
      data-testid="component-editor-panel-geometry"
    >
      <div className="component-geometry__workspace">
        <div className="component-geometry__form">
          <ComponentFormulaGuide
            guideOpen={guideOpen}
            onToggle={() => setGuideOpen((v) => !v)}
          />

          <FieldGroup
            title="Dimensiones base"
            hint="tamaño fijo de la placa cuando no hay fórmula"
          >
            <div className="component-editor__grid">
              <div
                className={`catalog-form__field${dimErrors.length ? ' catalog-form__field--error' : ''}`}
              >
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
                  onBlur={() => {
                    if (!draft.lengthFormula.trim()) {
                      validateDim('length', 'largo', draft.lengthMm);
                    }
                  }}
                  aria-invalid={dimErrors.length ? true : undefined}
                  required={!draft.lengthFormula.trim()}
                  data-testid="input-length"
                />
                {dimErrors.length ? (
                  <p
                    className="catalog-form__error-text"
                    data-testid="input-length-error"
                  >
                    {dimErrors.length}
                  </p>
                ) : null}
              </div>
              <div
                className={`catalog-form__field${dimErrors.width ? ' catalog-form__field--error' : ''}`}
              >
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
                  onBlur={() => {
                    if (!draft.widthFormula.trim()) {
                      validateDim('width', 'ancho', draft.widthMm);
                    }
                  }}
                  aria-invalid={dimErrors.width ? true : undefined}
                  required={!draft.widthFormula.trim()}
                  data-testid="input-width"
                />
                {dimErrors.width ? (
                  <p
                    className="catalog-form__error-text"
                    data-testid="input-width-error"
                  >
                    {dimErrors.width}
                  </p>
                ) : null}
              </div>
              <div
                className={`catalog-form__field${dimErrors.thickness ? ' catalog-form__field--error' : ''}`}
              >
                <label htmlFor={`${formId}-thickness`}>
                  Espesor Base (mm)
                </label>
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
                  onBlur={() =>
                    validateDim('thickness', 'espesor', draft.thicknessMm)
                  }
                  aria-invalid={dimErrors.thickness ? true : undefined}
                  required
                  data-testid="input-thickness"
                />
                {dimErrors.thickness ? (
                  <p
                    className="catalog-form__error-text"
                    data-testid="input-thickness-error"
                  >
                    {dimErrors.thickness}
                  </p>
                ) : null}
              </div>
            </div>
          </FieldGroup>

          <FieldGroup
            title="Fórmulas de tamaño"
            hint="si se setean, reemplazan a las dimensiones base"
          >
            <div className="component-editor__grid">
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-length-formula`}>
                  Fórmula de Largo (ej. PH - 31)
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
                  onFocus={openGuideOnFormulaFocus}
                  placeholder="PH"
                  data-testid="input-length-formula"
                />
              </div>
              <div className="catalog-form__field">
                <label htmlFor={`${formId}-width-formula`}>
                  Fórmula de Ancho (ej. PW - 31)
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
                  onFocus={openGuideOnFormulaFocus}
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

                <FieldGroup
                  title="Posición en el mueble"
                  hint="dónde va la pieza dentro del contenedor"
                >
                  <div className="component-editor__grid">
                    <div className="catalog-form__field">
                      <label htmlFor={`${formId}-x-formula`}>
                        Fórmula Posición X (ej. i * (PW - T))
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
                        onFocus={openGuideOnFormulaFocus}
                        placeholder="auto"
                        data-testid="input-x-formula"
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label htmlFor={`${formId}-y-formula`}>
                        Fórmula Posición Y
                      </label>
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
                        onFocus={openGuideOnFormulaFocus}
                        placeholder="auto"
                        data-testid="input-y-formula"
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label htmlFor={`${formId}-z-formula`}>
                        Fórmula Posición Z
                      </label>
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
                        onFocus={openGuideOnFormulaFocus}
                        placeholder="auto"
                        data-testid="input-z-formula"
                      />
                    </div>
                  </div>
                </FieldGroup>

                <FieldGroup
                  title="Rotación"
                  hint="vacío = automática según la ubicación; 0 es válido"
                >
                  <div className="component-editor__grid">
                    <div className="catalog-form__field">
                      <label htmlFor={`${formId}-rotate-x`}>
                        Rotación X (grados)
                      </label>
                      <input
                        id={`${formId}-rotate-x`}
                        type="number"
                        value={draft.rotateX ?? ''}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            rotateX:
                              e.target.value === ''
                                ? null
                                : Number(e.target.value),
                          }))
                        }
                        placeholder="auto"
                        data-testid="input-rotate-x"
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label htmlFor={`${formId}-rotate-y`}>
                        Rotación Y (grados)
                      </label>
                      <input
                        id={`${formId}-rotate-y`}
                        type="number"
                        value={draft.rotateY ?? ''}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            rotateY:
                              e.target.value === ''
                                ? null
                                : Number(e.target.value),
                          }))
                        }
                        placeholder="auto"
                        data-testid="input-rotate-y"
                      />
                    </div>
                    <div className="catalog-form__field">
                      <label htmlFor={`${formId}-rotate-z`}>
                        Rotación Z (grados)
                      </label>
                      <input
                        id={`${formId}-rotate-z`}
                        type="number"
                        value={draft.rotateZ ?? ''}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            rotateZ:
                              e.target.value === ''
                                ? null
                                : Number(e.target.value),
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
        </div>

        <ComponentGeometry3DViewport
          previewParts={previewParts}
          materialColors={materialColors}
          materialTextures={materialTextures}
          containerDims={containerDims}
          onContainerDimsChange={onContainerDimsChange}
          showInContext={showInContext}
          onShowInContextChange={onShowInContextChange}
          hidden={hidden}
        />
      </div>
    </div>
  );
}
