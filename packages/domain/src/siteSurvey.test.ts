import { describe, it, expect } from 'vitest';
import siteSurveyContract from '../../../contracts/siteSurvey.json';
import {
  MEASURE_INTENTS,
  SURVEY_ELEMENT_KINDS,
  MEASURE_INTENT_LABELS_ES,
  isMeasureIntent,
  isSurveyElementKind,
  surveyFabricationBlockers,
  isSurveyApprovedForFabrication,
  createSiteSurvey,
  upsertSurveySpace,
  captureSpaceMeasures,
  removeSurveySpace,
  verifySiteSurvey,
  approveSpaceMeasures,
  freezeMeasuresForFabrication,
  validateSiteSurveyShape,
  type SpaceMeasures,
} from './siteSurvey';
import { evaluateProductionReleaseGates } from './projectLifecycle';
import { roleCanAppendProjectEvent, USER_ROLES } from './rbac';
import type { Project } from './types';
import { ValidationError } from './errors';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Obra Test',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.3,
    laborFixedCost: 10,
    status: 'accepted',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    ...overrides,
  };
}

const mm: SpaceMeasures = { widthMm: 3200, heightMm: 2600 };

/** Project with one surveyed space driven to the requested intent. */
function projectWithSpace(
  intent: 'preliminary' | 'field' | 'approved' | 'fabrication-frozen',
): Project {
  let project = makeProject();
  project = createSiteSurvey(project, { byUserId: 'vend-1', at: '2026-08-21T10:00:00Z' }).project;
  project = upsertSurveySpace(project, { name: 'Cocina' }).project;
  if (intent === 'preliminary') return project;
  project = captureSpaceMeasures(project, {
    spaceId: project.siteSurvey!.spaces[0]!.id,
    measures: mm,
    byUserId: 'vend-1',
    at: '2026-08-21T11:00:00Z',
  }).project;
  if (intent === 'field') return project;
  project = verifySiteSurvey(project, { byUserId: 'ing-1', at: '2026-08-21T12:00:00Z' }).project;
  project = approveSpaceMeasures(project, {
    spaceId: project.siteSurvey!.spaces[0]!.id,
    byUserId: 'ing-1',
    at: '2026-08-21T12:30:00Z',
  }).project;
  if (intent === 'approved') return project;
  project = freezeMeasuresForFabrication(project, { byUserId: 'ing-1', at: '2026-08-21T13:00:00Z' }).project;
  return project;
}

describe('siteSurvey — contract parity (contracts/siteSurvey.json)', () => {
  it('measure intents match the shared contract', () => {
    expect([...MEASURE_INTENTS]).toEqual(siteSurveyContract.measureIntents);
    for (const rejected of siteSurveyContract.rejectedMeasureIntents) {
      expect(isMeasureIntent(rejected)).toBe(false);
    }
  });

  it('element kinds match the shared contract', () => {
    expect([...SURVEY_ELEMENT_KINDS]).toEqual(siteSurveyContract.surveyElementKinds);
    for (const rejected of siteSurveyContract.rejectedSurveyElementKinds) {
      expect(isSurveyElementKind(rejected)).toBe(false);
    }
  });

  it('every intent has an ES label', () => {
    for (const intent of MEASURE_INTENTS) {
      expect(MEASURE_INTENT_LABELS_ES[intent].length).toBeGreaterThan(0);
    }
  });

  it('survey event roles match the RBAC matrix', () => {
    const eventRoles = siteSurveyContract.eventRoles as Record<string, string[]>;
    for (const [eventType, allowedRoles] of Object.entries(eventRoles)) {
      for (const role of USER_ROLES) {
        expect(roleCanAppendProjectEvent(role, eventType)).toBe(allowedRoles.includes(role));
      }
    }
  });
});

describe('createSiteSurvey', () => {
  it('creates an empty audited survey', () => {
    const { project, survey, events } = createSiteSurvey(makeProject(), {
      byUserId: 'vend-1',
      at: '2026-08-21T10:00:00Z',
    });
    expect(survey.spaces).toHaveLength(0);
    expect(survey.revision).toBe(1);
    expect(project.siteSurvey?.id).toBe(survey.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('survey_captured');
    expect(events[0]!.byUserId).toBe('vend-1');
  });

  it('rejects a second survey on the same project', () => {
    const { project } = createSiteSurvey(makeProject());
    expect(() => createSiteSurvey(project)).toThrow(ValidationError);
  });
});

describe('upsertSurveySpace', () => {
  it('creates a space as preliminary (commercial entry) with elements and notes', () => {
    let project = createSiteSurvey(makeProject()).project;
    const { project: updated, survey } = upsertSurveySpace(project, {
      name: 'Cocina',
      elements: [
        { kind: 'opening', label: 'Ventana', widthMm: 1200, heightMm: 900, distanceMm: 800 },
        { kind: 'utility', label: 'Toma agua' },
      ],
      plumbNote: 'Pared izquierda fuera de plomo 8mm',
      levelNote: 'Piso con caída hacia el desagüe',
      squareNote: 'Esquina noroeste descuadrada',
      photoIds: ['photo-1'],
    });
    project = updated;
    const space = survey.spaces[0]!;
    expect(space.intent).toBe('preliminary');
    expect(space.elements).toHaveLength(2);
    expect(space.elements[0]!.kind).toBe('opening');
    expect(space.plumbNote).toContain('plomo');
    expect(space.photoIds).toEqual(['photo-1']);
    expect(project.siteSurvey?.spaces[0]!.name).toBe('Cocina');
  });

  it('rejects empty names and duplicates (case-insensitive)', () => {
    let project = createSiteSurvey(makeProject()).project;
    project = upsertSurveySpace(project, { name: 'Cocina' }).project;
    expect(() => upsertSurveySpace(project, { name: '  ' })).toThrow(ValidationError);
    expect(() => upsertSurveySpace(project, { name: 'cocina' })).toThrow(ValidationError);
  });

  it('updates an existing space keeping its intent', () => {
    let project = projectWithSpace('approved');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    const { survey } = upsertSurveySpace(project, { id: spaceId, name: 'Cocina principal' });
    expect(survey.spaces[0]!.name).toBe('Cocina principal');
    expect(survey.spaces[0]!.intent).toBe('approved');
  });

  it('rejects invalid element kinds and measures', () => {
    const project = createSiteSurvey(makeProject()).project;
    expect(() =>
      upsertSurveySpace(project, {
        name: 'X',
        elements: [{ kind: 'pared' as never, label: 'Pared' }],
      }),
    ).toThrow(ValidationError);
    expect(() =>
      upsertSurveySpace(project, { name: 'X', elements: [{ kind: 'obstacle', label: 'Columna', widthMm: -5 }] }),
    ).toThrow(ValidationError);
  });
});

describe('captureSpaceMeasures (preliminary → field, OC-041)', () => {
  it('captures field measures preserving the commercial approximation', () => {
    const project = projectWithSpace('preliminary');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    const { project: updated, survey, events } = captureSpaceMeasures(project, {
      spaceId,
      measures: { ...mm, depthMm: 600 },
      byUserId: 'vend-1',
      at: '2026-08-21T11:00:00Z',
    });
    const space = survey.spaces[0]!;
    expect(space.intent).toBe('field');
    expect(space.measures?.widthMm).toBe(3200);
    expect(space.preliminaryMeasures).toBeUndefined();
    expect(space.capturedAt).toBe('2026-08-21T11:00:00Z');
    expect(space.capturedByUserId).toBe('vend-1');
    expect(survey.revision).toBe(2);
    expect(updated.siteSurvey?.revision).toBe(2);
    expect(events[0]!.type).toBe('survey_captured');
    expect(events[0]!.payload?.spaceId).toBe(spaceId);
  });

  it('keeps the previous field measures as preliminary on re-capture', () => {
    const project = projectWithSpace('field');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    const { survey } = captureSpaceMeasures(project, {
      spaceId,
      measures: { widthMm: 3250, heightMm: 2600 },
      byUserId: 'vend-1',
    });
    expect(survey.spaces[0]!.preliminaryMeasures?.widthMm).toBe(3200);
    expect(survey.revision).toBe(3);
  });

  it('rejects non-positive dimensions', () => {
    const project = projectWithSpace('preliminary');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    expect(() =>
      captureSpaceMeasures(project, { spaceId, measures: { widthMm: 0, heightMm: 100 } }),
    ).toThrow(ValidationError);
    expect(() =>
      captureSpaceMeasures(project, { spaceId, measures: { widthMm: 100, heightMm: 100, depthMm: -1 } }),
    ).toThrow(ValidationError);
  });

  it('rejects unknown spaces', () => {
    const project = projectWithSpace('preliminary');
    expect(() =>
      captureSpaceMeasures(project, { spaceId: 'nope', measures: mm }),
    ).toThrow(ValidationError);
  });
});

describe('verifySiteSurvey (OC-040 verifiedAt/verifiedBy)', () => {
  it('verifies a survey with at least one captured space', () => {
    const project = projectWithSpace('field');
    const { survey, events } = verifySiteSurvey(project, {
      byUserId: 'ing-1',
      at: '2026-08-21T12:00:00Z',
    });
    expect(survey.verifiedAt).toBe('2026-08-21T12:00:00Z');
    expect(survey.verifiedByUserId).toBe('ing-1');
    expect(events[0]!.type).toBe('survey_verified');
  });

  it('refuses to verify a survey of commercial approximations only', () => {
    const project = projectWithSpace('preliminary');
    expect(() => verifySiteSurvey(project)).toThrow(ValidationError);
  });

  it('refuses double verification', () => {
    const project = projectWithSpace('approved');
    expect(() => verifySiteSurvey(project)).toThrow(ValidationError);
  });
});

describe('approveSpaceMeasures (field → approved, OC-041 gate)', () => {
  it('approves captured measures with author and event', () => {
    const project = projectWithSpace('field');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    const { survey, events } = approveSpaceMeasures(project, {
      spaceId,
      byUserId: 'ing-1',
      at: '2026-08-21T12:30:00Z',
    });
    expect(survey.spaces[0]!.intent).toBe('approved');
    expect(survey.spaces[0]!.approvedByUserId).toBe('ing-1');
    expect(events[0]!.type).toBe('survey_measures_approved');
  });

  it('NEVER approves a preliminary space — the OC-041 hard gate', () => {
    const project = projectWithSpace('preliminary');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    expect(() => approveSpaceMeasures(project, { spaceId })).toThrow(/preliminares/);
  });

  it('refuses double approval', () => {
    const project = projectWithSpace('approved');
    const spaceId = project.siteSurvey!.spaces[0]!.id;
    expect(() => approveSpaceMeasures(project, { spaceId })).toThrow(ValidationError);
  });
});

describe('freezeMeasuresForFabrication (approved → fabrication)', () => {
  it('freezes every approved space after full gate', () => {
    const project = projectWithSpace('approved');
    const { survey, events } = freezeMeasuresForFabrication(project, {
      byUserId: 'ing-1',
      at: '2026-08-21T13:00:00Z',
    });
    expect(survey.spaces.every((s) => s.intent === 'fabrication')).toBe(true);
    expect(events[0]!.note).toContain('congeladas');
  });

  it('refuses to freeze when any space is preliminary or unapproved', () => {
    const preliminary = projectWithSpace('preliminary');
    expect(() => freezeMeasuresForFabrication(preliminary)).toThrow(/preliminares/);
    const field = projectWithSpace('field');
    expect(() => freezeMeasuresForFabrication(field)).toThrow(/aprobación/);
  });

  it('refuses to freeze without survey verification', () => {
    let project = makeProject();
    project = createSiteSurvey(project).project;
    project = upsertSurveySpace(project, { name: 'Cocina' }).project;
    project = captureSpaceMeasures(project, {
      spaceId: project.siteSurvey!.spaces[0]!.id,
      measures: mm,
    }).project;
    project = approveSpaceMeasures(project, {
      spaceId: project.siteSurvey!.spaces[0]!.id,
    }).project;
    expect(() => freezeMeasuresForFabrication(project)).toThrow(/verificación/);
  });
});

describe('surveyFabricationBlockers / isSurveyApprovedForFabrication', () => {
  it('reports no_spaces for a missing survey (callers fall back to the stamp)', () => {
    expect(surveyFabricationBlockers(undefined)[0]!.kind).toBe('no_spaces');
    expect(isSurveyApprovedForFabrication(undefined)).toBe(false);
  });

  it('walks every blocking state and clears when approved + verified', () => {
    const preliminary = projectWithSpace('preliminary');
    const kinds = surveyFabricationBlockers(preliminary.siteSurvey).map((b) => b.kind);
    expect(kinds).toContain('preliminary_space');
    expect(kinds).toContain('not_verified');

    const field = projectWithSpace('field');
    expect(surveyFabricationBlockers(field.siteSurvey).map((b) => b.kind)).toContain(
      'field_space_unapproved',
    );

    const approved = projectWithSpace('approved');
    expect(isSurveyApprovedForFabrication(approved.siteSurvey)).toBe(true);

    const frozen = projectWithSpace('fabrication-frozen');
    expect(isSurveyApprovedForFabrication(frozen.siteSurvey)).toBe(true);
  });

  it('blockers name the space so UI can route the fix', () => {
    const preliminary = projectWithSpace('preliminary');
    const blocker = surveyFabricationBlockers(preliminary.siteSurvey).find(
      (b) => b.kind === 'preliminary_space',
    );
    expect(blocker?.spaceName).toBe('Cocina');
    expect(blocker?.message).toContain('Cocina');
  });
});

describe('removeSurveySpace', () => {
  it('removes a non-frozen space and protects frozen ones', () => {
    const preliminary = projectWithSpace('preliminary');
    const spaceId = preliminary.siteSurvey!.spaces[0]!.id;
    const { survey } = removeSurveySpace(preliminary, spaceId);
    expect(survey.spaces).toHaveLength(0);

    const frozen = projectWithSpace('fabrication-frozen');
    expect(() => removeSurveySpace(frozen, frozen.siteSurvey!.spaces[0]!.id)).toThrow(ValidationError);
  });
});

describe('validateSiteSurveyShape', () => {
  it('accepts a valid survey payload', () => {
    const project = projectWithSpace('approved');
    expect(validateSiteSurveyShape(project.siteSurvey)).toEqual([]);
    expect(validateSiteSurveyShape(undefined)).toEqual([]);
  });

  it('flags structural problems with authorship and geometry', () => {
    const survey = projectWithSpace('approved').siteSurvey!;
    const broken = {
      ...survey,
      verifiedAt: '2026-08-21T12:00:00Z',
      verifiedByUserId: undefined,
      spaces: [
        {
          ...survey.spaces[0]!,
          name: 'Cocina',
          intent: 'fabrication' as const,
          approvedAt: undefined,
          measures: { widthMm: 0, heightMm: 100 },
          elements: [{ id: 'elm_1', kind: 'hueco' as never, label: '' }],
        },
        { ...survey.spaces[0]!, id: 'spc_2', name: 'cocina' },
      ],
    };
    const errors = validateSiteSurveyShape(broken);
    expect(errors.some((e) => e.includes('verifiedByUserId'))).toBe(true);
    expect(errors.some((e) => e.includes('aprobación previa'))).toBe(true);
    expect(errors.some((e) => e.includes('widthMm/heightMm'))).toBe(true);
    expect(errors.some((e) => e.includes('tipo inválido'))).toBe(true);
    expect(errors.some((e) => e.includes('duplicado'))).toBe(true);
  });
});

describe('production release gate — survey_verified (OC-041 hardening)', () => {
  it('with a structured survey, preliminary measures never pass the gate', () => {
    const project = projectWithSpace('preliminary');
    const checks = evaluateProductionReleaseGates(project, { requireSurvey: true });
    const surveyCheck = checks.find((c) => c.code === 'survey_verified')!;
    expect(surveyCheck.passed).toBe(false);
    expect(surveyCheck.details).toContain('preliminares');
  });

  it('field-but-unapproved spaces also fail with a routed explanation', () => {
    const project = projectWithSpace('field');
    const checks = evaluateProductionReleaseGates(project, { requireSurvey: true });
    const surveyCheck = checks.find((c) => c.code === 'survey_verified')!;
    expect(surveyCheck.passed).toBe(false);
    expect(surveyCheck.details).toContain('aprobación');
  });

  it('an approved + verified survey passes the gate', () => {
    const project = projectWithSpace('approved');
    const checks = evaluateProductionReleaseGates(project, { requireSurvey: true });
    const surveyCheck = checks.find((c) => c.code === 'survey_verified')!;
    expect(surveyCheck.passed).toBe(true);
  });

  it('without a structured survey the legacy stamp still rules (backcompat)', () => {
    const stamped = makeProject({ surveyCompletedAt: '2026-08-21T09:00:00Z' });
    const checksStamped = evaluateProductionReleaseGates(stamped, { requireSurvey: true });
    expect(checksStamped.find((c) => c.code === 'survey_verified')!.passed).toBe(true);

    const bare = makeProject();
    const checksBare = evaluateProductionReleaseGates(bare, { requireSurvey: true });
    expect(checksBare.find((c) => c.code === 'survey_verified')!.passed).toBe(false);
  });
});
