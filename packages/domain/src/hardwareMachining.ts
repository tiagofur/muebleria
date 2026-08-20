/**
 * Hardware machining profile validation and sanitization (F127).
 *
 * The profile is catalog data: the drilling footprint each hardware part
 * declares relative to its placement anchor. Resolving it into concrete
 * per-piece holes is the drilling engine (F128) — this module only guarantees
 * the catalog never holds a profile a CNC could not consume.
 */

import { ValidationError } from './errors';
import type {
  HardwareMachiningPart,
  HardwareMachiningProfile,
  MachiningEntryFace,
  MachiningOperation,
  MachiningOperationKind,
} from './types';

export const MACHINING_OPERATION_KINDS: readonly MachiningOperationKind[] = [
  'blind_hole',
  'through_hole',
  'counterbore',
  'screw_pilot',
];

export const MACHINING_ENTRY_FACES: readonly MachiningEntryFace[] = [
  'anchor',
  'opposite',
];

/** Kinds whose depth is measured from the entry face (everything but through). */
const KINDS_REQUIRING_DEPTH: ReadonlySet<string> = new Set([
  'blind_hole',
  'counterbore',
  'screw_pilot',
]);

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function partContext(partIndex: number, role: string): Record<string, unknown> {
  return { part: role || `#${partIndex + 1}` };
}

function validateOperation(
  op: MachiningOperation,
  partIndex: number,
  role: string,
  seenIds: Set<string>,
): void {
  const ctx = partContext(partIndex, role);
  if (op == null || typeof op !== 'object') {
    throw new ValidationError(
      `La parte "${role}" tiene una operación vacía. Eliminá la operación o completá sus datos.`,
      ctx,
    );
  }
  if (typeof op.id !== 'string' || !op.id.trim()) {
    throw new ValidationError(
      `Cada operación de maquinado necesita un identificador (parte "${role}").`,
      ctx,
    );
  }
  if (seenIds.has(op.id)) {
    throw new ValidationError(
      `Operación duplicada "${op.id}" en la parte "${role}". Renombrá una de las dos.`,
      { ...ctx, operationId: op.id },
    );
  }
  seenIds.add(op.id);

  if (!MACHINING_OPERATION_KINDS.includes(op.kind)) {
    throw new ValidationError(
      `Tipo de operación desconocido "${String(op.kind)}" en "${op.label || op.id}". Usá taladro ciego, pasante, escareado o piloto.`,
      { ...ctx, operationId: op.id, kind: op.kind },
    );
  }
  if (!isPositiveFinite(op.diameterMm)) {
    throw new ValidationError(
      `"${op.label || op.id}" necesita un diámetro mayor a 0 mm.`,
      { ...ctx, operationId: op.id },
    );
  }
  if (KINDS_REQUIRING_DEPTH.has(op.kind) && !isPositiveFinite(op.depthMm)) {
    throw new ValidationError(
      `"${op.label || op.id}" necesita profundidad mayor a 0 mm (los taladros ciegos, escareados y pilotos miden desde la cara).`,
      { ...ctx, operationId: op.id },
    );
  }
  if (op.kind === 'through_hole' && op.depthMm !== undefined) {
    throw new ValidationError(
      `"${op.label || op.id}" es pasante: no define profundidad (atraviesa la pieza).`,
      { ...ctx, operationId: op.id },
    );
  }
  if (op.kind === 'counterbore') {
    if (!isPositiveFinite(op.innerDiameterMm)) {
      throw new ValidationError(
        `"${op.label || op.id}" es un escareado: falta el diámetro interior (caña).`,
        { ...ctx, operationId: op.id },
      );
    }
    if (op.innerDiameterMm >= op.diameterMm) {
      throw new ValidationError(
        `"${op.label || op.id}": el diámetro interior del escareado debe ser menor al exterior.`,
        { ...ctx, operationId: op.id },
      );
    }
  }
  if (op.kind !== 'counterbore' && op.innerDiameterMm !== undefined) {
    throw new ValidationError(
      `"${op.label || op.id}": el diámetro interior solo aplica a escareados.`,
      { ...ctx, operationId: op.id },
    );
  }
  if (op.face !== 'anchor' && op.face !== 'opposite') {
    throw new ValidationError(
      `"${op.label || op.id}": la cara de entrada debe ser la del anclaje o la opuesta.`,
      { ...ctx, operationId: op.id, face: op.face },
    );
  }
  if (!isFiniteNumber(op.xMm) || !isFiniteNumber(op.yMm)) {
    throw new ValidationError(
      `"${op.label || op.id}": los offsets X/Y desde el anclaje deben ser números en mm.`,
      { ...ctx, operationId: op.id },
    );
  }
  if (op.label !== undefined && typeof op.label !== 'string') {
    throw new ValidationError(
      `El nombre de la operación "${op.id}" debe ser texto.`,
      { ...ctx, operationId: op.id },
    );
  }
}

/**
 * Validate a machining profile before it enters the catalog. Throws
 * `ValidationError` with an accionable message (pieza/herraje context in
 * `context`) when any part or operation is incomplete or contradictory.
 */
export function validateMachiningProfile(profile: HardwareMachiningProfile): void {
  if (profile == null || typeof profile !== 'object' || !Array.isArray(profile.parts)) {
    throw new ValidationError(
      'El perfil de maquinado necesita al menos una parte (taza, cazuela, placa…).',
      { field: 'machining' },
    );
  }
  if (profile.parts.length === 0) {
    throw new ValidationError(
      'El perfil de maquinado necesita al menos una parte (taza, cazuela, placa…).',
      { field: 'machining' },
    );
  }

  const seenPartIds = new Set<string>();
  const seenRoles = new Set<string>();
  profile.parts.forEach((part, partIndex) => {
    if (part == null || typeof part !== 'object') {
      throw new ValidationError(
        `La parte #${partIndex + 1} del perfil está vacía. Eliminála o completá su rol.`,
        { field: 'machining' },
      );
    }
    if (typeof part.id !== 'string' || !part.id.trim()) {
      throw new ValidationError(
        `Cada parte del perfil necesita un identificador.`,
        { field: 'machining' },
      );
    }
    if (seenPartIds.has(part.id)) {
      throw new ValidationError(
        `Parte duplicada "${part.id}" en el perfil de maquinado.`,
        { field: 'machining', partId: part.id },
      );
    }
    seenPartIds.add(part.id);

    const role = typeof part.role === 'string' ? part.role.trim() : '';
    if (!role) {
      throw new ValidationError(
        `La parte "${part.id}" necesita un rol (taza, cazuela, placa…).`,
        { field: 'machining', partId: part.id },
      );
    }
    if (seenRoles.has(role)) {
      throw new ValidationError(
        `Rol duplicado "${role}" en el perfil de maquinado. Cada parte cumple una función distinta.`,
        { field: 'machining', role },
      );
    }
    seenRoles.add(role);

    if (!Array.isArray(part.operations) || part.operations.length === 0) {
      throw new ValidationError(
        `La parte "${role}" no tiene operaciones de perforación. Agregá al menos una o eliminá la parte.`,
        partContext(partIndex, role),
      );
    }

    const seenOpIds = new Set<string>();
    part.operations.forEach((op: MachiningOperation) =>
      validateOperation(op, partIndex, role, seenOpIds),
    );
  });
}

function normalizeOperation(
  raw: unknown,
  fallbackId: string,
): MachiningOperation | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const kind = r.kind;
  if (typeof kind !== 'string' || !MACHINING_OPERATION_KINDS.includes(kind as MachiningOperationKind)) {
    return undefined;
  }
  if (!isPositiveFinite(r.diameterMm)) return undefined;

  const normalized: {
    id: string;
    kind: MachiningOperationKind;
    diameterMm: number;
    depthMm?: number;
    innerDiameterMm?: number;
    xMm: number;
    yMm: number;
    face: MachiningEntryFace;
    label?: string;
  } = {
    id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : fallbackId,
    kind: kind as MachiningOperationKind,
    diameterMm: r.diameterMm,
    xMm: isFiniteNumber(r.xMm) ? r.xMm : 0,
    yMm: isFiniteNumber(r.yMm) ? r.yMm : 0,
    face: r.face === 'opposite' ? 'opposite' : 'anchor',
  };

  // Depth only survives on depth-measured kinds; inner Ø only on counterbores.
  if (KINDS_REQUIRING_DEPTH.has(kind) && isPositiveFinite(r.depthMm)) {
    normalized.depthMm = r.depthMm;
  }
  if (kind === 'counterbore' && isPositiveFinite(r.innerDiameterMm) && r.innerDiameterMm < r.diameterMm) {
    normalized.innerDiameterMm = r.innerDiameterMm;
  }
  if (typeof r.label === 'string' && r.label.trim()) {
    normalized.label = r.label.trim();
  }
  return normalized;
}

/**
 * Sanitize untrusted machining data (API payloads, persisted JSON) into a
 * clean profile. Invalid parts/operations are dropped instead of throwing —
 * garbage never enters the catalog. Returns `undefined` when nothing usable
 * remains (legacy rows / cost-only hardware).
 */
export function normalizeMachiningProfile(
  raw: unknown,
): HardwareMachiningProfile | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const rawParts = (raw as { parts?: unknown }).parts;
  if (!Array.isArray(rawParts)) return undefined;

  const seenRoles = new Set<string>();
  const parts: HardwareMachiningPart[] = [];
  rawParts.forEach((rawPart, index) => {
    if (rawPart == null || typeof rawPart !== 'object') return;
    const r = rawPart as Record<string, unknown>;
    const role = typeof r.role === 'string' ? r.role.trim() : '';
    if (!role || seenRoles.has(role)) return;

    const rawOps = Array.isArray(r.operations) ? r.operations : [];
    const operations = rawOps
      .map((op, opIndex) => normalizeOperation(op, `op-${index + 1}-${opIndex + 1}`))
      .filter((op): op is MachiningOperation => op !== undefined);
    if (operations.length === 0) return;

    seenRoles.add(role);
    parts.push({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `part-${index + 1}`,
      role,
      operations,
    });
  });

  if (parts.length === 0) return undefined;
  return { parts };
}

/** Total drilling operations across every part of the profile. */
export function countMachiningOperations(profile: HardwareMachiningProfile): number {
  return profile.parts.reduce((sum, part) => sum + part.operations.length, 0);
}
