/**
 * Project-level options section — extracted from ProjectDetailViewInner (#refactor).
 *
 * Renders the "Opciones del proyecto" block where users set default option
 * choices inherited by all line items (unless overridden per line).
 */

import { memo, type ReactNode } from 'react';
import { useProjectDetail } from './projectDetailContext';
import { optionsForGroup } from '../projectHelpers';

export const ProjectOptionsSection = memo(function ProjectOptionsSection(): ReactNode {
  const { project, optionGroups, catalogs, updateProjectLevelChoice, onUpdateProjectLevelChoices } =
    useProjectDetail();

  if (optionGroups.length === 0 || !onUpdateProjectLevelChoices) {
    return null;
  }

  return (
    <section
      className="project-detail__section project-level-options"
      aria-label="Opciones del proyecto"
      data-testid="project-level-options"
    >
      <div className="project-detail__section-header">
        <h3 className="project-detail__section-title">Opciones del proyecto</h3>
      </div>
      <p className="project-editor__hint">
        Defaults de cotización. Cada mueble las hereda salvo que overridees en
        la línea.
      </p>
      <div className="project-item-choices">
        {optionGroups.map((group) => {
          const options = optionsForGroup(group, catalogs);
          return (
            <div key={group.id} className="catalog-form__field">
              <label htmlFor={`project-level-${group.code}`}>
                {group.name} ({group.code})
              </label>
              <select
                id={`project-level-${group.code}`}
                value={project.projectLevelChoices?.[group.code] ?? ''}
                onChange={(e) =>
                  updateProjectLevelChoice(group.code, e.target.value)
                }
                data-testid={`project-level-choice-${group.code}`}
              >
                <option value="">Sin default</option>
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name} — {opt.code}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </section>
  );
});
