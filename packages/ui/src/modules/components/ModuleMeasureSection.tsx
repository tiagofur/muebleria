/**
 * Additional commercial measure options for a Module (H09 / #104).
 * Base measure lives in General → Medida base (externalDims).
 */

import { Plus, Trash2 } from 'lucide-react';
import {
  emptyMeasurePresetDraft,
  type MeasurePresetDraft,
} from '../moduleHelpers';

export interface ModuleMeasureSectionProps {
  readonly presets: readonly MeasurePresetDraft[];
  readonly disabled?: boolean;
  readonly onPresetsChange: (presets: MeasurePresetDraft[]) => void;
  readonly nextId: () => string;
  readonly onImportFromStructure?: () => void;
  readonly canImportFromStructure?: boolean;
  readonly onSeedFromBase?: () => void;
  readonly canSeedFromBase?: boolean;
}

export function ModuleMeasureSection({
  presets,
  disabled = false,
  onPresetsChange,
  nextId,
  onImportFromStructure,
  canImportFromStructure = false,
  onSeedFromBase,
  canSeedFromBase = false,
}: ModuleMeasureSectionProps) {
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
          marginBottom: '0.5rem',
          marginTop: '1rem',
        }}
      >
        <h5 className="module-editor__section-title" style={{ margin: 0 }}>
          Más medidas para cotización ({presets.length})
        </h5>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {canSeedFromBase && onSeedFromBase ? (
            <button
              type="button"
              className="btn btn--small"
              disabled={disabled}
              onClick={onSeedFromBase}
              data-testid="module-seed-base-preset-btn"
            >
              Incluir medida base
            </button>
          ) : null}
          {canImportFromStructure && onImportFromStructure ? (
            <button
              type="button"
              className="btn btn--small"
              disabled={disabled}
              onClick={onImportFromStructure}
              data-testid="module-import-structure-presets-btn"
            >
              Importar de estructura
            </button>
          ) : null}
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
      </div>
      <p className="catalog-empty" style={{ marginTop: 0 }}>
        Opcional. Si no agregás nada, se cotiza solo con la medida base. Si
        agregás opciones, el vendedor elige entre ellas en la cotización (incluí
        la base acá si también querés venderla como opción de la lista).
      </p>

      {presets.length === 0 ? (
        <p className="catalog-empty" data-testid="module-presets-empty">
          Sin medidas extra. Un solo tamaño: la medida base de arriba.
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
                aria-label={`Nombre medida ${idx + 1}`}
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
                aria-label={`Ancho medida ${idx + 1}`}
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
                aria-label={`Alto medida ${idx + 1}`}
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
                aria-label={`Fondo medida ${idx + 1}`}
              />
              <button
                type="button"
                className="btn btn--small btn--danger"
                disabled={disabled}
                onClick={() => removePreset(preset.id)}
                data-testid={`module-remove-preset-${idx}`}
                aria-label={`Quitar medida ${idx + 1}`}
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
