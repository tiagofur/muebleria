/**
 * Pure deep-copy helpers for modules and projects (MOD-05 / F015).
 * No I/O, no catalog mutation — callers append the returned entity.
 */

import type {
  HardwareLine,
  InstallationChecklistItem,
  Module,
  ModuleComponentInstance,
  Project,
  ProjectItem,
  ProjectTemplate,
} from './types';

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

function cloneComponentInstance(c: ModuleComponentInstance): ModuleComponentInstance {
  return {
    componentId: c.componentId,
    quantity: c.quantity,
    placementOverride: c.placementOverride,
    overrides: c.overrides
      ? {
          edges: c.overrides.edges
            ? c.overrides.edges.map((e) => ({ side: e.side, enabled: e.enabled }))
            : undefined,
          notes: c.overrides.notes,
          lengthFormula: c.overrides.lengthFormula,
          widthFormula: c.overrides.widthFormula,
        }
      : undefined,
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
 * Does not mutate the original module. Preserves optional categoryId,
 * structureId reference, and component instances.
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
    structureId: module.structureId,
    components: module.components?.map(cloneComponentInstance),
    externalDims: module.externalDims
      ? {
          width: module.externalDims.width,
          height: module.externalDims.height,
          depth: module.externalDims.depth,
        }
      : undefined,
    presets: module.presets
      ? module.presets.map((p) => ({
          id: nextId(),
          name: p.name,
          width: p.width,
          height: p.height,
          depth: p.depth,
        }))
      : undefined,
    baseLaborCost: module.baseLaborCost,
    notes: module.notes,
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
    measurePresetId: item.measurePresetId,
  }));

  // Remap kitchen placements to new item ids (same order).
  const oldIds = project.items.map((it) => it.id);
  const idMap = new Map(oldIds.map((id, i) => [id, items[i]!.id]));
  const kitchenLayout = project.kitchenLayout
    ? {
        walls: project.kitchenLayout.walls.map((w) => ({ ...w })),
        placements: project.kitchenLayout.placements
          .map((p) => {
            const newItemId = idMap.get(p.itemId);
            if (!newItemId) return null;
            return { ...p, itemId: newItemId };
          })
          .filter((p): p is NonNullable<typeof p> => p != null),
      }
    : undefined;

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
    kitchenLayout,
    notes: project.notes,
    createdAt: options.nowIso,
    updatedAt: options.nowIso,
  };
}

// --- Project templates (#110 / H15) ---

export type ProjectToTemplateOptions = {
  readonly newId: string;
  readonly name?: string;
  readonly nowIso: string;
};

/**
 * Extract a reusable `ProjectTemplate` from an existing project (#110 / H15).
 * Carries the clonable fields (items without structureRevisionPin, choices,
 * measureDefaults, kitchenLayout, installationChecklist, notes, default
 * currency/margin/labor). Drops customer/status/owner/snapshot/nestingImport —
 * those belong to a real quote, not a template.
 */
export function projectToTemplate(
  project: Project,
  options: ProjectToTemplateOptions,
): ProjectTemplate {
  const items: ProjectItem[] = project.items.map((item) => ({
    id: item.id,
    moduleId: item.moduleId,
    quantity: item.quantity,
    optionChoices: { ...item.optionChoices },
    measurePresetId: item.measurePresetId,
    // structureRevisionPin intentionally dropped: a fresh quote from this
    // template resolves against the live structure revision.
  }));
  return {
    id: options.newId,
    name: options.name?.trim() || `${project.name} (plantilla)`,
    currency: project.currency,
    marginFactor: project.marginFactor,
    laborFixedCost: project.laborFixedCost,
    items,
    projectLevelChoices: project.projectLevelChoices
      ? { ...project.projectLevelChoices }
      : undefined,
    measureDefaults: project.measureDefaults
      ? copyMeasureDefaults(project.measureDefaults)
      : undefined,
    kitchenLayout: project.kitchenLayout
      ? {
          walls: project.kitchenLayout.walls.map((w) => ({ ...w })),
          placements: project.kitchenLayout.placements.map((p) => ({ ...p })),
        }
      : undefined,
    installationChecklist: project.installationChecklist
      ? project.installationChecklist.map(copyChecklistItem)
      : undefined,
    notes: project.notes,
    createdAt: options.nowIso,
    updatedAt: options.nowIso,
  };
}

export type CreateProjectFromTemplateOptions = {
  readonly newId: string;
  readonly itemIdFactory: () => string;
  readonly nowIso: string;
  /** Customer for the new quote (templates carry none). */
  readonly customerId: string;
  readonly name: string;
  readonly ownerUserId?: string;
  readonly createdBy?: string;
};

/**
 * Clone an editable draft `Project` from a template (#110 / H15). Mints fresh
 * project + item ids, remaps kitchenLayout placements to the new item ids
 * (positional idMap, same convention as duplicateProject), and assigns the
 * provided customer/owner/createdBy. Status is always 'draft', no snapshot.
 */
export function createProjectFromTemplate(
  template: ProjectTemplate,
  options: CreateProjectFromTemplateOptions,
): Project {
  const items: ProjectItem[] = template.items.map((item) => ({
    id: options.itemIdFactory(),
    moduleId: item.moduleId,
    quantity: item.quantity,
    optionChoices: { ...item.optionChoices },
    measurePresetId: item.measurePresetId,
  }));

  // Remap kitchen placements to the new item ids (same order).
  const oldIds = template.items.map((it) => it.id);
  const idMap = new Map(oldIds.map((id, i) => [id, items[i]!.id]));
  const kitchenLayout = template.kitchenLayout
    ? {
        walls: template.kitchenLayout.walls.map((w) => ({ ...w })),
        placements: template.kitchenLayout.placements
          .map((p) => {
            const newItemId = idMap.get(p.itemId);
            if (!newItemId) return null;
            return { ...p, itemId: newItemId };
          })
          .filter((p): p is NonNullable<typeof p> => p != null),
      }
    : undefined;

  return {
    id: options.newId,
    name: options.name.trim(),
    customerId: options.customerId,
    createdBy: options.createdBy,
    ownerUserId: options.ownerUserId,
    currency: template.currency,
    marginFactor: template.marginFactor,
    laborFixedCost: template.laborFixedCost,
    status: 'draft',
    items,
    projectLevelChoices: template.projectLevelChoices
      ? { ...template.projectLevelChoices }
      : undefined,
    measureDefaults: template.measureDefaults
      ? copyMeasureDefaults(template.measureDefaults)
      : undefined,
    kitchenLayout,
    installationChecklist: template.installationChecklist
      ? template.installationChecklist.map(copyChecklistItem)
      : undefined,
    notes: template.notes,
    createdAt: options.nowIso,
    updatedAt: options.nowIso,
  };
}

type MeasureDefaults = NonNullable<ProjectTemplate['measureDefaults']>;

function copyMeasureDefaults(src: MeasureDefaults): MeasureDefaults {
  const out: Record<string, { depth?: number; height?: number }> = {};
  for (const [type, dims] of Object.entries(src)) {
    if (!dims) continue;
    const copy: { depth?: number; height?: number } = {};
    if (typeof dims.depth === 'number') copy.depth = dims.depth;
    if (typeof dims.height === 'number') copy.height = dims.height;
    out[type] = copy;
  }
  return out as unknown as MeasureDefaults;
}

function copyChecklistItem(item: InstallationChecklistItem): InstallationChecklistItem {
  return { ...item };
}
