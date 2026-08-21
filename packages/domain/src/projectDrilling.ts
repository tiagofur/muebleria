/**
 * Project drilling assembler (F130) — the real data source.
 *
 * Walks the project like generateCutRows does, and for every piece merges
 * MANUAL hardware placements (component instances) with DERIVED joint
 * placements (F129 rules), then resolves them through the F128 engine.
 * Output keys on the workshop labelRef so DXF exports join losslessly, and
 * degrades to the F074 heuristics per piece when nothing better exists.
 */

import { generateCutRowsWithLinks, type CutRowPieceLink } from './engine/cut';
import { resolveBom } from './engine/bom';
import {
  deriveJointHardwarePlacements,
  type DerivedJointPlacement,
  type JointPart,
} from './jointDrillingRules';
import { resolvePartDrilling, type ResolvedPartDrilling } from './partDrillingResolver';
import { effectiveOptionChoices } from './optionChoices';
import type {
  Catalog,
  HardwarePlacement,
  JointDrillingRules,
  ModuleComponentInstance,
  Project,
  ResolvedBoardPart,
  Structure,
} from './types';
import type { PartDrillingPattern, ProjectDrillingData } from './partDrilling';

export interface ResolveProjectDrillingParams {
  readonly project: Project;
  readonly catalog: Catalog;
  /** Workshop/structure rules for derived joints (F129); defaults when omitted. */
  readonly jointRules?: JointDrillingRules;
  readonly generatedAt?: string;
}

export interface ProjectDrillingResult {
  /** Full engine output per piece (issues + fallback flag included). */
  readonly patterns: readonly ResolvedPartDrilling[];
  /** Schema `muebles.drilling-data.v1` payload (same shape the report exports). */
  readonly data: ProjectDrillingData;
  readonly links: readonly CutRowPieceLink[];
}

/**
 * Manual placements for one expanded part id: instances of the source
 * component carry overrides.hardwarePlacements that apply to every copy.
 * Structure + module level instances; agregado-scoped placements are F131.
 */
function manualPlacementsForPart(
  instances: readonly ModuleComponentInstance[],
  partId: string,
): HardwarePlacement[] {
  const out: HardwarePlacement[] = [];
  for (const instance of instances) {
    const placements = instance.overrides?.hardwarePlacements;
    if (!placements || placements.length === 0) continue;
    // Expanded ids are `${componentId}-copy-${i}` (agregados carry a prefix —
    // suffix match keeps the join working for both).
    const marker = '-copy-';
    const idx = partId.indexOf(marker);
    const stem = idx > 0 ? partId.slice(0, idx) : partId;
    if (stem === instance.componentId || partId.startsWith(instance.componentId)) {
      out.push(...placements);
    }
  }
  return out;
}

function instancesForModule(
  module: { readonly structureId?: string },
  structures: readonly Structure[],
  moduleInstances: readonly ModuleComponentInstance[] | undefined,
): readonly ModuleComponentInstance[] {
  const structure = structures.find((s) => s.id === module.structureId);
  return [
    ...(structure?.components ?? []),
    ...(moduleInstances ?? []),
  ];
}

/**
 * Resolve real drilling data for a whole project. Pure: same inputs → same
 * output. Pieces whose hardware yields no placements keep the F074 fallback
 * (marked `fallbackUsed`) so downstream exports never lose their drilling.
 */
export function resolveProjectDrilling(
  params: ResolveProjectDrillingParams,
): ProjectDrillingResult {
  const { project, catalog, jointRules, generatedAt } = params;
  const { links } = generateCutRowsWithLinks(project, catalog);

  // Resolve each unique module ONCE (placements + derived joints are per
  // module template; identical copies share the same holes).
  const derivedByModule = new Map<string, DerivedJointPlacement[]>();
  const placementsByModule = new Map<string, HardwarePlacement[]>();
  const partsByModule = new Map<string, readonly ResolvedBoardPart[]>();

  for (const item of project.items) {
    if (!(item.quantity > 0)) continue;
    const module = catalog.modules.find((m) => m.id === item.moduleId);
    if (!module) continue;
    if (partsByModule.has(module.id)) continue;

    const choices = effectiveOptionChoices(
      item.optionChoices,
      project.projectLevelChoices,
    );
    let parts: readonly ResolvedBoardPart[];
    try {
      parts = resolveBom(module, choices, catalog, item.measurePresetId).boardParts;
    } catch {
      continue; // unresolvable items are reported by the BOM path, not here
    }
    partsByModule.set(module.id, parts);

    const instances = instancesForModule(
      module,
      catalog.structures ?? [],
      module.components,
    );
    const manual: HardwarePlacement[] = [];
    for (const part of parts) {
      manual.push(...manualPlacementsForPart(instances, part.id));
    }
    placementsByModule.set(module.id, manual);

    derivedByModule.set(
      module.id,
      deriveJointHardwarePlacements({
        parts: parts as readonly JointPart[],
        hardware: catalog.hardware,
        rules:
          jointRules ??
          catalog.structures?.find((s) => s.id === module.structureId)
            ?.jointDrillingRules,
      }),
    );
  }

  // Map partId → module for link joins (first module owning the part wins;
  // duplicated module lines share geometry so holes are identical).
  const moduleByPartId = new Map<string, string>();
  for (const [moduleId, parts] of partsByModule) {
    for (const part of parts) {
      if (!moduleByPartId.has(part.id)) moduleByPartId.set(part.id, moduleId);
    }
  }

  const patterns: ResolvedPartDrilling[] = [];
  let totalHoles = 0;
  for (const link of links) {
    const moduleId = moduleByPartId.get(link.partId);
    const module = moduleId ? catalog.modules.find((m) => m.id === moduleId) : undefined;
    const instances = module
      ? instancesForModule(module, catalog.structures ?? [], module.components)
      : [];
    const manualForPart = manualPlacementsForPart(instances, link.partId);
    const derivedForPart = (moduleId ? derivedByModule.get(moduleId) ?? [] : []).filter(
      (p) => p.partId === link.partId,
    );

    const resolved = resolvePartDrilling({
      piece: link.part,
      placements: [...manualForPart, ...derivedForPart],
      hardwareCatalog: catalog.hardware,
    });

    patterns.push({
      ...resolved,
      pieceCode: link.labelRef,
      moduleCode: link.moduleCode,
      partName: link.part.description,
    });
    totalHoles += resolved.holes.length;
  }

  const plain: readonly PartDrillingPattern[] = patterns.map((p) => ({
    pieceCode: p.pieceCode,
    moduleCode: p.moduleCode,
    partName: p.partName,
    lengthMm: p.lengthMm,
    widthMm: p.widthMm,
    materialName: p.materialName,
    holes: p.holes,
  }));

  return {
    patterns,
    links,
    data: {
      schema: 'muebles.drilling-data.v1',
      projectId: project.id,
      projectName: project.name,
      generatedAt: generatedAt ?? new Date().toISOString(),
      totalPiecesCount: plain.length,
      totalHolesCount: totalHoles,
      patterns: plain,
    },
  };
}
