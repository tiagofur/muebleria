/**
 * Helpers for resolving option roles and hardware references in agregados.
 */

import type { Agregado, OptionGroup } from '@muebles/domain';

export function getOptionRolesForAgregado(
  agregado: Agregado | undefined,
  optionGroups?: readonly OptionGroup[],
): string[] {
  if (!agregado) return [];
  const roles = new Set<string>();

  for (const line of agregado.hardwareLines ?? []) {
    if (line.optionRole?.trim()) {
      roles.add(line.optionRole.trim());
    }
  }

  for (const comp of agregado.components ?? []) {
    for (const p of comp.overrides?.hardwarePlacements ?? []) {
      if (!p.hardwareId) continue;
      const id = p.hardwareId.trim();
      if (
        (optionGroups && optionGroups.some((g) => g.code === id)) ||
        /^[A-Z0-9_]{3,}$/.test(id)
      ) {
        roles.add(id);
      }
    }
  }

  return Array.from(roles);
}
