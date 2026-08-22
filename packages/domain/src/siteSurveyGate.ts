/**
 * Site survey fabrication gate (OC-041) — pure readiness derivation shared by
 * the release gate (projectLifecycle.ts) and the survey mutations
 * (siteSurvey.ts). Leaf module: imports types only, so both consumers can
 * depend on it without runtime cycles.
 *
 * Reference: docs/operational-core-v1.md §7, issue #305.
 */

import type { SiteSurvey } from './siteSurvey';

export interface SurveyGateBlocker {
  readonly kind: 'no_spaces' | 'preliminary_space' | 'field_space_unapproved' | 'not_verified';
  readonly spaceId?: string;
  readonly spaceName?: string;
  readonly message: string;
}

/**
 * Hard verification state consumed by the production release gate: every
 * space must have been captured on site (never preliminary) and approved, and
 * the survey must carry an explicit verification with author. A missing
 * survey keeps returning `no_spaces` so callers fall back to the legacy
 * stamp check.
 */
export function surveyFabricationBlockers(survey: SiteSurvey | undefined): readonly SurveyGateBlocker[] {
  if (!survey) {
    return [{ kind: 'no_spaces', message: 'La obra no tiene levantamiento estructurado' }];
  }
  const blockers: SurveyGateBlocker[] = [];
  if (survey.spaces.length === 0) {
    blockers.push({ kind: 'no_spaces', message: 'El levantamiento no tiene espacios cargados' });
  }
  for (const space of survey.spaces) {
    if (space.intent === 'preliminary') {
      blockers.push({
        kind: 'preliminary_space',
        spaceId: space.id,
        spaceName: space.name,
        message: `«${space.name}» sólo tiene medidas preliminares (comerciales)`,
      });
    } else if (space.intent === 'field') {
      blockers.push({
        kind: 'field_space_unapproved',
        spaceId: space.id,
        spaceName: space.name,
        message: `«${space.name}» está levantada pero pendiente de aprobación`,
      });
    }
  }
  if (!survey.verifiedAt) {
    blockers.push({ kind: 'not_verified', message: 'El levantamiento no tiene verificación con autor' });
  }
  return blockers;
}

/** True when the structured survey satisfies the OC-041 fabrication gate. */
export function isSurveyApprovedForFabrication(survey: SiteSurvey | undefined): boolean {
  return surveyFabricationBlockers(survey).length === 0;
}
