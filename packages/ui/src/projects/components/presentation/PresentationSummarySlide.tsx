/**
 * Slide 0 (Resumen) for ProjectPresentationMode.
 */

import type { ReactNode } from 'react';
import type { Module, Project, ProjectItem } from '@granete/domain';
import {
  defaultMeasurePresetId,
  resolveModuleMeasurePreset,
} from '@granete/domain';

export interface PresentationSummarySlideProps {
  readonly project: Project;
  readonly modules: readonly Module[];
  readonly has3dScene: boolean;
  readonly onGoTo3D: () => void;
}

function lineLabel(
  item: ProjectItem,
  modules: readonly Module[],
): { title: string; measures: string } {
  const mod = modules.find((m) => m.id === item.moduleId);
  const title = mod ? `${mod.code} — ${mod.name}` : 'Mueble';
  let measures = '';
  if (mod) {
    try {
      const preset = resolveModuleMeasurePreset(
        mod,
        item.measurePresetId?.trim() ||
          defaultMeasurePresetId(mod) ||
          undefined,
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
  return { title, measures };
}

export function PresentationSummarySlide({
  project,
  modules,
  has3dScene,
  onGoTo3D,
}: PresentationSummarySlideProps): ReactNode {
  return (
    <section className="project-presentation__list" aria-label="Muebles">
      <h2 className="project-presentation__section-title">Muebles</h2>
      <ul className="project-presentation__items">
        {project.items.map((item) => {
          const { title, measures } = lineLabel(item, modules);
          return (
            <li key={item.id} className="project-presentation__item">
              <span className="project-presentation__item-qty">
                {item.quantity}×
              </span>
              <span>
                <span className="project-presentation__item-title">
                  {title}
                </span>
                {measures ? (
                  <span className="project-presentation__item-measures">
                    {measures}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {has3dScene ? (
        <div className="project-presentation__hero-cta">
          <p className="project-presentation__hint project-presentation__hint--flush">
            La cotización tiene vista 3D lista para mostrar al cliente.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onGoTo3D}
            data-testid="presentation-goto-3d"
          >
            Ver vista 3D
          </button>
        </div>
      ) : null}
    </section>
  );
}
