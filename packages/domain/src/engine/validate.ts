/**
 * Domain validations: catalog entity integrity, board parts, components, hardware
 * lines, modules and structures, plus the project-status helper used by pricing.
 */

import { ValidationError } from '../errors';
import { validateModulePresets } from '../measurePresets';
import type {
  AmbientMaterial,
  AmbientSurfaceType,
  BoardPart,
  Catalog,
  Component,
  HardwareLine,
  KitchenSpace,
  Module,
  ProjectStatus,
  Structure,
} from '../types';

/** Valid ambient surface types (spec #4148). Runtime guard for untrusted input. */
const AMBIENT_SURFACE_TYPES: ReadonlySet<AmbientSurfaceType> = new Set([
  'floor',
  'wall',
]);

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
  // Ambient materials (spec #4148): presentation-only, separate code namespace.
  const seenAmbientCodes = new Set<string>();
  for (const a of catalog.ambientMaterials ?? []) {
    if (!a.code?.trim() || !a.name?.trim()) {
      throw new ValidationError(
        'Ambient material code and name must not be empty',
        { ambientMaterialId: a.id, field: 'code/name' },
      );
    }
    if (!AMBIENT_SURFACE_TYPES.has(a.surfaceType)) {
      throw new ValidationError(
        `Ambient material surfaceType must be 'floor' or 'wall' (got '${a.surfaceType}')`,
        {
          ambientMaterialId: a.id,
          ambientMaterialCode: a.code,
          field: 'surfaceType',
          surfaceType: a.surfaceType,
        },
      );
    }
    if (seenAmbientCodes.has(a.code)) {
      throw new ValidationError(
        `Ambient material code must be unique within the collection (duplicate '${a.code}')`,
        {
          ambientMaterialId: a.id,
          ambientMaterialCode: a.code,
          field: 'code',
        },
      );
    }
    seenAmbientCodes.add(a.code);
  }
}

/**
 * Validate KitchenSpace ambient refs (spec #4148 / design #4151).
 *
 * For each space, `floorMaterialId` must resolve to an ACTIVE ambient material
 * with `surfaceType === 'floor'`; `wallMaterialId` must resolve to an ACTIVE
 * ambient material with `surfaceType === 'wall'`. Mismatched surfaceType,
 * inactive, or unknown id produce a ValidationError.
 *
 * Returns a collected array (does NOT throw) so the project-validation path can
 * surface all ref errors at once. Separate from `validateCatalogEntityCodes`
 * because refs live on KitchenSpace, not Catalog.
 */
export function validateAmbientRefs(
  ambientMaterials: readonly AmbientMaterial[],
  spaces: readonly KitchenSpace[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const sp of spaces) {
    if (sp.floorMaterialId) {
      const err = resolveAmbientRef(
        ambientMaterials,
        sp.floorMaterialId,
        'floor',
        sp.id,
        'floorMaterialId',
      );
      if (err) errors.push(err);
    }
    if (sp.wallMaterialId) {
      const err = resolveAmbientRef(
        ambientMaterials,
        sp.wallMaterialId,
        'wall',
        sp.id,
        'wallMaterialId',
      );
      if (err) errors.push(err);
    }
    if (sp.ceilingMaterialId) {
      const err = resolveAmbientRef(
        ambientMaterials,
        sp.ceilingMaterialId,
        'wall',
        sp.id,
        'ceilingMaterialId',
      );
      if (err) errors.push(err);
    }
  }
  return errors;
}

function resolveAmbientRef(
  ambientMaterials: readonly AmbientMaterial[],
  materialId: string,
  expectedSurface: AmbientSurfaceType,
  spaceId: string,
  field: string,
): ValidationError | undefined {
  const found = ambientMaterials.find((a) => a.id === materialId);
  if (!found) {
    return new ValidationError(
      `Ambient material ref '${field}' points to an unknown id '${materialId}'`,
      { spaceId, field, materialId },
    );
  }
  if (!found.active) {
    return new ValidationError(
      `Ambient material ref '${field}' points to an inactive material '${materialId}'`,
      { spaceId, field, materialId },
    );
  }
  if (found.surfaceType !== expectedSurface) {
    return new ValidationError(
      `Ambient material ref '${field}' must resolve to a '${expectedSurface}' surface (got '${found.surfaceType}')`,
      {
        spaceId,
        field,
        materialId,
        expectedSurfaceType: expectedSurface,
        actualSurfaceType: found.surfaceType,
      },
    );
  }
  return undefined;
}

/** PRD §7.4 — quoted/accepted freeze catalog unit prices. */
export function isProjectClosed(status: ProjectStatus): boolean {
  return status === 'quoted' || status === 'accepted' || status === 'produced';
}

/**
 * Design / items / kitchen layout / commercial meta may only change in draft.
 * quoted / accepted / produced are view-only for content (workflow buttons change status).
 * Issue #257 — taller freeze rules.
 */
export function projectAllowsContentMutation(
  status: ProjectStatus | string | null | undefined,
): boolean {
  return status === 'draft';
}

/**
 * Who may reopen which status → draft (#257).
 * - **quoted**: vendedor / gerente / admin (client wants changes before accept)
 * - **accepted | produced**: only **admin** (and gerente) emergency override —
 *   vendedor never after accept. Admin “can do everything”.
 */
export function projectAllowsReopenToDraft(
  status: ProjectStatus | string | null | undefined,
  role?: string | null,
): boolean {
  if (status === 'quoted') return true;
  if (status === 'accepted' || status === 'produced') {
    return role === 'admin' || role === 'gerente_ventas';
  }
  return false;
}
