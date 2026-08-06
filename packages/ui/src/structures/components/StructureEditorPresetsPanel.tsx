/**
 * Structure editor — measure presets tab.
 * Critique: labeled columns, blur validation, copy from exterior dims.
 */

import { useState, type ReactNode } from 'react';
import type { DimensionPreset } from '@muebles/domain';
import { Plus } from 'lucide-react';

export type StructureEditorPresetsPanelProps = {
  readonly presets: readonly DimensionPreset[];
  readonly exteriorDims: {
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
  /** Preview measure selector lives only next to live 3D (Components tab). */
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (id: string, patch: Partial<DimensionPreset>) => void;
  readonly hidden: boolean;
};

type DimKey = 'width' | 'height' | 'depth';
type DimErrors = Partial<Record<string, Partial<Record<DimKey, string>>>>;

export function StructureEditorPresetsPanel({
  presets,
  exteriorDims,
  onAdd,
  onRemove,
  onUpdate,
  hidden,
}: StructureEditorPresetsPanelProps): ReactNode {
  const [dimErrors, setDimErrors] = useState<DimErrors>({});
  const canCopyExterior =
    exteriorDims.width > 0 &&
    exteriorDims.height > 0 &&
    exteriorDims.depth > 0;

  const validateDim = (
    presetId: string,
    key: DimKey,
    label: string,
    value: number,
  ) => {
    const invalid = Number.isNaN(value) || value <= 0;
    setDimErrors((prev) => ({
      ...prev,
      [presetId]: {
        ...prev[presetId],
        [key]: invalid ? `${label} debe ser mayor a 0.` : undefined,
      },
    }));
  };

  const copyExteriorInto = (presetId: string) => {
    onUpdate(presetId, {
      width: exteriorDims.width,
      height: exteriorDims.height,
      depth: exteriorDims.depth,
    });
    setDimErrors((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
  };

  return (
    <div
      role="tabpanel"
      id="structure-editor-panel-presets"
      aria-labelledby="structure-editor-tab-presets"
      hidden={hidden}
      data-testid="structure-editor-panel-presets"
    >
      <div className="structure-editor-panel-header">
        <h4 className="module-editor__section-title">
          Presets de medidas ({presets.length})
        </h4>
        <button
          type="button"
          className="btn btn--small btn--primary"
          onClick={onAdd}
          data-testid="add-preset-btn"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar preset
        </button>
      </div>

      <p className="catalog-form__hint">
        Variantes de estirado para preview 3D e ingeniería. No son la lista
        comercial del mueble (eso vive en Muebles).
      </p>

      {presets.length === 0 ? (
        <div className="structure-presets-empty" data-testid="presets-empty">
          Sin presets de medida. Si no hay presets, la estructura usará su
          medida exterior (General) como referencia.
        </div>
      ) : (
        <div className="structure-presets-list" data-testid="presets-list">
          <div
            className="structure-preset-row structure-preset-row--head"
            aria-hidden
          >
            <span className="structure-preset-row__name">Nombre</span>
            <span className="structure-preset-row__dim">Ancho</span>
            <span className="structure-preset-row__dim">Alto</span>
            <span className="structure-preset-row__dim">Prof.</span>
            <span className="structure-preset-row__actions" />
          </div>
          {presets.map((preset, idx) => {
            const err = dimErrors[preset.id] ?? {};
            return (
              <div
                key={preset.id}
                className="structure-preset-row"
                data-testid={`preset-item-${idx}`}
              >
                <div className="catalog-form__field structure-preset-row__name">
                  <label className="structure-preset-row__sr" htmlFor={`preset-name-${idx}`}>
                    Nombre
                  </label>
                  <input
                    id={`preset-name-${idx}`}
                    value={preset.name || ''}
                    onChange={(e) =>
                      onUpdate(preset.id, { name: e.target.value })
                    }
                    placeholder="Ej: Gabinete 400"
                    data-testid={`preset-name-${idx}`}
                  />
                </div>
                <div
                  className={`catalog-form__field structure-preset-row__dim${err.width ? ' catalog-form__field--error' : ''}`}
                >
                  <label
                    className="structure-preset-row__sr"
                    htmlFor={`preset-width-${idx}`}
                  >
                    Ancho (mm)
                  </label>
                  <input
                    id={`preset-width-${idx}`}
                    type="number"
                    min={1}
                    value={preset.width || ''}
                    onChange={(e) =>
                      onUpdate(preset.id, {
                        width: Math.max(0, Number(e.target.value)),
                      })
                    }
                    onBlur={() =>
                      validateDim(
                        preset.id,
                        'width',
                        'Ancho',
                        preset.width,
                      )
                    }
                    aria-invalid={err.width ? true : undefined}
                    required
                    data-testid={`preset-width-${idx}`}
                  />
                  {err.width ? (
                    <p className="catalog-form__error-text">{err.width}</p>
                  ) : null}
                </div>
                <div
                  className={`catalog-form__field structure-preset-row__dim${err.height ? ' catalog-form__field--error' : ''}`}
                >
                  <label
                    className="structure-preset-row__sr"
                    htmlFor={`preset-height-${idx}`}
                  >
                    Alto (mm)
                  </label>
                  <input
                    id={`preset-height-${idx}`}
                    type="number"
                    min={1}
                    value={preset.height || ''}
                    onChange={(e) =>
                      onUpdate(preset.id, {
                        height: Math.max(0, Number(e.target.value)),
                      })
                    }
                    onBlur={() =>
                      validateDim(
                        preset.id,
                        'height',
                        'Alto',
                        preset.height,
                      )
                    }
                    aria-invalid={err.height ? true : undefined}
                    required
                    data-testid={`preset-height-${idx}`}
                  />
                  {err.height ? (
                    <p className="catalog-form__error-text">{err.height}</p>
                  ) : null}
                </div>
                <div
                  className={`catalog-form__field structure-preset-row__dim${err.depth ? ' catalog-form__field--error' : ''}`}
                >
                  <label
                    className="structure-preset-row__sr"
                    htmlFor={`preset-depth-${idx}`}
                  >
                    Profundidad (mm)
                  </label>
                  <input
                    id={`preset-depth-${idx}`}
                    type="number"
                    min={1}
                    value={preset.depth || ''}
                    onChange={(e) =>
                      onUpdate(preset.id, {
                        depth: Math.max(0, Number(e.target.value)),
                      })
                    }
                    onBlur={() =>
                      validateDim(preset.id, 'depth', 'Profundidad', preset.depth)
                    }
                    aria-invalid={err.depth ? true : undefined}
                    required
                    data-testid={`preset-depth-${idx}`}
                  />
                  {err.depth ? (
                    <p className="catalog-form__error-text">{err.depth}</p>
                  ) : null}
                </div>
                <div className="structure-preset-row__actions">
                  {canCopyExterior ? (
                    <button
                      type="button"
                      className="btn btn--small btn--ghost"
                      onClick={() => copyExteriorInto(preset.id)}
                      data-testid={`preset-copy-exterior-${idx}`}
                      title="Copiar ancho/alto/prof. exterior de General"
                    >
                      Desde exterior
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => onRemove(preset.id)}
                    data-testid={`remove-preset-${idx}`}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {presets.length > 0 ? (
        <p className="catalog-form__hint" data-testid="presets-preview-hint">
          La medida de prueba del 3D se elige en la pestaña Componentes, junto a
          la vista en vivo.
        </p>
      ) : null}
    </div>
  );
}
