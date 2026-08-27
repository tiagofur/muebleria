/**
 * Friendly labels for option roles (#403 / MT-2).
 *
 * A material binding role is an OptionGroup code. UI must show the group's
 * workshop-facing name when one exists; the raw code is only a fallback for
 * roles without a matching group (legacy/unknown codes).
 */

import type { OptionGroup } from '@granete/domain';

/** OptionGroup name when the role matches a group; the raw code otherwise. */
export function optionRoleLabel(
  role: string,
  optionGroups?: readonly OptionGroup[],
): string {
  const group = optionGroups?.find((g) => g.code === role);
  const name = group?.name?.trim();
  return name ? name : role;
}

/** Friendly summary for a role list: `Frente, Interior` style. */
export function optionRolesSummary(
  roles: readonly string[],
  optionGroups?: readonly OptionGroup[],
): string {
  return roles.map((role) => optionRoleLabel(role, optionGroups)).join(', ');
}
