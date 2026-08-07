/**
 * Options summary slide for client presentation (#136 enhanced).
 * Shows selected materials, edges, and hardware per item — no costs.
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
import { optionLabelForId } from '../projectHelpers';

export type PresentationOptionsSlideProps = {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly optionGroups: readonly OptionGroup[];
  readonly catalog: Pick<Catalog, 'materials' | 'edges' | 'hardware'>;
};

export function PresentationOptionsSlide({
  project,
  modules,
  optionGroups,
  catalog,
}: PresentationOptionsSlideProps): ReactNode {
  if (project.items.length === 0 || optionGroups.length === 0) {
    return (
      <div className="catalog-empty" style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <p>Sin opciones configuradas.</p>
      </div>
    );
  }

  return (
    <div className="presentation-options" data-testid="presentation-options-slide">
      <h2 className="project-presentation__section-title">Opciones seleccionadas</h2>
      <p className="project-presentation__hint" style={{ marginTop: 0 }}>
        Cada mueble incluye los materiales, cantos y herrajes elegidos para esta cotización.
      </p>

      <div className="presentation-options__grid" style={{
        display: 'grid',
        gap: '1.5rem',
        marginTop: '1rem',
      }}>
        {project.items.map((item) => {
          const mod = modules.find((m) => m.id === item.moduleId);
          let measures = '';
          if (mod) {
            try {
              const preset = resolveModuleMeasurePreset(
                mod,
                item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
              );
              if (preset) measures = `${preset.width} × ${preset.height} × ${preset.depth} mm`;
              else if (mod.externalDims) measures = `${mod.externalDims.width} × ${mod.externalDims.height} × ${mod.externalDims.depth} mm`;
            } catch {
              if (mod.externalDims) measures = `${mod.externalDims.width} × ${mod.externalDims.height} × ${mod.externalDims.depth} mm`;
            }
          }

          const title = mod ? `${mod.code} — ${mod.name}` : 'Mueble';

          return (
            <div key={item.id} className="presentation-options__item" style={{
              padding: '1rem',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-card)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                  {item.quantity}× {title}
                </h3>
                {measures ? (
                  <span className="project-presentation__item-measures" style={{ fontSize: '0.85rem' }}>
                    {measures}
                  </span>
                ) : null}
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {optionGroups.map((group) => {
                  const effectiveChoice = item.optionChoices[group.code]?.trim()
                    || project.projectLevelChoices?.[group.code]?.trim()
                    || '';
                  if (!effectiveChoice) return null;
                  const label = optionLabelForId(effectiveChoice, group, catalog);
                  if (label === effectiveChoice) return null; // skip unresolved IDs
                  return (
                    <li key={group.id} style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '0.25rem 0.6rem',
                      background: 'var(--surface-muted)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                    }}>
                      <span style={{ fontWeight: 500 }}>{group.name}:</span>
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
