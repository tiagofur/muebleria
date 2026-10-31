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
import { componentIdFromComposedPartId, resolveBom } from './engine/bom';
import {
  deriveJointHardwarePlacements,
  type DerivedJointPlacement,
  type JointPart,
} from './jointDrillingRules';
import { resolvePartDrilling, type ResolvedPartDrilling } from './partDrillingResolver';
import { effectiveOptionChoices } from './optionChoices';
import type {
  Agregado,
  Catalog,
  HardwarePlacement,
  JointDrillingRules,
  Module,
  ModuleComponentInstance,
  Project,
  ProjectItem,
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
  /** Internal resolution failures; deliberately excluded from data serialization. */
  readonly resolutionIssues: readonly ProjectDrillingResolutionIssue[];
  /** Schema `muebles.drilling-data.v1` payload (same shape the report exports). */
  readonly data: ProjectDrillingData;
  readonly links: readonly CutRowPieceLink[];
}

export interface ProjectDrillingResolutionIssue {
  readonly code: 'DRILLING_BOM_RESOLUTION_FAILED' | 'DRILLING_AGREGADO_HOST_UNRESOLVED';
  readonly message: string;
  readonly projectId: string;
  readonly projectItemId: string;
  readonly moduleId: string;
  readonly stage: 'secondary-bom' | 'agregado-host';
  readonly blocking: true;
}

/**
 * Manual placements for one expanded part id: instances of the source
 * component carry overrides.hardwarePlacements that apply to every copy.
 * Structure + module level instances; agregado-scoped placements resolve
 * through `agregadoManualPlacementsForPart` (F131).
 */
function manualPlacementsForPart(
  instances: readonly ModuleComponentInstance[],
  partId: string,
): HardwarePlacement[] {
  const out: HardwarePlacement[] = [];
  for (const instance of instances) {
    const placements = instance.overrides?.hardwarePlacements;
    if (!placements || placements.length === 0) continue;
    // Composed ids carry the #736 scope prefixes (st-/mod- for structure and
    // module copies, #995 K3-parity); strip before matching the source
    // component. Legacy flat ids equal the componentId verbatim.
    const stem =
      componentIdFromComposedPartId(partId) ?? partId.replace(/^(?:st|mod)-/, '');
    if (stem === instance.componentId) {
      out.push(...placements);
    }
  }
  return out;
}

export interface AgregadoPlacementLookup {
  readonly placements: readonly HardwarePlacement[];
  /**
   * Set ONLY for an `agr-*` part id that could not resolve to its host
   * component (broken link, missing definition or missing component) — the
   * fail-closed signal: the piece's manual drilling is NOT computed and the
   * caller must surface it explicitly, never skip silently.
   */
  readonly unresolved?: string;
}

/**
 * Manual placements authored on an AGREGADO definition's board components
 * (F131). An agregado part id is built as
 * `agr-<agregadoId>-[instance-<iid>-]u<unit>-<componentId>-copy-<k>`
 * (engine/bom.ts resolveComposedModule, #388/#995 K3-parity); placements live
 * on the catalog agregado's components and apply to EVERY unit and copy —
 * identical holes per physical unit, same identity rule as module copies.
 *
 * The id is matched by EXACT PREFIX enumeration (per agregado instance, its
 * repeated-instance tag and its unit range) instead of parsing backwards:
 * commercial ids carry dashes, so a generic regex is ambiguous by
 * construction. Returns `unresolved` when an `agr-*` id matches no instance
 * prefix, definition or component — a data-integrity failure, never a
 * silently-drillless piece.
 */
export function agregadoManualPlacementsForPart(
  partId: string,
  structure: Structure | undefined,
  module: Pick<Module, 'agregados'> | undefined,
  catalogAgregados: readonly Agregado[],
): AgregadoPlacementLookup {
  if (!partId.startsWith('agr-')) return { placements: [] };

  const instances = [
    ...(structure?.agregados ?? []),
    ...(module?.agregados ?? []),
  ];
  const countByAgregadoId = new Map<string, number>();
  for (const inst of instances) {
    countByAgregadoId.set(
      inst.agregadoId,
      (countByAgregadoId.get(inst.agregadoId) ?? 0) + 1,
    );
  }

  for (const inst of instances) {
    // Mirrors bom.ts instanceTag: only repeated instances disambiguate with
    // the persisted instance id (a repeated instance without one throws in
    // the BOM long before drilling runs).
    const tags =
      (countByAgregadoId.get(inst.agregadoId) ?? 0) > 1
        ? [`instance-${(inst.id ?? '').trim()}-`]
        : [''];
    for (const tag of tags) {
      const units = Math.max(1, inst.quantity);
      for (let unit = 0; unit < units; unit++) {
        const prefix = `agr-${inst.agregadoId}-${tag}u${unit}-`;
        if (!partId.startsWith(prefix)) continue;
        const componentId = partId.slice(prefix.length).match(/^(.+)-copy-\d+$/)?.[1];
        const agregado = catalogAgregados.find((a) => a.id === inst.agregadoId);
        const component = agregado?.components?.find(
          (c) => c.componentId === componentId,
        );
        if (!componentId || !component) {
          return { placements: [], unresolved: partId };
        }
        return { placements: component.overrides?.hardwarePlacements ?? [] };
      }
    }
  }
  return { placements: [], unresolved: partId };
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
  // module template; identical copies share the same holes). F144: items with
  // customDims of the same module are distinct templates — the cache key
  // carries the dims signature so a "800 a medida" line never reuses the
  // holes of a preset line.
  const cacheKeyFor = (
    module: { readonly id: string },
    item: ProjectItem,
  ): string =>
    item.customDims
      ? `${module.id}|${item.customDims.widthMm}x${item.customDims.heightMm}x${item.customDims.depthMm}`
      : module.id;
  const derivedByKey = new Map<string, DerivedJointPlacement[]>();
  const partsByKey = new Map<string, readonly ResolvedBoardPart[]>();
  const moduleIdByKey = new Map<string, string>();
  const itemIdByKey = new Map<string, string>();
  const choicesByKey = new Map<string, ReturnType<typeof effectiveOptionChoices>>();
  const resolutionIssues: ProjectDrillingResolutionIssue[] = [];

  for (const item of project.items) {
    if (!(item.quantity > 0)) continue;
    const module = catalog.modules.find((m) => m.id === item.moduleId);
    if (!module) continue;
    const cacheKey = cacheKeyFor(module, item);
    if (partsByKey.has(cacheKey)) continue;

    const choices = effectiveOptionChoices(
      item.optionChoices,
      project.projectLevelChoices,
    );
    let parts: readonly ResolvedBoardPart[];
    try {
      parts = resolveBom(
        module,
        choices,
        catalog,
        item.measurePresetId,
        undefined,
        undefined,
        item.customDims,
      ).boardParts;
    } catch {
      // Primary cut rows may have resolved with a different BOM context. Keep
      // partial patterns for diagnostics, but never imply complete drilling.
      resolutionIssues.push({
        code: 'DRILLING_BOM_RESOLUTION_FAILED',
        message: 'No se pudo resolver el BOM secundario para las perforaciones del ítem del proyecto.',
        projectId: project.id,
        projectItemId: item.id,
        moduleId: module.id,
        stage: 'secondary-bom',
        blocking: true,
      });
      continue;
    }
    partsByKey.set(cacheKey, parts);
    moduleIdByKey.set(cacheKey, module.id);
    // Exact attribution for resolution issues: the FIRST item that resolved
    // this template owns it (same identity rule as the partId→module map).
    itemIdByKey.set(cacheKey, item.id);
    // #1046: role-based placements resolve holes through the effective
    // choices. Templates are first-wins per module (same identity rule as the
    // canonical piece codes — duplicated module lines share holes), so the
    // first item's effective choices govern the shared template.
    choicesByKey.set(cacheKey, choices);

    derivedByKey.set(
      cacheKey,
      deriveJointHardwarePlacements({
        parts: parts as readonly JointPart[],
        hardware: catalog.hardware,
        rules:
          jointRules ??
          catalog.structures?.find((s) => s.id === module.structureId)
            ?.jointDrillingRules,
        // #1218: the cup count rides the SAME demand policy the server
        // quotes with — factory overrides govern previews too.
        hingeDemandPolicy: catalog.constructionPolicy?.doorHingeDemand,
      }),
    );
  }

  // Map partId → module for link joins (first module owning the part wins;
  // duplicated module lines share geometry so holes are identical).
  const keyByPartId = new Map<string, string>();
  for (const [key, parts] of partsByKey) {
    for (const part of parts) {
      if (!keyByPartId.has(part.id)) keyByPartId.set(part.id, key);
    }
  }

  const patterns: ResolvedPartDrilling[] = [];
  let totalHoles = 0;
  const reportedUnresolvedHosts = new Set<string>();
  for (const link of links) {
    const cacheKey = keyByPartId.get(link.partId);
    const moduleId = cacheKey ? moduleIdByKey.get(cacheKey) : undefined;
    const module = moduleId ? catalog.modules.find((m) => m.id === moduleId) : undefined;
    const instances = module
      ? instancesForModule(module, catalog.structures ?? [], module.components)
      : [];
    const structure = module?.structureId
      ? catalog.structures?.find((s) => s.id === module.structureId)
      : undefined;
    // F131: only evaluated when the secondary BOM resolved — a BOM failure
    // already reports its own blocking issue and must not double-report.
    const agregadoForPart = cacheKey
      ? agregadoManualPlacementsForPart(
          link.partId,
          structure,
          module,
          catalog.agregados ?? [],
        )
      : undefined;
    if (agregadoForPart?.unresolved && !reportedUnresolvedHosts.has(agregadoForPart.unresolved)) {
      reportedUnresolvedHosts.add(agregadoForPart.unresolved);
      resolutionIssues.push({
        code: 'DRILLING_AGREGADO_HOST_UNRESOLVED',
        message: `La pieza de agregado ${link.partId} no resolvió su componente anfitrión; sus perforaciones de herraje no se calculan. Verifique la receta del agregado y sus instancias en el módulo.`,
        projectId: project.id,
        projectItemId: cacheKey ? (itemIdByKey.get(cacheKey) ?? '') : '',
        moduleId: moduleId ?? '',
        stage: 'agregado-host',
        blocking: true,
      });
    }
    const manualForPart = [
      ...manualPlacementsForPart(instances, link.partId),
      ...(agregadoForPart?.placements ?? []),
    ];
    const derivedForPart = (cacheKey ? derivedByKey.get(cacheKey) ?? [] : []).filter(
      (p) => p.partId === link.partId,
    );

    const resolved = resolvePartDrilling({
      piece: link.part,
      placements: [...manualForPart, ...derivedForPart],
      hardwareCatalog: catalog.hardware,
      // #1046: role-based placements drill with the chosen catalog hardware.
      optionChoices: cacheKey ? choicesByKey.get(cacheKey) : undefined,
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
    resolutionIssues,
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
