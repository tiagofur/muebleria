/**
 * #875 web authoring-resolve adapter: builds the canonical resolve request
 * from REAL web design state and projects the response's joinery statuses
 * for the #898 panel. React never resolves contacts, plans stations,
 * selects machining or computes fingerprints — this module only assembles
 * the intent the Go resolver already understands (same envelope the SketchUp
 * extension builds, declared honestly as the web client) and reads the
 * fail-closed response back.
 */

import {
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME,
  SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION,
  parseAuthoringResolveResponse,
  validateAuthoringResolveRequest,
  type AuthoringResolveRequestV1,
  type AuthoringResolveResponseV1,
  type FingerprintJoineryStatus,
} from './sketchupAuthoringResolve';
import type { ParameterValue } from './sketchupAuthoringSchema';

/** Web host identity on the resolve envelope: honest, never "sketchup". */
export const WEB_AUTHORING_RESOLVE_CLIENT = 'granete-web';
export const WEB_AUTHORING_RESOLVE_HOST = 'web';
export const WEB_AUTHORING_RESOLVE_CLIENT_VERSION = '1.0.0';

export interface WebAuthoringResolveInput {
  readonly furnitureDefinitionId: string;
  /** Content-addressed workshop catalog revision (GET /api/furniture/definitions). */
  readonly catalogRevision: string;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
  readonly materialChoices?: Readonly<Record<string, string>>;
  /** Deterministic counter/UUID source; tests inject it. */
  readonly messageId?: string;
  readonly clientVersion?: string;
}

/**
 * Build the resolve envelope from web design state. The web state carries
 * authoring intent only (definition identity, catalog pin, parameters,
 * material choices); no components/relationships are synthesized — the
 * server materializes construction-declared relationships from the catalog.
 */
export function buildWebAuthoringResolveRequest(input: WebAuthoringResolveInput): AuthoringResolveRequestV1 {
  const messageId = input.messageId ?? `web-resolve-${crypto.randomUUID()}`;
  return {
    schemaId: SKETCHUP_AUTHORING_RESOLVE_SCHEMA_ID,
    schemaName: SKETCHUP_AUTHORING_RESOLVE_SCHEMA_NAME,
    schemaVersion: SKETCHUP_AUTHORING_RESOLVE_SCHEMA_VERSION,
    messageId,
    idempotencyKey: messageId,
    sentAt: new Date().toISOString(),
    source: {
      client: WEB_AUTHORING_RESOLVE_CLIENT,
      clientVersion: input.clientVersion ?? WEB_AUTHORING_RESOLVE_CLIENT_VERSION,
      host: WEB_AUTHORING_RESOLVE_HOST,
      hostVersion: 'browser',
    },
    units: { length: 'mm', angle: 'deg', precisionMm: 0.01 },
    coordinateSystem: { handedness: 'right', upAxis: 'z', projectFrameId: 'granete-project' },
    furniture: {
      furnitureDefinitionId: input.furnitureDefinitionId,
      catalogRevision: input.catalogRevision,
      ...(input.parameters ? { parameters: input.parameters } : {}),
      ...(input.materialChoices ? { materialChoices: input.materialChoices } : {}),
    },
  };
}

/** One design item's joinery projection: statuses plus per-relationship op counts. */
export interface WebJoineryProjection {
  readonly joineryStatuses: readonly FingerprintJoineryStatus[];
  readonly relationshipOperationCounts: ReadonlyMap<string, number>;
}

/**
 * Project the machining section of an accepted resolve response for the
 * #898 panel. The response is validated fail-closed first; operation counts
 * are read off the wire operations by relationship provenance.
 */
export function projectJoineryFromResolveResponse(
  response: AuthoringResolveResponseV1,
  request: AuthoringResolveRequestV1,
): WebJoineryProjection {
  const parsed = parseAuthoringResolveResponse(response, request);
  if (parsed.status !== 'accepted') {
    throw new WebAuthoringResolveError(parsed.issues.map((issue) => issue.code).join(', '));
  }
  const counts = new Map<string, number>();
  for (const operation of parsed.resolved.machining.operations) {
    if (operation.provenance.sourceKind !== 'relationship') continue;
    counts.set(operation.provenance.relationshipId, (counts.get(operation.provenance.relationshipId) ?? 0) + 1);
  }
  return {
    joineryStatuses: parsed.resolved.machining.joineryStatuses ?? [],
    relationshipOperationCounts: counts,
  };
}

/** Structured transport/validation failure (codes only, never messages to act on). */
export class WebAuthoringResolveError extends Error {
  readonly codes: readonly string[];
  constructor(codes: string) {
    super(codes);
    this.name = 'WebAuthoringResolveError';
    this.codes = codes.split(', ');
  }
}

/** Client-side structural validation of a built request (same engine as Go). */
export function validateWebAuthoringResolveRequest(
  request: AuthoringResolveRequestV1,
): readonly string[] {
  return validateAuthoringResolveRequest(request, { hardwareCatalog: [] }).map((issue) => issue.code);
}
