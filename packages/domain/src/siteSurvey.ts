/**
 * Site survey domain (OC-040/OC-041) — structured field measurements per
 * project space/room: dimensions, openings/obstacles, utilities, plumb/level/
 * square notes, photos and explicit authorship (captured/verified/approved).
 * Measure intents are separated (preliminary → field → approved →
 * fabrication) so a commercial approximation can never reach production/CNC
 * silently: the release gate consumes the hard verification state.
 *
 * Reference: docs/operational-core-v1.md §7, docs/operational-ux.md §2.4,
 * docs/architecture.md §3 (Survey bounded context), issue #305.
 */

import { ValidationError } from './errors';
import type { Project } from './types';
import {
  appendProjectEvent,
  createProjectEvent,
  type ProjectEvent,
  type ProjectEventSource,
  type SurveyMeasureEventType,
} from './projectLifecycle';

/* ── Vocabularies (parity: contracts/siteSurvey.json) ─────────────────────── */

/**
 * OC-041 measure intents. `preliminary` is the commercial approximation,
 * `field` was captured on site, `approved` was verified against the design,
 * and `fabrication` is frozen as the basis of a production release.
 */
export const MEASURE_INTENTS = ['preliminary', 'field', 'approved', 'fabrication'] as const;
export type MeasureIntent = (typeof MEASURE_INTENTS)[number];

export const MEASURE_INTENT_LABELS_ES: Readonly<Record<MeasureIntent, string>> = {
  preliminary: 'Preliminar (comercial)',
  field: 'Levantada en obra',
  approved: 'Aprobada',
  fabrication: 'Para fabricación',
};

/**
 * Site elements that constrain the furniture layout: wall openings
 * (doors/windows), obstacles (columns/beams/pipes) and utilities (outlets,
 * water/gas points).
 */
export const SURVEY_ELEMENT_KINDS = ['opening', 'obstacle', 'utility'] as const;
export type SurveyElementKind = (typeof SURVEY_ELEMENT_KINDS)[number];

export const SURVEY_ELEMENT_KIND_LABELS_ES: Readonly<Record<SurveyElementKind, string>> = {
  opening: 'Hueco',
  obstacle: 'Obstáculo',
  utility: 'Instalación',
};

/* ── Entities ──────────────────────────────────────────────────────────────── */

/** A wall opening, obstacle or utility with optional dimensions in mm. */
export interface SurveyElement {
  readonly id: string;
  readonly kind: SurveyElementKind;
  readonly label: string;
  readonly widthMm?: number;
  readonly heightMm?: number;
  /** Reference distance (from corner/wall) in mm. */
  readonly distanceMm?: number;
  readonly notes?: string;
}

/** Room/space dimensions in mm. widthMm/heightMm are required to fabricate. */
export interface SpaceMeasures {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depthMm?: number;
  readonly notes?: string;
}

/**
 * One surveyed space/room. `measures` holds the current (field or better)
 * measurements; `preliminaryMeasures` preserves the commercial approximation
 * so deviations stay visible (Data Truth: they are different truths).
 */
export interface SurveySpace {
  readonly id: string;
  readonly name: string;
  readonly intent: MeasureIntent;
  readonly measures?: SpaceMeasures;
  readonly preliminaryMeasures?: SpaceMeasures;
  readonly elements: readonly SurveyElement[];
  /** Plumb/level/square site notes (OC-040). */
  readonly plumbNote?: string;
  readonly levelNote?: string;
  readonly squareNote?: string;
  /** Linked ProjectPhoto ids (stage `survey`). */
  readonly photoIds: readonly string[];
  readonly capturedAt?: string;
  readonly capturedByUserId?: string;
  readonly approvedAt?: string;
  readonly approvedByUserId?: string;
}

/** Survey subprocess of one project. */
export interface SiteSurvey {
  readonly id: string;
  readonly projectId: string;
  /** Survey revision — bumped when field measures are re-captured. */
  readonly revision: number;
  readonly spaces: readonly SurveySpace[];
  readonly createdAt: string;
  readonly capturedByUserId?: string;
  readonly verifiedAt?: string;
  readonly verifiedByUserId?: string;
}

/* ── Guards ────────────────────────────────────────────────────────────────── */

export function isMeasureIntent(value: string): value is MeasureIntent {
  return (MEASURE_INTENTS as readonly string[]).includes(value);
}

export function isSurveyElementKind(value: string): value is SurveyElementKind {
  return (SURVEY_ELEMENT_KINDS as readonly string[]).includes(value);
}

/* ── Gate readiness (OC-041) ───────────────────────────────────────────────── */

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

/* ── Mutations (pure, event-audited) ───────────────────────────────────────── */

export interface CreateSiteSurveyParams {
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/** Start the structured survey of a project (OC-040). Idempotent per project. */
export function createSiteSurvey(
  project: Project,
  params: CreateSiteSurveyParams = {},
): { project: Project; survey: SiteSurvey; events: readonly ProjectEvent[] } {
  if (project.siteSurvey) {
    throw new ValidationError('La obra ya tiene un levantamiento estructurado');
  }
  const at = params.at ?? new Date().toISOString();
  const survey: SiteSurvey = {
    id: generateSurveyId('svy'),
    projectId: project.id,
    revision: 1,
    spaces: [],
    createdAt: at,
    capturedByUserId: params.byUserId,
  };
  const event = surveyEvent(project, 'survey_captured', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: 'Levantamiento estructurado iniciado',
    payload: { surveyId: survey.id, revision: survey.revision },
  });
  const updated = appendProjectEvent({ ...project, siteSurvey: survey }, event);
  return { project: updated, survey, events: [event] };
}

export interface UpsertSurveySpaceInput {
  readonly id?: string;
  readonly name: string;
  readonly elements?: readonly SurveyElementInput[];
  readonly plumbNote?: string;
  readonly levelNote?: string;
  readonly squareNote?: string;
  readonly photoIds?: readonly string[];
}

export interface SurveyElementInput {
  readonly id?: string;
  readonly kind: SurveyElementKind;
  readonly label: string;
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly distanceMm?: number;
  readonly notes?: string;
}

/**
 * Create or update a space. A new space starts as `preliminary` (commercial
 * entry); its intent only advances through explicit capture/approve actions.
 */
export function upsertSurveySpace(
  project: Project,
  input: UpsertSurveySpaceInput,
): { project: Project; survey: SiteSurvey } {
  const survey = requireSurvey(project);
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError('El espacio necesita un nombre');
  }
  if (input.elements) {
    validateElements(input.elements);
  }
  const existing = input.id ? survey.spaces.find((s) => s.id === input.id) : undefined;
  const duplicate = survey.spaces.find((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== existing?.id);
  if (duplicate) {
    throw new ValidationError(`Ya existe un espacio llamado «${duplicate.name}»`);
  }
  const space: SurveySpace = existing
    ? {
        ...existing,
        name,
        elements: input.elements ? input.elements.map(normalizeElement) : existing.elements,
        plumbNote: input.plumbNote?.trim() || undefined,
        levelNote: input.levelNote?.trim() || undefined,
        squareNote: input.squareNote?.trim() || undefined,
        photoIds: input.photoIds ?? existing.photoIds,
      }
    : {
        id: input.id ?? generateSurveyId('spc'),
        name,
        intent: 'preliminary',
        elements: (input.elements ?? []).map(normalizeElement),
        plumbNote: input.plumbNote?.trim() || undefined,
        levelNote: input.levelNote?.trim() || undefined,
        squareNote: input.squareNote?.trim() || undefined,
        photoIds: input.photoIds ?? [],
      };
  const spaces = existing
    ? survey.spaces.map((s) => (s.id === existing.id ? space : s))
    : [...survey.spaces, space];
  const updatedSurvey: SiteSurvey = { ...survey, spaces };
  return { project: withSurvey(project, updatedSurvey), survey: updatedSurvey };
}

export interface CaptureSpaceMeasuresParams {
  readonly spaceId: string;
  readonly measures: SpaceMeasures;
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/**
 * Capture field measurements on site (preliminary → field). The commercial
 * approximation is preserved in `preliminaryMeasures` and the survey revision
 * is bumped so downstream consumers can detect re-measured work.
 */
export function captureSpaceMeasures(
  project: Project,
  params: CaptureSpaceMeasuresParams,
): { project: Project; survey: SiteSurvey; events: readonly ProjectEvent[] } {
  const survey = requireSurvey(project);
  const space = survey.spaces.find((s) => s.id === params.spaceId);
  if (!space) {
    throw new ValidationError('Espacio inexistente en el levantamiento');
  }
  validateMeasures(params.measures);
  const at = params.at ?? new Date().toISOString();
  const updatedSpace: SurveySpace = {
    ...space,
    intent: 'field',
    measures: params.measures,
    preliminaryMeasures: space.preliminaryMeasures ?? space.measures,
    capturedAt: at,
    capturedByUserId: params.byUserId,
  };
  const updatedSurvey: SiteSurvey = {
    ...survey,
    revision: survey.revision + 1,
    spaces: survey.spaces.map((s) => (s.id === space.id ? updatedSpace : s)),
  };
  const event = surveyEvent(project, 'survey_captured', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: `Medidas levantadas en obra: ${space.name}`,
    payload: {
      surveyId: survey.id,
      spaceId: space.id,
      revision: updatedSurvey.revision,
      widthMm: params.measures.widthMm,
      heightMm: params.measures.heightMm,
      depthMm: params.measures.depthMm,
    },
  });
  const updatedProject = appendProjectEvent(withSurvey(project, updatedSurvey), event);
  return { project: updatedProject, survey: updatedSurvey, events: [event] };
}

/** Remove a space. Fabrication-frozen spaces cannot be removed. */
export function removeSurveySpace(
  project: Project,
  spaceId: string,
): { project: Project; survey: SiteSurvey } {
  const survey = requireSurvey(project);
  const space = survey.spaces.find((s) => s.id === spaceId);
  if (!space) {
    throw new ValidationError('Espacio inexistente en el levantamiento');
  }
  if (space.intent === 'fabrication') {
    throw new ValidationError(`«${space.name}» está congelada para fabricación; no se puede eliminar`);
  }
  const updatedSurvey: SiteSurvey = {
    ...survey,
    spaces: survey.spaces.filter((s) => s.id !== spaceId),
  };
  return { project: withSurvey(project, updatedSurvey), survey: updatedSurvey };
}

export interface VerifySiteSurveyParams {
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/**
 * Verify the whole survey (OC-040 verifiedAt/verifiedBy). Requires at least
 * one space captured on site — a survey of commercial approximations cannot
 * be verified.
 */
export function verifySiteSurvey(
  project: Project,
  params: VerifySiteSurveyParams = {},
): { project: Project; survey: SiteSurvey; events: readonly ProjectEvent[] } {
  const survey = requireSurvey(project);
  if (survey.verifiedAt) {
    throw new ValidationError('El levantamiento ya está verificado');
  }
  const captured = survey.spaces.filter((s) => s.intent !== 'preliminary');
  if (captured.length === 0) {
    throw new ValidationError('No hay espacios levantados en obra para verificar');
  }
  const at = params.at ?? new Date().toISOString();
  const updatedSurvey: SiteSurvey = {
    ...survey,
    verifiedAt: at,
    verifiedByUserId: params.byUserId,
  };
  const event = surveyEvent(project, 'survey_verified', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: 'Levantamiento verificado',
    payload: { surveyId: survey.id, spaces: captured.length },
  });
  const updatedProject = appendProjectEvent(withSurvey(project, updatedSurvey), event);
  return { project: updatedProject, survey: updatedSurvey, events: [event] };
}

export interface ApproveSpaceMeasuresParams {
  readonly spaceId: string;
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/**
 * Approve one space's measures against the design (field → approved, OC-041).
 * Preliminary measures cannot be approved directly — they must be captured on
 * site first. This is the gate that keeps commercial approximations away
 * from CNC.
 */
export function approveSpaceMeasures(
  project: Project,
  params: ApproveSpaceMeasuresParams,
): { project: Project; survey: SiteSurvey; events: readonly ProjectEvent[] } {
  const survey = requireSurvey(project);
  const space = survey.spaces.find((s) => s.id === params.spaceId);
  if (!space) {
    throw new ValidationError('Espacio inexistente en el levantamiento');
  }
  if (space.intent === 'preliminary') {
    throw new ValidationError(
      `«${space.name}» sólo tiene medidas preliminares; levántelas en obra antes de aprobar`,
    );
  }
  if (space.intent === 'approved' || space.intent === 'fabrication') {
    throw new ValidationError(`«${space.name}» ya está aprobada`);
  }
  const at = params.at ?? new Date().toISOString();
  const updatedSpace: SurveySpace = {
    ...space,
    intent: 'approved',
    approvedAt: at,
    approvedByUserId: params.byUserId,
  };
  const updatedSurvey: SiteSurvey = {
    ...survey,
    spaces: survey.spaces.map((s) => (s.id === space.id ? updatedSpace : s)),
  };
  const event = surveyEvent(project, 'survey_measures_approved', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: `Medidas aprobadas: ${space.name}`,
    payload: { surveyId: survey.id, spaceId: space.id },
  });
  const updatedProject = appendProjectEvent(withSurvey(project, updatedSurvey), event);
  return { project: updatedProject, survey: updatedSurvey, events: [event] };
}

export interface FreezeMeasuresParams {
  readonly byUserId?: string;
  readonly at?: string;
  readonly source?: ProjectEventSource;
}

/**
 * Freeze every approved space as the fabrication basis (approved →
 * fabrication). Requires the full OC-041 gate: all spaces captured and
 * approved plus explicit survey verification.
 */
export function freezeMeasuresForFabrication(
  project: Project,
  params: FreezeMeasuresParams = {},
): { project: Project; survey: SiteSurvey; events: readonly ProjectEvent[] } {
  const survey = requireSurvey(project);
  const blockers = surveyFabricationBlockers(survey);
  if (blockers.length > 0) {
    throw new ValidationError(`No se puede congelar para fabricación: ${blockers[0]!.message}`);
  }
  const at = params.at ?? new Date().toISOString();
  const updatedSurvey: SiteSurvey = {
    ...survey,
    spaces: survey.spaces.map((s) => ({ ...s, intent: 'fabrication' as const })),
  };
  const event = surveyEvent(project, 'survey_measures_approved', {
    byUserId: params.byUserId,
    at,
    source: params.source,
    note: 'Medidas congeladas para fabricación',
    payload: { surveyId: survey.id, revision: survey.revision, frozen: updatedSurvey.spaces.length },
  });
  const updatedProject = appendProjectEvent(withSurvey(project, updatedSurvey), event);
  return { project: updatedProject, survey: updatedSurvey, events: [event] };
}

/* ── Validation (server shape re-check, parity with Go ValidateSiteSurveyShape) ─ */

/**
 * Structural validation of a SiteSurvey payload (server re-checks what the
 * client sends). Mirrored by backend-go ValidateSiteSurveyShape.
 */
export function validateSiteSurveyShape(survey: SiteSurvey | undefined): string[] {
  const errors: string[] = [];
  if (!survey) return errors;
  if (!survey.id) errors.push('siteSurvey.id requerido');
  if (!survey.projectId) errors.push('siteSurvey.projectId requerido');
  if (!(survey.revision >= 1)) errors.push('siteSurvey.revision debe ser >= 1');
  if (survey.verifiedAt && !survey.verifiedByUserId) {
    errors.push('siteSurvey: verificación sin autor (verifiedByUserId)');
  }
  const names = new Set<string>();
  for (const space of survey.spaces) {
    if (!space.id) errors.push(`space: id requerido`);
    if (!space.name?.trim()) errors.push(`space ${space.id}: nombre requerido`);
    const key = space.name?.trim().toLowerCase();
    if (key) {
      if (names.has(key)) errors.push(`space ${space.id}: nombre duplicado «${space.name}»`);
      names.add(key);
    }
    if (!isMeasureIntent(space.intent)) errors.push(`space ${space.id}: intent inválido`);
    if (space.intent === 'fabrication' && !space.approvedAt) {
      errors.push(`space ${space.id}: congelado sin aprobación previa`);
    }
    if (space.measures) {
      const m = space.measures;
      if (!(m.widthMm > 0) || !(m.heightMm > 0)) {
        errors.push(`space ${space.id}: medidas requieren widthMm/heightMm > 0`);
      }
      if (m.depthMm !== undefined && !(m.depthMm > 0)) {
        errors.push(`space ${space.id}: depthMm debe ser > 0`);
      }
    }
    for (const el of space.elements) {
      if (!isSurveyElementKind(el.kind)) errors.push(`element ${el.id}: tipo inválido`);
      if (!el.label?.trim()) errors.push(`element ${el.id}: label requerido`);
    }
  }
  return errors;
}

/* ── Internals ─────────────────────────────────────────────────────────────── */

function generateSurveyId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function requireSurvey(project: Project): SiteSurvey {
  if (!project.siteSurvey) {
    throw new ValidationError('La obra no tiene levantamiento estructurado');
  }
  return project.siteSurvey;
}

function withSurvey(project: Project, survey: SiteSurvey): Project {
  return { ...project, siteSurvey: survey };
}

function surveyEvent(
  project: Project,
  type: SurveyMeasureEventType,
  params: {
    readonly byUserId?: string;
    readonly at: string;
    readonly source?: ProjectEventSource;
    readonly note?: string;
    readonly payload?: Record<string, unknown>;
  },
): ProjectEvent {
  return createProjectEvent({
    projectId: project.id,
    type,
    at: params.at,
    byUserId: params.byUserId,
    source: params.source,
    note: params.note,
    payload: params.payload,
  });
}

function validateMeasures(measures: SpaceMeasures): void {
  if (!Number.isFinite(measures.widthMm) || measures.widthMm <= 0) {
    throw new ValidationError('El ancho (mm) debe ser mayor a cero');
  }
  if (!Number.isFinite(measures.heightMm) || measures.heightMm <= 0) {
    throw new ValidationError('El alto (mm) debe ser mayor a cero');
  }
  if (measures.depthMm !== undefined && (!Number.isFinite(measures.depthMm) || measures.depthMm <= 0)) {
    throw new ValidationError('La profundidad (mm) debe ser mayor a cero');
  }
}

function validateElements(elements: readonly SurveyElementInput[]): void {
  for (const el of elements) {
    if (!isSurveyElementKind(el.kind)) {
      throw new ValidationError(`Tipo de elemento inválido: ${String(el.kind)}`);
    }
    if (!el.label?.trim()) {
      throw new ValidationError('El elemento necesita una etiqueta');
    }
    for (const mm of [el.widthMm, el.heightMm, el.distanceMm]) {
      if (mm !== undefined && (!Number.isFinite(mm) || mm <= 0)) {
        throw new ValidationError('Las medidas del elemento deben ser mayores a cero');
      }
    }
  }
}

function normalizeElement(el: SurveyElementInput): SurveyElement {
  return {
    id: el.id ?? generateSurveyId('elm'),
    kind: el.kind,
    label: el.label.trim(),
    widthMm: el.widthMm,
    heightMm: el.heightMm,
    distanceMm: el.distanceMm,
    notes: el.notes?.trim() || undefined,
  };
}
