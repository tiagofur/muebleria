/**
 * Structure editor — measure presets tab.
 */

import type { ReactNode } from 'react';
import type { DimensionPreset } from '@muebles/domain';
import { Plus } from 'lucide-react';

export type StructureEditorPresetsPanelProps = {
  readonly presets: readonly DimensionPreset[];
  readonly previewPresetId: string;
  readonly onPreviewPresetChange: (id: string) => void;
  readonly onAdd: () => void;
  readonly onRemove: (id: string) => void;
  readonly onUpdate: (id: string, patch: Partial<DimensionPreset>) => void;
  readonly hidden: boolean;
};

export function StructureEditorPresetsPanel({
  presets,
  previewPresetId,
  onPreviewPresetChange,
  onAdd,
  onRemove,
  onUpdate,
  hidden,
}: StructureEditorPresetsPanelProps): ReactNode {
  return (
    <div
      role="tabpanel"
      id="structure-editor-panel-presets"
      aria-labelledby="structure-editor-tab-presets"
      hidden={hidden}
    >
      <div className="structure-editor-panel-header">
        <h4 className="module-editor__section-title">
          Presets de medidas ({presets.length})
        </h4>
        <button
          type="button"
          className="btn btn--small"
          onClick={onAdd}
          data-testid="add-preset-btn"
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden /> Agregar preset
        </button>
      </div>

      {presets.length === 0 ? (
        <div className="structure-presets-empty" data-testid="presets-empty">
          Sin presets de medida. Si no hay presets, la estructura usará su
          medida fija por defecto.
        </div>
      ) : (
        <div className="structure-presets-list" data-testid="presets-list">
          {presets.map((preset, idx) => (
            <div
              key={preset.id}
              className="structure-preset-row"
              data-testid={`preset-item-${idx}`}
            >
              <div className="catalog-form__field structure-preset-row__name">
                <input
                  value={preset.name || ''}
                  onChange={(e) =>
                    onUpdate(preset.id, { name: e.target.value })
                  }
                  placeholder="Nombre (ej: Gabinete 400)"
                  data-testid={`preset-name-${idx}`}
                />
              </div>
              <div className="catalog-form__field structure-preset-row__dim">
                <input
                  type="number"
                  min={1}
                  value={preset.width || ''}
                  onChange={(e) =>
                    onUpdate(preset.id, {
                      width: Math.max(1, Number(e.target.value)),
                    })
                  }
                  placeholder="Ancho"
                  required
                  data-testid={`preset-width-${idx}`}
                />
              </div>
              <div className="catalog-form__field structure-preset-row__dim">
                <input
                  type="number"
                  min={1}
                  value={preset.height || ''}
                  onChange={(e) =>
                    onUpdate(preset.id, {
                      height: Math.max(1, Number(e.target.value)),
                    })
                  }
                  placeholder="Alto"
                  required
                  data-testid={`preset-height-${idx}`}
                />
              </div>
              <div className="catalog-form__field structure-preset-row__dim">
                <input
                  type="number"
                  min={1}
                  value={preset.depth || ''}
                  onChange={(e) =>
                    onUpdate(preset.id, {
                      depth: Math.max(1, Number(e.target.value)),
                    })
                  }
                  placeholder="Prof."
                  required
                  data-testid={`preset-depth-${idx}`}
                />
              </div>
              <button
                type="button"
                className="btn btn--small btn--danger"
                onClick={() => onRemove(preset.id)}
                data-testid={`remove-preset-${idx}`}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      {presets.length > 0 ? (
        <div
          className="structure-preset-preview"
          data-testid="preview-preset-container"
        >
          <span className="structure-preset-preview__label">
            Vista previa de estirado:
          </span>
          <select
            className="structure-preset-preview__select"
            value={previewPresetId}
            onChange={(e) => onPreviewPresetChange(e.target.value)}
            data-testid="preview-preset-select"
          >
            {presets.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name || `Preset ${pr.width}x${pr.height}x${pr.depth}`} (
                {pr.width}x{pr.height}x{pr.depth})
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
