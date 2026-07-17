/**
 * Temporary A/B option scenarios for quotes (#137).
 * Pure: does not mutate the original project.
 */

import { calcProjectBreakdown } from './engine';
import type { Catalog, OptionChoices, Project } from './types';

/**
 * Clone a project forcing a single option role to `choiceId` on every line
 * (and as project-level default). Clears price snapshot so quote is live.
 */
export function projectWithRoleChoice(
  project: Project,
  role: string,
  choiceId: string,
): Project {
  const roleKey = role.trim();
  const choice = choiceId.trim();
  if (!roleKey || !choice) {
    return {
      ...project,
      status: 'draft',
      priceSnapshot: undefined,
    };
  }

  const projectLevelChoices: OptionChoices = {
    ...(project.projectLevelChoices ?? {}),
    [roleKey]: choice,
  };

  return {
    ...project,
    status: 'draft',
    priceSnapshot: undefined,
    projectLevelChoices,
    items: project.items.map((item) => ({
      ...item,
      optionChoices: {
        ...item.optionChoices,
        [roleKey]: choice,
      },
    })),
  };
}

export type ScenarioCompareResult = {
  readonly saleA: number;
  readonly saleB: number;
  /** saleB - saleA (positive = B more expensive). */
  readonly delta: number;
  readonly ok: true;
};

export type ScenarioCompareError = {
  readonly ok: false;
  readonly message: string;
};

/**
 * Compare sale price of current project (A) vs same project with role→choiceB (B).
 * Uses live catalog prices (ignores snapshot on both sides).
 */
export function compareRoleScenario(
  project: Project,
  catalog: Catalog,
  role: string,
  choiceB: string,
): ScenarioCompareResult | ScenarioCompareError {
  if (project.items.length === 0) {
    return { ok: false, message: 'La cotización no tiene muebles.' };
  }
  if (!role.trim() || !choiceB.trim()) {
    return { ok: false, message: 'Elegí un grupo y una opción para el escenario B.' };
  }

  try {
    const projectA: Project = {
      ...project,
      status: 'draft',
      priceSnapshot: undefined,
    };
    const projectB = projectWithRoleChoice(project, role, choiceB);
    const saleA = calcProjectBreakdown(projectA, catalog).salePrice;
    const saleB = calcProjectBreakdown(projectB, catalog).salePrice;
    return {
      ok: true,
      saleA,
      saleB,
      delta: saleB - saleA,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : 'No se pudo calcular el escenario B.',
    };
  }
}

/** Force role choice on project (persist Apply B). Draft only. */
export function applyRoleChoiceToProject(
  project: Project,
  role: string,
  choiceId: string,
  nowIso: string,
): Project {
  const next = projectWithRoleChoice(project, role, choiceId);
  return {
    ...next,
    status: 'draft',
    priceSnapshot: undefined,
    updatedAt: nowIso,
  };
}
