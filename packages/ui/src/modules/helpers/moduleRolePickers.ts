/**
 * Role discoverers and option group pickers for modules.
 */

import type {
  Agregado,
  Component,
  ModuleBaseMode,
  OptionGroup,
  OptionGroupKind,
  Structure,
} from '@muebles/domain';
import {
  PATAS_ROLE,
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
} from '@muebles/domain';

export type ModuleRolesSource = {
  readonly components?: readonly { readonly componentId: string }[];
  readonly structureId?: string;
  readonly agregados?: readonly { readonly agregadoId: string }[];
  readonly hardwareLines?: readonly {
    readonly optionRole: string;
    readonly hardwareId?: string;
  }[];
  readonly baseMode?: ModuleBaseMode;
};

export function optionGroupsForBoardParts(
  groups: readonly OptionGroup[],
): OptionGroup[] {
  return groups.filter((g) => g.kind === 'board' || g.kind === 'edge');
}

export function optionGroupsForHardware(
  groups: readonly OptionGroup[],
): OptionGroup[] {
  return groups.filter((g) => g.kind === 'hardware');
}

export function optionGroupsByKind(
  groups: readonly OptionGroup[],
  kind: OptionGroupKind,
): OptionGroup[] {
  return groups.filter((g) => g.kind === kind);
}

export function usedOptionRolesForModule(
  module: ModuleRolesSource,
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): Set<string> {
  const usedRoles = new Set<string>();

  const addComponentRoles = (componentId: string) => {
    if (!catalogComponents) return;
    const comp = catalogComponents.find((c) => c.id === componentId);
    if (comp) {
      for (const role of comp.optionRoles) {
        if (role.trim()) usedRoles.add(role.trim());
      }
    }
  };

  const addAgregadoRoles = (agregadoId: string) => {
    if (!catalogAgregados) return;
    const agr = catalogAgregados.find((a) => a.id === agregadoId);
    if (!agr) return;
    for (const cInst of agr.components ?? []) {
      addComponentRoles(cInst.componentId);
    }
    for (const hLine of agr.hardwareLines ?? []) {
      if (!hLine.hardwareId && hLine.optionRole?.trim()) {
        usedRoles.add(hLine.optionRole.trim());
      }
    }
  };

  for (const line of module.hardwareLines ?? []) {
    if (line.hardwareId) continue;
    if (line.optionRole?.trim()) usedRoles.add(line.optionRole.trim());
  }
  if (module.components) {
    for (const inst of module.components) {
      addComponentRoles(inst.componentId);
    }
  }
  if (module.agregados) {
    for (const agrInst of module.agregados) {
      addAgregadoRoles(agrInst.agregadoId);
    }
  }
  if (module.structureId && catalogStructures) {
    const structure = catalogStructures.find((s) => s.id === module.structureId);
    if (structure) {
      for (const inst of structure.components ?? []) {
        addComponentRoles(inst.componentId);
      }
      for (const agrInst of structure.agregados ?? []) {
        addAgregadoRoles(agrInst.agregadoId);
      }
    }
  }
  if (module.baseMode === 'plinth_board') usedRoles.add(ZOCLO_BOARD_ROLE);
  if (module.baseMode === 'plinth_strip') usedRoles.add(ZOCLO_STRIP_ROLE);
  if (module.baseMode === 'legs') usedRoles.add(PATAS_ROLE);
  return usedRoles;
}

export function defaultOptionChoicesForModule(
  module: ModuleRolesSource,
  optionGroups: readonly OptionGroup[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): Record<string, string> {
  const usedRoles = usedOptionRolesForModule(
    module,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );

  const choices: Record<string, string> = {};
  for (const group of optionGroups) {
    if (!usedRoles.has(group.code)) continue;
    const first = group.optionIds[0];
    if (first) {
      choices[group.code] = first;
    }
  }
  return choices;
}

export type BoardFinishPickerOption = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly previewColor?: string;
  readonly grainDefault: boolean;
};

export type BoardFinishPickerGroup = {
  readonly code: string;
  readonly name: string;
  readonly options: readonly BoardFinishPickerOption[];
};

export function boardFinishPickerGroupsForModule(
  module: ModuleRolesSource,
  optionGroups: readonly OptionGroup[],
  materials: readonly {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly previewColor?: string;
    readonly grainDefault: boolean;
    readonly active?: boolean;
  }[],
  catalogComponents?: readonly Component[],
  catalogStructures?: readonly Structure[],
  catalogAgregados?: readonly Agregado[],
): BoardFinishPickerGroup[] {
  const usedRoles = usedOptionRolesForModule(
    module,
    catalogComponents,
    catalogStructures,
    catalogAgregados,
  );
  const byId = new Map(materials.map((m) => [m.id, m]));
  const result: BoardFinishPickerGroup[] = [];

  for (const group of optionGroups) {
    if (group.kind !== 'board') continue;
    if (!usedRoles.has(group.code)) continue;
    const options: BoardFinishPickerOption[] = [];
    for (const id of group.optionIds) {
      const mat = byId.get(id);
      if (!mat) continue;
      if (mat.active === false) continue;
      options.push({
        id: mat.id,
        code: mat.code,
        name: mat.name,
        previewColor: mat.previewColor,
        grainDefault: mat.grainDefault,
      });
    }
    if (options.length === 0) continue;
    result.push({
      code: group.code,
      name: group.name,
      options,
    });
  }
  return result;
}
