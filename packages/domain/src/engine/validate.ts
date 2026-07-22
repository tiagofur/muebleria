/**
 * Domain validations: catalog entity integrity, board parts, components, hardware
 * lines, modules and structures, plus the project-status helper used by pricing.
 */

import { ValidationError } from '../errors';
import { validateModulePresets } from '../measurePresets';
import type {
  BoardPart,
  Catalog,
  Component,
  HardwareLine,
  Module,
  ProjectStatus,
  Structure,
} from '../types';

/** VAL-01, VAL-04 (structure), basic part integrity at resolution time. */
export function validateBoardPart(
  part: BoardPart,
  moduleCode?: string,
): void {
  if (!(part.lengthMm > 0) || !(part.widthMm > 0)) {
    throw new ValidationError(
      `Board part dimensions must be > 0 (lengthMm=${part.lengthMm}, widthMm=${part.widthMm})`,
      {
        moduleCode,
        partId: part.id,
        partCode: part.code,
        field: 'lengthMm/widthMm',
        lengthMm: part.lengthMm,
        widthMm: part.widthMm,
      },
    );
  }

  if (!(part.quantity > 0)) {
    throw new ValidationError(
      `Board part quantity must be > 0 (got ${part.quantity})`,
      {
        moduleCode,
        partId: part.id,
        field: 'quantity',
        quantity: part.quantity,
      },
    );
  }

  if (part.edges.length !== 4) {
    throw new ValidationError(
      `Board part must define exactly 4 edge assignments (got ${part.edges.length})`,
      {
        moduleCode,
        partId: part.id,
        field: 'edges',
      },
    );
  }

  const sides = new Set(part.edges.map((e) => e.side));
  for (const side of ['L1', 'L2', 'W1', 'W2'] as const) {
    if (!sides.has(side)) {
      throw new ValidationError(
        `Board part missing edge side ${side}`,
        { moduleCode, partId: part.id, field: 'edges', side },
      );
    }
  }
}

/**
 * Validate a reusable component (F049 / H07).
 * Checks code, name, geometry dimensions, optionRoles, and edge assignments.
 */
export function validateComponent(component: Component): void {
  if (!component.code?.trim()) {
    throw new ValidationError('Component code must not be empty', {
      componentId: component.id,
      field: 'code',
    });
  }
  if (!component.name?.trim()) {
    throw new ValidationError('Component name must not be empty', {
      componentId: component.id,
      componentCode: component.code,
      field: 'name',
    });
  }
  if (component.geometry.kind === 'rectangular_board') {
    if (!(component.geometry.lengthMm > 0)) {
      throw new ValidationError('Component lengthMm must be > 0', {
        componentId: component.id,
        componentCode: component.code,
        field: 'lengthMm',
        lengthMm: component.geometry.lengthMm,
      });
    }
    if (!(component.geometry.widthMm > 0)) {
      throw new ValidationError('Component widthMm must be > 0', {
        componentId: component.id,
        componentCode: component.code,
        field: 'widthMm',
        widthMm: component.geometry.widthMm,
      });
    }
    if (!(component.geometry.thicknessMm > 0)) {
      throw new ValidationError('Component thicknessMm must be > 0', {
        componentId: component.id,
        componentCode: component.code,
        field: 'thicknessMm',
        thicknessMm: component.geometry.thicknessMm,
      });
    }
  }
  if (!component.optionRoles || component.optionRoles.length === 0) {
    throw new ValidationError('Component optionRoles must be non-empty', {
      componentId: component.id,
      componentCode: component.code,
      field: 'optionRoles',
    });
  }
  if (component.defaultEdges.length !== 4) {
    throw new ValidationError(
      'Component defaultEdges must have exactly 4 assignments',
      {
        componentId: component.id,
        componentCode: component.code,
        field: 'edges',
        edges: component.defaultEdges.length,
      },
    );
  }
}

/** VAL-03 for hardware lines. */
export function validateHardwareLine(
  line: HardwareLine,
  moduleCode?: string,
): void {
  if (!(line.quantity > 0)) {
    throw new ValidationError(
      `Hardware line quantity must be > 0 (got ${line.quantity})`,
      {
        moduleCode,
        hardwareLineId: line.id,
        field: 'quantity',
        quantity: line.quantity,
      },
    );
  }
}

/** VAL-07 catalog/module empty names/codes + component instance integrity. */
export function validateModule(module: Module): void {
  if (!module.code?.trim()) {
    throw new ValidationError('Module code must not be empty', {
      moduleId: module.id,
      field: 'code',
    });
  }
  if (!module.name?.trim()) {
    throw new ValidationError('Module name must not be empty', {
      moduleId: module.id,
      moduleCode: module.code,
      field: 'name',
    });
  }

  // Module-level component instances (doors, shelves, …).
  for (const instance of module.components ?? []) {
    if (!instance.componentId?.trim()) {
      throw new ValidationError(
        'Module component instance must reference a componentId',
        {
          moduleCode: module.code,
          field: 'componentId',
        },
      );
    }
    if (!(instance.quantity > 0)) {
      throw new ValidationError(
        `Module component instance quantity must be > 0 (got ${instance.quantity})`,
        {
          moduleCode: module.code,
          componentId: instance.componentId,
          field: 'quantity',
        },
      );
    }
  }

  for (const line of module.hardwareLines) {
    validateHardwareLine(line, module.code);
    if (!line.optionRole?.trim() && !line.hardwareId) {
      throw new ValidationError(
        'Hardware line needs optionRole or fixed hardwareId',
        {
          moduleCode: module.code,
          hardwareLineId: line.id,
          field: 'optionRole',
        },
      );
    }
  }

  validateModulePresets(module);
}

/**
 * Validate engineering Structure (cuerpo) — F049 / #99.
 * A structure composes reusable Component instances (no board parts of its own).
 */
export function validateStructure(structure: Structure): void {
  if (!structure.code?.trim()) {
    throw new ValidationError('Structure code must not be empty', {
      structureId: structure.id,
      field: 'code',
    });
  }
  if (!structure.name?.trim()) {
    throw new ValidationError('Structure name must not be empty', {
      structureId: structure.id,
      structureCode: structure.code,
      field: 'name',
    });
  }
  if (!structure.components || structure.components.length === 0) {
    throw new ValidationError(
      'Structure must have at least one component instance',
      {
        structureId: structure.id,
        structureCode: structure.code,
        field: 'components',
      },
    );
  }

  if (structure.presets) {
    for (const preset of structure.presets) {
      if (preset.width <= 0 || preset.height <= 0 || preset.depth <= 0) {
        throw new ValidationError(
          'Las dimensiones del preset deben ser mayores a 0',
          {
            structureCode: structure.code,
            presetId: preset.id,
            field: 'presets',
          },
        );
      }
    }
  }

  for (const instance of structure.components) {
    if (!instance.componentId?.trim()) {
      throw new ValidationError(
        'Structure component instance must reference a componentId',
        {
          structureCode: structure.code,
          field: 'componentId',
        },
      );
    }
    if (!(instance.quantity > 0)) {
      throw new ValidationError(
        `Structure component instance quantity must be > 0 (got ${instance.quantity})`,
        {
          structureCode: structure.code,
          componentId: instance.componentId,
          field: 'quantity',
        },
      );
    }
  }
}

export function validateCatalogEntityCodes(catalog: Catalog): void {
  for (const m of catalog.materials) {
    if (!m.code?.trim() || !m.name?.trim()) {
      throw new ValidationError(
        'Material code and name must not be empty',
        { materialId: m.id, field: 'code/name' },
      );
    }
  }
  for (const e of catalog.edges) {
    if (!e.code?.trim() || !e.name?.trim()) {
      throw new ValidationError(
        'Edge band code and name must not be empty',
        { edgeBandId: e.id, field: 'code/name' },
      );
    }
  }
  for (const h of catalog.hardware) {
    if (!h.code?.trim() || !h.name?.trim()) {
      throw new ValidationError(
        'Hardware code and name must not be empty',
        { hardwareId: h.id, field: 'code/name' },
      );
    }
  }
  for (const g of catalog.optionGroups) {
    if (!g.code?.trim() || !g.name?.trim()) {
      throw new ValidationError(
        'Option group code and name must not be empty',
        { optionGroupId: g.id, field: 'code/name' },
      );
    }
  }
  for (const mod of catalog.modules) {
    validateModule(mod);
  }
  for (const st of catalog.structures ?? []) {
    validateStructure(st);
  }
}

/** PRD §7.4 — quoted/accepted freeze catalog unit prices. */
export function isProjectClosed(status: ProjectStatus): boolean {
  return status === 'quoted' || status === 'accepted' || status === 'produced';
}
