/**
 * Pure deep-copy helpers for modules and projects (MOD-05 / F015).
 * No I/O, no catalog mutation — callers append the returned entity.
 */

import type { BoardPart, HardwareLine, Module, Project, ProjectItem } from './types';

function normalizeCodeKey(code: string): string {
  return code.trim().toLocaleUpperCase('es-UY');
}

/**
 * Suggest a unique code for a duplicate: `${code}-COPY`, then `-COPY2`, `-COPY3`, …
 * Comparison is case-insensitive (trim + upper).
 */
export function suggestDuplicateCode(
  code: string,
  existingCodes: readonly string[],
): string {
  const taken = new Set(
    existingCodes.map(normalizeCodeKey).filter((c) => c.length > 0),
  );
  const base = `${code.trim()}-COPY`;
  if (!taken.has(normalizeCodeKey(base))) {
    return base;
  }
  let n = 2;
  for (;;) {
    const candidate = `${code.trim()}-COPY${n}`;
    if (!taken.has(normalizeCodeKey(candidate))) {
      return candidate;
    }
    n += 1;
  }
}

export type DuplicateModuleOptions = {
  readonly newId: string;
  readonly newCode: string;
  readonly newName?: string;
  /** Factory for nested boardPart / hardwareLine ids. Defaults to crypto.randomUUID. */
  readonly nextNestedId?: () => string;
};

function defaultNestedId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneBoardPart(part: BoardPart, newId: string): BoardPart {
  return {
    id: newId,
    code: part.code,
    description: part.description,
    quantity: part.quantity,
    lengthMm: part.lengthMm,
    widthMm: part.widthMm,
    edges: part.edges.map((e) => ({ side: e.side, enabled: e.enabled })),
    optionRole: part.optionRole,
  };
}

function cloneHardwareLine(line: HardwareLine, newId: string): HardwareLine {
  return {
    id: newId,
    quantity: line.quantity,
    descriptionOverride: line.descriptionOverride,
    optionRole: line.optionRole,
    hardwareId: line.hardwareId,
  };
}

/**
 * Deep-copy a module template with a new id/code and fresh nested entity ids.
 * Does not mutate the original module. Preserves optional categoryId.
 */
export function duplicateModule(
  module: Module,
  options: DuplicateModuleOptions,
): Module {
  const nextId = options.nextNestedId ?? defaultNestedId;
  return {
    id: options.newId,
    code: options.newCode,
    name: options.newName ?? `${module.name} (copia)`,
    categoryId: module.categoryId,
    externalDims: module.externalDims
      ? {
          width: module.externalDims.width,
          height: module.externalDims.height,
          depth: module.externalDims.depth,
        }
      : undefined,
    baseLaborCost: module.baseLaborCost,
    notes: module.notes,
    boardParts: module.boardParts.map((p) => cloneBoardPart(p, nextId())),
    hardwareLines: module.hardwareLines.map((l) => cloneHardwareLine(l, nextId())),
  };
}

export type DuplicateProjectOptions = {
  readonly newId: string;
  /** New id for each copied project item. */
  readonly itemIdFactory: () => string;
  readonly nowIso: string;
  readonly newName?: string;
};

/**
 * Deep-copy a project as a fresh draft: new item ids, same moduleId + choices,
 * no priceSnapshot. Does not mutate the original or master modules.
 */
export function duplicateProject(
  project: Project,
  options: DuplicateProjectOptions,
): Project {
  const items: ProjectItem[] = project.items.map((item) => ({
    id: options.itemIdFactory(),
    moduleId: item.moduleId,
    quantity: item.quantity,
    optionChoices: { ...item.optionChoices },
  }));

  return {
    id: options.newId,
    name: options.newName ?? `${project.name} (copia)`,
    customerId: project.customerId,
    createdBy: project.createdBy,
    currency: project.currency,
    marginFactor: project.marginFactor,
    laborFixedCost: project.laborFixedCost,
    status: 'draft',
    items,
    projectLevelChoices: project.projectLevelChoices
      ? { ...project.projectLevelChoices }
      : undefined,
    notes: project.notes,
    createdAt: options.nowIso,
    updatedAt: options.nowIso,
  };
}
