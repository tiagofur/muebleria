/**
 * Validation and code conflict checking helpers for modules.
 */

import type { Module } from '@granete/domain';
import { normalizeCode } from '../../catalogs/catalogHelpers';

export function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function findModuleCodeConflict(
  code: string,
  modules: readonly Module[],
  excludeId?: string,
): Module | undefined {
  const normalized = normalizeCode(code);
  if (!normalized) return undefined;
  return modules.find(
    (m) => m.id !== excludeId && normalizeCode(m.code) === normalized,
  );
}

export function validateModuleCode(
  code: string,
  modules: readonly Module[],
  excludeId?: string,
): string | null {
  const trimmed = code.trim();
  if (!trimmed) {
    return 'El código es obligatorio.';
  }
  const conflict = findModuleCodeConflict(trimmed, modules, excludeId);
  if (conflict) {
    return `Ya existe un mueble con el código "${conflict.code}".`;
  }
  return null;
}

export function suggestPartCode(moduleCode: string, index1Based: number): string {
  const base = moduleCode.trim() || 'MOD';
  return `${base}-P${String(index1Based).padStart(2, '0')}`;
}
