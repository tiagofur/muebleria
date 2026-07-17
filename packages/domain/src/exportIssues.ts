/**
 * Collect actionable export validation issues (PRD §8.3 / VAL-01..07) without throwing.
 */

import { DomainError } from './errors';
import {
  resolveBom,
  validateBoardPart,
  validateHardwareLine,
} from './engine';
import { effectiveOptionChoices } from './optionChoices';
import type {
  Catalog,
  Module,
  OptionChoices,
  Project,
  ProjectItem,
} from './types';

/** Actionable export problem for UI lists (module / part / field). */
export interface ExportIssue {
  readonly message: string;
  readonly field: string;
  readonly moduleCode?: string;
  readonly partCode?: string;
  readonly partId?: string;
  readonly projectItemId?: string;
  readonly optionGroupCode?: string;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Map a domain error context into an ExportIssue for UI display. */
export function domainErrorToExportIssue(
  error: DomainError,
  extras?: Partial<ExportIssue>,
): ExportIssue {
  const ctx = error.context ?? {};
  return {
    message: error.message,
    field: asOptionalString(ctx.field) ?? extras?.field ?? 'unknown',
    moduleCode:
      asOptionalString(ctx.moduleCode) ?? extras?.moduleCode,
    partCode: asOptionalString(ctx.partCode) ?? extras?.partCode,
    partId: asOptionalString(ctx.partId) ?? extras?.partId,
    projectItemId:
      asOptionalString(ctx.projectItemId) ?? extras?.projectItemId,
    optionGroupCode:
      asOptionalString(ctx.optionGroupCode) ?? extras?.optionGroupCode,
  };
}

function pushDomainError(
  issues: ExportIssue[],
  error: unknown,
  extras?: Partial<ExportIssue>,
): void {
  if (error instanceof DomainError) {
    issues.push(domainErrorToExportIssue(error, extras));
    return;
  }
  issues.push({
    message: error instanceof Error ? error.message : String(error),
    field: extras?.field ?? 'unknown',
    moduleCode: extras?.moduleCode,
    partCode: extras?.partCode,
    partId: extras?.partId,
    projectItemId: extras?.projectItemId,
    optionGroupCode: extras?.optionGroupCode,
  });
}

function collectMissingChoiceIssues(
  module: Module,
  optionChoices: OptionChoices,
  catalog: Catalog,
  projectItemId: string,
  issues: ExportIssue[],
): void {
  const roles = new Set<string>();
  for (const part of module.boardParts) {
    if (part.optionRole?.trim()) roles.add(part.optionRole);
  }
  for (const line of module.hardwareLines) {
    if (!line.hardwareId && line.optionRole?.trim()) {
      roles.add(line.optionRole);
    }
  }

  for (const role of roles) {
    const choiceId = optionChoices[role];
    if (choiceId) continue;
    const group = catalog.optionGroups.find((g) => g.code === role);
    const required = group?.required !== false;
    if (!required && group) continue;
    issues.push({
      message: `Falta opción requerida "${role}" en el módulo ${module.code}`,
      field: 'optionChoices',
      moduleCode: module.code,
      projectItemId,
      optionGroupCode: role,
    });
  }
}

function collectItemStructuralIssues(
  item: ProjectItem,
  catalog: Catalog,
  issues: ExportIssue[],
  projectLevelChoices?: OptionChoices,
): Module | undefined {
  const before = issues.length;
  const choices = effectiveOptionChoices(
    item.optionChoices,
    projectLevelChoices,
  );

  if (!(item.quantity > 0)) {
    issues.push({
      message: `Project item quantity must be > 0 (got ${item.quantity})`,
      field: 'quantity',
      projectItemId: item.id,
    });
  }

  const module = catalog.modules.find((m) => m.id === item.moduleId);
  if (!module) {
    issues.push({
      message: `Module not found for project item: ${item.moduleId}`,
      field: 'moduleId',
      projectItemId: item.id,
    });
    return undefined;
  }

  for (const part of module.boardParts) {
    try {
      validateBoardPart(part, module.code);
    } catch (error) {
      pushDomainError(issues, error, {
        moduleCode: module.code,
        partId: part.id,
        partCode: part.code,
        projectItemId: item.id,
      });
    }
    if (!part.description?.trim()) {
      issues.push({
        message: 'Board part description must not be empty',
        field: 'description',
        moduleCode: module.code,
        partId: part.id,
        projectItemId: item.id,
      });
    }
    if (!part.optionRole?.trim()) {
      issues.push({
        message: 'Board part optionRole must not be empty',
        field: 'optionRole',
        moduleCode: module.code,
        partId: part.id,
        projectItemId: item.id,
      });
    }
  }

  for (const line of module.hardwareLines) {
    try {
      validateHardwareLine(line, module.code);
    } catch (error) {
      pushDomainError(issues, error, {
        moduleCode: module.code,
        projectItemId: item.id,
      });
    }
  }

  collectMissingChoiceIssues(module, choices, catalog, item.id, issues);

  // Resolve BOM only when local structure/options look complete (VAL-06, refs, edges).
  if (issues.length === before) {
    try {
      resolveBom(module, choices, catalog, item.measurePresetId);
    } catch (error) {
      pushDomainError(issues, error, {
        moduleCode: module.code,
        projectItemId: item.id,
      });
    }
  }

  return module;
}
/**
 * Validate a project for Optimizer export. Returns all actionable issues;
 * empty array means export may proceed (`generateCutRows` should succeed).
 */
export function collectExportIssues(
  project: Project,
  catalog: Catalog,
): readonly ExportIssue[] {
  const issues: ExportIssue[] = [];
  let boardPartSlots = 0;

  if (project.items.length === 0) {
    return [
      {
        message: 'no hay piezas de tablero para exportar',
        field: 'boardParts',
      },
    ];
  }

  for (const item of project.items) {
    const module = collectItemStructuralIssues(
      item,
      catalog,
      issues,
      project.projectLevelChoices,
    );
    if (module) {
      boardPartSlots += module.boardParts.length;
    }
  }

  if (boardPartSlots === 0) {
    const already = issues.some((i) => i.field === 'boardParts');
    if (!already) {
      issues.push({
        message: 'no hay piezas de tablero para exportar',
        field: 'boardParts',
      });
    }
  }

  return issues;
}
