/**
 * Module commercial measure presets + structure link (H09 / #104).
 */

import type { Structure } from '@muebles/domain';
import { Plus, Trash2 } from 'lucide-react';
import {
  emptyMeasurePresetDraft,
  type MeasurePresetDraft,
} from '../moduleHelpers';

export interface ModuleMeasureSectionProps {
  readonly structureId: string;
  readonly presets: readonly MeasurePresetDraft[];
  readonly structures: readonly Structure[];
  readonly disabled?: boolean;
  readonly onStructureIdChange: (structureId: string) => void;
  readonly onPresetsChange: (presets: MeasurePresetDraft[]) => void;
  readonly nextId: () => string;
}

export function ModuleMeasureSection({
  structureId,
  presets,
  structures,
  disabled = false,
  onStructureIdChange,
  onPresetsChange,
  nextId,
}: ModuleMeasureSectionProps) {
  const activeStructures = structures.filter((s) => s.active !== false);

  const addPreset = () => {
    onPresetsChange([...presets, emptyMeasurePresetDraft(nextId())]);
  };

  const updatePreset = (id: string, patch: Partial<MeasurePresetDraft>) => {
    onPresetsChange(
      presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };

  const removePreset = (id: string) => {
    onPresetsChange(presets.filter((p) => p.id !== id));
  };

  return (
    <div className="module-measure-section" data-testid="module-measure-section">
      <h4 className="module-editor__section-title">Medidas comerciales</h4>
      <p className="catalog-empty" style={{ marginTop: 0 }}>
        El vendedor elige de esta lista en cotización. La estructura aporta las
        fórmulas; el mueble define qué tamaños se venden.
      </p>

      <div className="catalog-form__field">
        <label htmlFor="module-structure-id">Estructura (cuerpo)</label>
        <select
          id="module-structure-id"
          value={structureId}
          disabled={disabled}
          onChange={(e) => onStructureIdChange(e.target.value)}
          data-testid="module-structure-select"
        >
          <option value="">Sin estructura (módulo fijo)</option>
          {activeStructures.map((st) => (
            <option key={st.id} value={st.id}>
              {st.name} — {st.code}
            </option>
          ))}
        </select>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.75rem',
        }}
      >
        <h5 className="module-editor__section-title" style={{ margin: 0 }}>
          Presets de medida ({presets.length})
        </h5>
        <button
          type="button"
          className="btn btn--small"
          disabled={disabled}
          onClick={addPreset}
          data-testid="module-add-preset-btn"
        >
          <Plus size={16} aria-hidden />
          Agregar
        </button>
      </div>

      {presets.length === 0 ? (
        <p className="catalog-empty" data-testid="module-presets-empty">
          Sin presets. Si el mueble usa estructura, agregá al menos un tamaño
          vendible (ej. 300 / 400 / 600 mm de ancho).
        </p>
      ) : (
        <div
          className="structure-presets-list"
          data-testid="module-presets-list"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
        >
          {presets.map((preset, idx) => (
            <div
              key={preset.id}
              style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
              data-testid={`module-preset-item-${idx}`}
            >
              <input
                type="text"
                placeholder="Nombre"
                value={preset.name}
                disabled={disabled}
                onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
                data-testid={`module-preset-name-${idx}`}
                aria-label={`Nombre preset ${idx + 1}`}
              />
              <input
                type="number"
                min={1}
                placeholder="Ancho"
                value={preset.width || ''}
                disabled={disabled}
                onChange={(e) =>
                  updatePreset(preset.id, {
                    width: Math.max(0, Number(e.target.value)),
                  })
                }
                data-testid={`module-preset-width-${idx}`}
                aria-label={`Ancho preset ${idx + 1}`}
              />
              <input
                type="number"
                min={1}
                placeholder="Alto"
                value={preset.height || ''}
                disabled={disabled}
                onChange={(e) =>
                  updatePreset(preset.id, {
                    height: Math.max(0, Number(e.target.value)),
                  })
                }
                data-testid={`module-preset-height-${idx}`}
                aria-label={`Alto preset ${idx + 1}`}
              />
              <input
                type="number"
                min={1}
                placeholder="Fondo"
                value={preset.depth || ''}
                disabled={disabled}
                onChange={(e) =>
                  updatePreset(preset.id, {
                    depth: Math.max(0, Number(e.target.value)),
                  })
                }
                data-testid={`module-preset-depth-${idx}`}
                aria-label={`Fondo preset ${idx + 1}`}
              />
              <button
                type="button"
                className="btn btn--small btn--danger"
                disabled={disabled}
                onClick={() => removePreset(preset.id)}
                data-testid={`module-remove-preset-${idx}`}
                aria-label={`Quitar preset ${idx + 1}`}
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
