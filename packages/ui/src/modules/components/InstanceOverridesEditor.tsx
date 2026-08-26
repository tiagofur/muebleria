/**
 * Collapsible per-instance formula/rotation editor for module & structure
 * component instances (slice 5). Mirrors Component Geometry "Avanzado" UX.
 */

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { Hardware, HardwarePlacement } from '@granete/domain';
import {
  instanceOverridesSummary,
  patchInstanceOverrides,
  type ComponentInstanceDraft,
} from '../moduleHelpers';
import { HardwarePlacementsEditor } from './HardwarePlacementsEditor';
import './instanceOverridesEditor.css';

export type InstanceOverridesEditorProps = {
  readonly overrides: ComponentInstanceDraft['overrides'] | undefined;
  readonly onChange: (
    next: ComponentInstanceDraft['overrides'] | undefined,
  ) => void;
  /** Suffix for test ids (e.g. instance index). */
  readonly testIdSuffix?: string;
  /** Hardware catalog for the placements editor. When omitted, the Herrajes
   * section is hidden (no hardware to position). */
  readonly catalogHardware?: readonly Hardware[];
};

export function InstanceOverridesEditor({
  overrides,
  onChange,
  testIdSuffix = '',
  catalogHardware,
}: InstanceOverridesEditorProps): ReactNode {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const tid = testIdSuffix ? `instance-overrides-${testIdSuffix}` : 'instance-overrides';
  const summary = instanceOverridesSummary(overrides);
  const hasCustom = summary !== 'automático';

  // Swap only the hardwarePlacements array, preserving formula/rotation fields.
  const handlePlacementsChange = (
    next: readonly HardwarePlacement[] | undefined,
  ) => {
    if (!next || next.length === 0) {
      if (!overrides) {
        onChange(undefined);
        return;
      }
      // Strip hardwarePlacements, keep the rest.
      const { hardwarePlacements: _omit, ...rest } = overrides;
      void _omit;
      onChange(Object.keys(rest).length > 0 ? rest : undefined);
    } else {
      onChange({ ...(overrides ?? {}), hardwarePlacements: next });
    }
  };

  // Reset clears formulas/rotation but preserves positioned hardware.
  const handleReset = () => {
    const hw = overrides?.hardwarePlacements;
    if (hw && hw.length > 0) {
      onChange({ hardwarePlacements: hw });
    } else {
      onChange(undefined);
    }
  };

  return (
    <div className="instance-overrides" data-testid={tid}>
      <button
        type="button"
        className="instance-overrides__header"
        aria-expanded={open}
        aria-controls={`${formId}-content`}
        data-testid={`${tid}-toggle`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
        )}
        <span className="instance-overrides__title">
          Avanzado: fórmulas y rotación
        </span>
        <span
          className={
            hasCustom
              ? 'instance-overrides__summary instance-overrides__summary--active'
              : 'instance-overrides__summary'
          }
          data-testid={`${tid}-summary`}
        >
          {summary}
        </span>
      </button>

      {open ? (
        <div
          id={`${formId}-content`}
          className="instance-overrides__content"
          data-testid={`${tid}-content`}
        >
          <div className="instance-overrides__actions">
            <button
              type="button"
              className="btn btn--small btn--ghost"
              disabled={!hasCustom}
              onClick={handleReset}
              data-testid={`${tid}-reset`}
            >
              <RotateCcw size={14} strokeWidth={1.5} aria-hidden />
              Restablecer a automático
            </button>
          </div>

          <p className="instance-overrides__hint">
            Vacío = del catálogo / ubicación. Variables: PW, PH, PD, T, i.
          </p>

          <div className="module-editor__grid">
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-length`}>Fórmula largo (L)</label>
              <input
                id={`${formId}-length`}
                type="text"
                value={overrides?.lengthFormula ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      lengthFormula: e.target.value,
                    }),
                  )
                }
                data-testid={`${tid}-length`}
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-width`}>Fórmula ancho (W)</label>
              <input
                id={`${formId}-width`}
                type="text"
                value={overrides?.widthFormula ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      widthFormula: e.target.value,
                    }),
                  )
                }
                data-testid={`${tid}-width`}
              />
            </div>
          </div>

          <div className="module-editor__grid">
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-x`}>Fórmula posición X</label>
              <input
                id={`${formId}-x`}
                type="text"
                value={overrides?.xFormula ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      xFormula: e.target.value,
                    }),
                  )
                }
                data-testid={`${tid}-x`}
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-y`}>Fórmula posición Y</label>
              <input
                id={`${formId}-y`}
                type="text"
                value={overrides?.yFormula ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      yFormula: e.target.value,
                    }),
                  )
                }
                data-testid={`${tid}-y`}
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-z`}>Fórmula posición Z</label>
              <input
                id={`${formId}-z`}
                type="text"
                value={overrides?.zFormula ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      zFormula: e.target.value,
                    }),
                  )
                }
                data-testid={`${tid}-z`}
              />
            </div>
          </div>

          <div className="module-editor__grid">
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-rx`}>Rotación X (°)</label>
              <input
                id={`${formId}-rx`}
                type="number"
                value={overrides?.rotateX ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      rotateX:
                        e.target.value === '' ? null : Number(e.target.value),
                    }),
                  )
                }
                data-testid={`${tid}-rotate-x`}
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-ry`}>Rotación Y (°)</label>
              <input
                id={`${formId}-ry`}
                type="number"
                value={overrides?.rotateY ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      rotateY:
                        e.target.value === '' ? null : Number(e.target.value),
                    }),
                  )
                }
                data-testid={`${tid}-rotate-y`}
              />
            </div>
            <div className="catalog-form__field">
              <label htmlFor={`${formId}-rz`}>Rotación Z (°)</label>
              <input
                id={`${formId}-rz`}
                type="number"
                value={overrides?.rotateZ ?? ''}
                placeholder="auto"
                onChange={(e) =>
                  onChange(
                    patchInstanceOverrides(overrides, {
                      rotateZ:
                        e.target.value === '' ? null : Number(e.target.value),
                    }),
                  )
                }
                data-testid={`${tid}-rotate-z`}
              />
            </div>
          </div>

        </div>
      ) : null}

      {catalogHardware && catalogHardware.length > 0 ? (
        <HardwarePlacementsEditor
          placements={overrides?.hardwarePlacements ?? []}
          catalogHardware={catalogHardware}
          onChange={handlePlacementsChange}
          testIdSuffix={testIdSuffix}
        />
      ) : null}
    </div>
  );
}
