/**
 * Project measure defaults section — extracted from ProjectDetailViewInner (#refactor).
 *
 * Renders depth/height defaults per furniture type (inferior/superior/alto)
 * so the add-item modal can pre-select the closest preset automatically.
 */

import { memo, type ReactNode } from 'react';
import type { FurnitureType, Project } from '@muebles/domain';
import { isProjectClosed } from '@muebles/domain';
import { useProjectDetail } from './projectDetailContext';

const TYPE_LABELS: Record<FurnitureType, string> = {
  inferior: 'Inferiores (gabinetes)',
  superior: 'Superiores (alacenas)',
  alto: 'Altos (despensas)',
};

export const ProjectMeasureDefaults = memo(function ProjectMeasureDefaults(): ReactNode {
  const { project, modules, onUpdateMeasureDefaults } = useProjectDetail();

  if (!onUpdateMeasureDefaults || isProjectClosed(project.status)) {
    return null;
  }

  const typesInUse = Array.from(
    new Set(modules.map((m) => m.furnitureType ?? 'inferior')),
  ) as FurnitureType[];

  if (typesInUse.length === 0) return null;

  const handleUpdate = (
    type: FurnitureType,
    field: 'depth' | 'height',
    value: string,
  ) => {
    const prev = { ...(project.measureDefaults ?? {}) } as Record<
      FurnitureType,
      { depth?: number; height?: number } | undefined
    >;
    const typeEntry = prev[type] ? { ...prev[type]! } : {};
    const parsed = value.trim() === '' ? undefined : Number(value);

    if (field === 'depth') {
      if (parsed === undefined || Number.isNaN(parsed))
        delete typeEntry.depth;
      else typeEntry.depth = parsed;
    } else {
      if (parsed === undefined || Number.isNaN(parsed))
        delete typeEntry.height;
      else typeEntry.height = parsed;
    }

    if (typeEntry.depth === undefined && typeEntry.height === undefined) {
      delete prev[type];
    } else {
      prev[type] = typeEntry;
    }

    const hasAny = (Object.keys(prev) as FurnitureType[]).some(
      (k) => prev[k] !== undefined,
    );
    onUpdateMeasureDefaults(
      project.id,
      hasAny ? (prev as Project['measureDefaults']) : undefined,
    );
  };

  return (
    <section
      className="project-detail__section project-measure-defaults"
      aria-label="Parámetros de medida del proyecto"
      data-testid="project-measure-defaults"
    >
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">
          Parámetros de medida
        </h3>
      </div>
      <p className="project-editor__hint">
        Defaults de fondo/alto (mm) por tipo de mueble. Al agregar un mueble
        se pre-selecciona el preset más cercano; cada línea puede override.
      </p>
      <div className="measure-defaults-grid">
        {typesInUse.map((type) => {
          const entry = project.measureDefaults?.[type];
          return (
            <div
              key={type}
              className="measure-defaults-row"
              data-testid={`project-measure-default-${type}`}
            >
              <span className="measure-defaults-row__label">
                {TYPE_LABELS[type]}
              </span>
              <div className="measure-defaults-row__inputs">
                <div className="measure-input">
                  <label
                    htmlFor={`md-${type}-depth`}
                    className="measure-input__label"
                  >
                    Fondo (mm)
                  </label>
                  <input
                    id={`md-${type}-depth`}
                    className="measure-input__field"
                    type="number"
                    min={1}
                    step="any"
                    placeholder="Ej. 560"
                    value={entry?.depth ?? ''}
                    onChange={(e) => handleUpdate(type, 'depth', e.target.value)}
                    data-testid={`project-measure-default-${type}-depth`}
                  />
                </div>
                <div className="measure-input">
                  <label
                    htmlFor={`md-${type}-height`}
                    className="measure-input__label"
                  >
                    Alto (mm)
                  </label>
                  <input
                    id={`md-${type}-height`}
                    className="measure-input__field"
                    type="number"
                    min={1}
                    step="any"
                    placeholder="Ej. 720"
                    value={entry?.height ?? ''}
                    onChange={(e) =>
                      handleUpdate(type, 'height', e.target.value)
                    }
                    data-testid={`project-measure-default-${type}-height`}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});
