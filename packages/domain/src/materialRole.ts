/**
 * Material binding role contract (#403 / MT-2).
 *
 * Canonical rule (docs/architecture/material-aware-furniture-resolution.md
 * §3.5, §5): for a rectangular board participating in material selection,
 * `optionRoles[0]` is the single persisted material-binding key. The
 * component's `placement` answers the physical question (what piece is this /
 * where does it belong); the binding role answers which material selection the
 * piece follows. They are orthogonal and must never be inferred from each
 * other, nor from component name, material name, color, texture or
 * manufacturer.
 *
 * A board declaring multiple competing roles is ambiguous: the engine consumes
 * only the first entry, so any extra role would appear configurable without
 * ever governing resolution. Such definitions are rejected loudly instead of
 * being silently half-honored.
 *
 * Go mirror: backend-go/internal/domain/engine/material_role.go — keep both in
 * sync; contracts/materialRoleBinding.contract.json is the shared alias
 * fixture both stacks test against.
 */

import { ResolutionError } from './errors';
import type { Component } from './types';

/** Legacy alias target: the front finish role (see plinth.ts constants). */
const FRONT_ROLE = 'FRENTE';

/**
 * Normalize a component's optionRoles: trim entries, drop empty ones and
 * exact duplicates (first-seen order preserved). Identical repeated entries
 * are not competing roles; distinct ones are.
 */
export function distinctOptionRoles(
  optionRoles: readonly string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of optionRoles ?? []) {
    const role = raw?.trim() ?? '';
    if (!role || seen.has(role)) continue;
    seen.add(role);
    out.push(role);
  }
  return out;
}

/** True when a board declares more than one distinct material binding role. */
export function hasAmbiguousOptionRoles(
  optionRoles: readonly string[] | undefined,
): boolean {
  return distinctOptionRoles(optionRoles).length > 1;
}

/**
 * The single material binding role a board component follows. Throws a
 * ResolutionError when the component declares no usable role or several
 * distinct ones — callers must never fall back to "just take [0]" on
 * ambiguity, because the discarded roles would look configurable while
 * controlling nothing.
 */
export function materialBindingRole(
  component: Pick<Component, 'id' | 'code' | 'optionRoles'>,
): string {
  const roles = distinctOptionRoles(component.optionRoles);
  if (roles.length === 0) {
    throw new ResolutionError(
      `Component ${component.code ?? component.id} has no material binding role (optionRoles is empty)`,
      {
        componentId: component.id,
        componentCode: component.code,
        field: 'optionRoles',
      },
    );
  }
  if (roles.length > 1) {
    throw new ResolutionError(
      `Component ${component.code ?? component.id} declares multiple material binding roles [${roles.join(', ')}]; only one role per board is supported — remove the extra roles`,
      {
        componentId: component.id,
        componentCode: component.code,
        field: 'optionRoles',
        optionRoles: roles,
      },
    );
  }
  return roles[0]!;
}

/**
 * Legacy alias precedence, shared verbatim with Go. Direct role choice wins;
 * otherwise ZOCLO, PUERTA, PUERTA_* and FRENTE_CAJON may inherit the FRENTE
 * choice. This is the ONLY alias behavior allowed — never extend it by
 * name/color/texture matching.
 */
export function legacyFrontAliasTargets(role: string): string[] {
  const upper = role.trim().toUpperCase();
  if (upper === 'ZOCLO') return [FRONT_ROLE];
  if (upper === 'PUERTA' || upper.startsWith('PUERTA_') || upper === 'FRENTE_CAJON') {
    return [FRONT_ROLE];
  }
  return [];
}
