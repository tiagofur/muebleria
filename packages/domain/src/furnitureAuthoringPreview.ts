/**
 * #497 — Web furniture authoring preview contract (domain-pinned).
 *
 * POST /api/furniture/authoring/preview resolves a DRAFT set of typed
 * parameter definitions (what the catalog editor is about to save) plus
 * sample values through the same engine as the versioned authoring resolve
 * (#477), statelessly. Like the resolve itself, this surface is deliberately
 * NOT modeled in granete-api.v1.yaml: its `resolved` section is the resolve
 * engine's own output, golden-pinned by this module and the shared wire types
 * (single authority — no second validation model). The web client consumes it
 * through GraneteApiClient.previewFurnitureAuthoring, which fails closed here.
 *
 * React reads the accepted result; it never computes manufacturing
 * consequences: component counts, preflight issues and any 3D render come
 * from `resolved`, and the would-be `definitionHash` + echoed
 * `catalogRevision` come from the server.
 */

import type { ContractIssue } from './sketchupAuthoringSchema';
import {
  MANUFACTURING_PREFLIGHT_CONTRACT,
  type ResolvedLayoutWireV1,
  type ResolvedMachiningV1,
  type ResolvedPreflightV1,
} from './sketchupAuthoringResolve';
import { validateFurnitureParameterDefinitions } from './furnitureParameters';
import type { FurnitureParameter } from './smartFurnitureDomain';

export const FURNITURE_AUTHORING_PREVIEW_PATH = '/furniture/authoring/preview' as const;
export const FURNITURE_AUTHORING_PREVIEW_MAX_BODY_BYTES = 2 << 20;

export class FurnitureAuthoringPreviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FurnitureAuthoringPreviewValidationError';
  }
}

export interface FurnitureAuthoringPreviewRequest {
  /** The module whose composition the draft resolves against. */
  readonly moduleId: string;
  /** The draft definitions exactly as the editor would save them. */
  readonly parameterDefinitions: readonly FurnitureParameter[];
  /** Sample values (defaults seed the form); never authorable state. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Optional board/hardware/edge choices validated against the catalog. */
  readonly materialChoices?: Readonly<Record<string, string>>;
}

export function buildFurnitureAuthoringPreviewRequest(
  request: FurnitureAuthoringPreviewRequest,
): Record<string, unknown> {
  const moduleId = request.moduleId.trim();
  if (!moduleId) {
    throw new FurnitureAuthoringPreviewValidationError('moduleId es obligatorio');
  }
  // Client-side draft validation mirrors the server's persisted boundary so
  // obvious mistakes surface before the wire; the server stays the authority
  // and anything it rejects arrives back as structured issues.
  const definitionIssues = validateFurnitureParameterDefinitions(request.parameterDefinitions);
  if (definitionIssues.length > 0) {
    throw new FurnitureAuthoringPreviewValidationError(
      `parameterDefinitions inválidas: ${definitionIssues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
    );
  }
  return {
    moduleId,
    parameterDefinitions: request.parameterDefinitions,
    ...(request.parameters ? { parameters: request.parameters } : {}),
    ...(request.materialChoices ? { materialChoices: request.materialChoices } : {}),
  };
}

export interface FurnitureAuthoringPreviewResolved {
  readonly layout: ResolvedLayoutWireV1;
  readonly machining: ResolvedMachiningV1;
  readonly preflight: ResolvedPreflightV1;
}

export type FurnitureAuthoringPreviewResponse =
  | {
      readonly moduleId: string;
      readonly catalogRevision: string;
      readonly status: 'accepted';
      readonly definitionHash: string;
      /** The draft's published parameter set (draft + synthesized dimensions). */
      readonly definitionParameters: readonly FurnitureParameter[];
      readonly resolved: FurnitureAuthoringPreviewResolved;
      readonly issues: readonly ContractIssue[];
    }
  | {
      readonly moduleId: string;
      readonly catalogRevision: string;
      readonly status: 'rejected';
      readonly issues: readonly ContractIssue[];
    };

function fail(message: string): never {
  throw new FurnitureAuthoringPreviewValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${field} debe ser string no vacío`);
  return value;
}

/** Preflight shape mirrors the resolve contract's own subset (same scope pin). */
function parsePreflight(value: unknown): ResolvedPreflightV1 {
  if (!isRecord(value)) fail('resolved.preflight debe ser objeto');
  if (value.scope !== 'authoring-resolve-subset') fail('resolved.preflight.scope inesperado');
  if (value.preflightContract !== MANUFACTURING_PREFLIGHT_CONTRACT) fail('resolved.preflight.preflightContract inesperado');
  if (value.status !== 'clear' && value.status !== 'blocked') fail('resolved.preflight.status inválido');
  if (!Array.isArray(value.issues)) fail('resolved.preflight.issues debe ser array');
  return value as ResolvedPreflightV1;
}

function parseResolved(value: unknown): FurnitureAuthoringPreviewResolved {
  if (!isRecord(value)) fail('resolved debe ser objeto');
  if (!isRecord(value.layout)) fail('resolved.layout debe ser objeto');
  if (!isRecord(value.machining)) fail('resolved.machining debe ser objeto');
  return {
    layout: value.layout as ResolvedLayoutWireV1,
    machining: value.machining as ResolvedMachiningV1,
    preflight: parsePreflight(value.preflight),
  };
}

/**
 * Fails closed on every envelope field the preview contract owns. The
 * `resolved` sections are the resolve engine's wire (layout/machining) and
 * are shape-checked for the fields the editor renders; deep machining/layout
 * semantics stay with the resolve contract's golden pin.
 */
export function parseFurnitureAuthoringPreviewResponse(value: unknown): FurnitureAuthoringPreviewResponse {
  if (!isRecord(value)) fail('la respuesta del preview debe ser objeto');
  const moduleId = requireString(value.moduleId, 'moduleId');
  const catalogRevision = requireString(value.catalogRevision, 'catalogRevision');
  if (!Array.isArray(value.issues)) fail('issues debe ser array');

  if (value.status === 'rejected') {
    if ('resolved' in value || 'definitionHash' in value) {
      fail('un preview rechazado nunca lleva resolved ni definitionHash');
    }
    return {
      moduleId, catalogRevision, status: 'rejected',
      issues: value.issues as readonly ContractIssue[],
    };
  }
  if (value.status !== 'accepted') fail('status debe ser accepted | rejected');
  const definitionHash = requireString(value.definitionHash, 'definitionHash');
  if (!Array.isArray(value.definitionParameters)) fail('definitionParameters debe ser array');
  return {
    moduleId, catalogRevision, status: 'accepted',
    definitionHash,
    definitionParameters: value.definitionParameters as readonly FurnitureParameter[],
    resolved: parseResolved(value.resolved),
    issues: value.issues as readonly ContractIssue[],
  };
}
