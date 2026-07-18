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
      <div
        className="module-editor__parts-header mb-4"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h4 className="module-editor__section-title" style={{ margin: 0 }}>
          Presets de Medidas Permitidas ({presets.length})
        </h4>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={onAdd}
          data-testid="add-preset-btn"
        >
          <Plus size={14} className="mr-1" /> Agregar Preset
        </button>
      </div>

      {presets.length === 0 ? (
        <div
          className="module-parts-empty"
          data-testid="presets-empty"
          style={{
            fontStyle: 'italic',
            color: 'var(--text-muted)',
            padding: '2rem 1rem',
            textAlign: 'center',
            border: '1px dashed var(--border-default)',
            borderRadius: '8px',
          }}
        >
          Sin presets de medida. Si no hay presets, la estructura usará su
          medida fija por defecto.
        </div>
      ) : (
        <div
          className="structure-presets-list"
          data-testid="presets-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            marginBottom: '1.5rem',
            background: 'var(--surface-card)',
            padding: '1rem',
            borderRadius: '8px',
            border: '1px solid var(--border-default)',
          }}
        >
          {presets.map((preset, idx) => (
            <div
              key={preset.id}
              style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
              data-testid={`preset-item-${idx}`}
            >
              <div
                className="catalog-form__field"
                style={{ flex: 2, marginBottom: 0 }}
              >
                <input
                  value={preset.name || ''}
                  onChange={(e) => onUpdate(preset.id, { name: e.target.value })}
                  placeholder="Nombre (ej: Gabinete 400)"
                  data-testid={`preset-name-${idx}`}
                />
              </div>
              <div
                className="catalog-form__field"
                style={{ flex: 1, marginBottom: 0 }}
              >
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
              <div
                className="catalog-form__field"
                style={{ flex: 1, marginBottom: 0 }}
              >
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
              <div
                className="catalog-form__field"
                style={{ flex: 1, marginBottom: 0 }}
              >
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
          className="alert alert--info mb-4"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '0.75rem 1rem',
          }}
          data-testid="preview-preset-container"
        >
          <span style={{ fontWeight: '500' }}>Vista previa de estirado:</span>
          <select
            value={previewPresetId}
            onChange={(e) => onPreviewPresetChange(e.target.value)}
            style={{
              padding: '0.25rem 0.5rem',
              borderRadius: '4px',
              border: '1px solid var(--border-default)',
              background: 'var(--surface-app)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
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
