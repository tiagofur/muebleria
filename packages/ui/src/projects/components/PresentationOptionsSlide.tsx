/**
 * Options summary slide for client presentation (#136 enhanced).
 * Shows selected materials, edges, and hardware per item — no costs.
 * Board options show color/image swatches when catalog data allows.
 */

import { type ReactNode } from 'react';
import type {
  Catalog,
  Module,
  OptionGroup,
  Project,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveModuleMeasurePreset,
} from '@muebles/domain';
import { optionLabelForId, optionSwatchForId } from '../projectHelpers';

export type PresentationOptionsSlideProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalog: Pick<Catalog, 'materials' | 'edges' | 'hardware'>;
  readonly resolveMediaUrl?: (url: string | undefined) => string | undefined;
};

export function PresentationOptionsSlide({
  project,
  modules,
  optionGroups,
  catalog,
  resolveMediaUrl,
}: PresentationOptionsSlideProps): ReactNode {
  if (project.items.length === 0 || optionGroups.length === 0) {
    return (
      <div
        className="presentation-options presentation-options--empty"
        data-testid="presentation-options-slide"
      >
        <p className="presentation-options__empty">Sin opciones configuradas.</p>
      </div>
    );
  }

  return (
    <div className="presentation-options" data-testid="presentation-options-slide">
      <h2 className="project-presentation__section-title">Opciones seleccionadas</h2>
      <p className="project-presentation__hint project-presentation__hint--flush">
        Cada mueble incluye los materiales, cantos y herrajes elegidos para esta cotización.
      </p>

      <div className="presentation-options__grid">
        {project.items.map((item) => {
          const mod = modules.find((m) => m.id === item.moduleId);
          let measures = '';
          if (mod) {
            try {
              const preset = resolveModuleMeasurePreset(
                mod,
                item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
              );
              if (preset) {
                measures = `${preset.width} × ${preset.height} × ${preset.depth} mm`;
              } else if (mod.externalDims) {
                measures = `${mod.externalDims.width} × ${mod.externalDims.height} × ${mod.externalDims.depth} mm`;
              }
            } catch {
              if (mod.externalDims) {
                measures = `${mod.externalDims.width} × ${mod.externalDims.height} × ${mod.externalDims.depth} mm`;
              }
            }
          }

          const title = mod ? `${mod.code} — ${mod.name}` : 'Mueble';

          return (
            <div key={item.id} className="presentation-options__item">
              <div className="presentation-options__item-header">
                <h3 className="presentation-options__item-title">
                  {item.quantity}× {title}
                </h3>
                {measures ? (
                  <span className="project-presentation__item-measures">{measures}</span>
                ) : null}
              </div>

              <ul className="presentation-options__chips">
                {optionGroups.map((group) => {
                  const effectiveChoice =
                    item.optionChoices[group.code]?.trim() ||
                    project.projectLevelChoices?.[group.code]?.trim() ||
                    '';
                  if (!effectiveChoice) return null;
                  const label = optionLabelForId(effectiveChoice, group, catalog);
                  if (label === effectiveChoice) return null;
                  const swatch = optionSwatchForId(
                    effectiveChoice,
                    group,
                    catalog,
                    resolveMediaUrl,
                  );
                  return (
                    <li key={group.id} className="presentation-options__chip">
                      {swatch?.kind === 'color' ? (
                        <span
                          className="presentation-options__swatch presentation-options__swatch--color"
                          style={{ backgroundColor: swatch.color }}
                          data-testid={`presentation-option-swatch-${group.code}`}
                          title={swatch.color}
                          aria-hidden
                        />
                      ) : null}
                      {swatch?.kind === 'image' ? (
                        <span
                          className="presentation-options__swatch presentation-options__swatch--image"
                          data-testid={`presentation-option-swatch-${group.code}`}
                          aria-hidden
                        >
                          <img src={swatch.src} alt="" />
                        </span>
                      ) : null}
                      {swatch?.kind === 'edge' ? (
                        <span
                          className="presentation-options__swatch presentation-options__swatch--edge"
                          data-testid={`presentation-option-swatch-${group.code}`}
                          aria-hidden
                        />
                      ) : null}
                      {swatch?.kind === 'hardware' ? (
                        <span
                          className="presentation-options__swatch presentation-options__swatch--hardware"
                          data-testid={`presentation-option-swatch-${group.code}`}
                          aria-hidden
                        />
                      ) : null}
                      <span className="presentation-options__chip-label">{group.name}:</span>
                      <span>{label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
