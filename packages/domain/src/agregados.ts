/**
 * Agregados (sub-assemblies) resolution and mirroring logic.
 *
 * An Agregado is a reusable sub-assembly (e.g., a door with hinges and handle,
 * a drawer with slides, etc.).
 * When placed inside a module or structure, it can be mirrored (e.g., flipping a
 * left-opening door into a right-opening door).
 */

import {
  HINGE_DEMAND_DESCRIPTION,
  HINGE_DEMAND_LINE_PREFIX,
  hingeDemandNotice,
  hingeDemandRole,
  hingesForDoor,
  resolveHingeCount,
  type HingeCount,
  type HingeDemandPolicy,
} from './hingeDemand';
import { hingePolicyForDoor, type CatalogHingePolicySource } from './engine/hingeBandDemand';
import type {
  Agregado,
  ComponentPlacement,
  Hardware,
  HardwareLine,
  HardwarePlacement,
  ModuleAgregadoInstance,
  ModuleComponentInstance,
  OptionChoices,
} from './types';

/**
 * Resolves the effective agregado ID for an instance (#1472).
 * Precedence contract:
 *  1. Instance optionOverrides for the instance's optionRole
 *  2. Effective optionChoices for the instance's optionRole (furniture / project level)
 *  3. Fallback to instance.agregadoId
 */
export function resolveEffectiveAgregadoId(
  instance: ModuleAgregadoInstance,
  optionChoices?: OptionChoices | null,
): string {
  const role = instance.optionRole?.trim();
  if (role) {
    const instanceOverride = instance.optionOverrides?.[role]?.trim();
    if (instanceOverride) return instanceOverride;

    const groupChoice = optionChoices?.[role]?.trim();
    if (groupChoice) return groupChoice;
  }
  return instance.agregadoId;
}

/**
 * Flips spatial placement across the X axis.
 * - 'lateral_izquierdo' <-> 'lateral_derecho'
 * - other placements are symmetric or custom.
 */
export function mirrorComponentPlacement(
  placement: ComponentPlacement,
): ComponentPlacement {
  if (placement === 'lateral_izquierdo') return 'lateral_derecho';
  if (placement === 'lateral_derecho') return 'lateral_izquierdo';
  return placement;
}

/**
 * Mirrors a component instance by inverting its placement and rotation.
 */
export function mirrorComponentInstance(
  instance: ModuleComponentInstance,
): ModuleComponentInstance {
  const placementOverride = instance.placementOverride
    ? mirrorComponentPlacement(instance.placementOverride)
    : undefined;

  const currentRotateY = instance.overrides?.rotateY;
  const newRotateY =
    currentRotateY !== undefined ? (360 - currentRotateY) % 360 : undefined;

  const overrides = instance.overrides
    ? {
        ...instance.overrides,
        ...(newRotateY !== undefined ? { rotateY: newRotateY } : {}),
      }
    : undefined;

  return {
    ...instance,
    ...(placementOverride ? { placementOverride } : {}),
    ...(overrides ? { overrides } : {}),
  };
}

/**
 * #1579 PR2: Y positions (mm, door-local from the bottom) of a hinge count
 * rule pattern. First hinge at the bottom offset, last at height minus the
 * top offset, intermediates distributed evenly between them — the same
 * distribution the F129 generator uses, without the grid snap (cup positions
 * are authored offsets, not system-hole rows). Count 1 centers on the door.
 * A non-positive height or count yields nothing.
 */
export function expandHingeCountRulePositions(
  rule: { readonly endOffsetBottomMm: number; readonly endOffsetTopMm: number },
  doorHeightMm: number,
  count: number,
): number[] {
  if (!(doorHeightMm > 0) || !(count > 0)) return [];
  const bottom = Math.max(0, rule.endOffsetBottomMm);
  const top = Math.max(0, rule.endOffsetTopMm);
  if (count === 1) return [doorHeightMm / 2];
  const first = Math.min(bottom, doorHeightMm / 2);
  const last = doorHeightMm - Math.min(top, doorHeightMm / 2);
  if (last - first <= 0) return [doorHeightMm / 2];
  const positions = [first];
  for (let i = 1; i < count - 1; i++) {
    positions.push(first + ((last - first) * i) / (count - 1));
  }
  positions.push(last);
  return positions;
}

/** Everything the count-rule expansion needs from the caller's resolve. */
export interface HingeCountRuleContext {
  /** REAL bay box of THIS unit (the door board's box), not the recipe ref. */
  readonly doorDims?: { readonly heightMm: number; readonly widthMm: number };
  /** Item/project choices — the SECOND rung after instance.optionOverrides. */
  readonly effectiveChoices?: OptionChoices;
  readonly catalogHardware?: readonly Hardware[];
  readonly policySource?: CatalogHingePolicySource;
}

/**
 * #1579 PR2: does the recipe declare a hinge count pattern on a door? The
 * count rule lives on a placement of a door component (placementOverride
 * 'puerta'); anything else is not a pattern the engine expands.
 */
export function hasHingeCountRuleDoor(agr: Agregado): boolean {
  return (agr.components ?? []).some(
    (c) =>
      c.placementOverride === 'puerta' &&
      (c.overrides?.hardwarePlacements ?? []).some((p) => p.countRule),
  );
}

/** The per-hardware outcome of the count rule inside one agregado unit. */
interface HingeCountDemand {
  quantity: number;
  role: string;
  overflowHeightMm: number;
  overflow?: HingeCount;
}

/**
 * Resolves a ModuleAgregadoInstance into its constituent ComponentInstances and HardwareLines.
 * Multiplies quantities by instance.quantity, applies mirroring if requested, and applies optionOverrides.
 */
export function resolveAgregadoInstance(
  instance: ModuleAgregadoInstance,
  agregadosCatalog: readonly Agregado[],
  unitIndex?: number,
  // Item 2 de la issue del resto: la política de fábrica (traída por
  // catálogo). La banda de la puerta-agregado usa la MISMA política que
  // cotiza el servidor; omitida = escalera de librería.
  hingeDemandPolicy?: HingeDemandPolicy,
  // #1493 slice 3: kit comercial EFECTIVO de ESTA bahía (resuelto por el
  // caller con selectAgregadoVariants + effectiveKitHardwareId contra las
  // dimensiones de la unidad). Presente ⇒ la cotización emite la línea del
  // kit (1 por bahía) salvo que la receta ya autorice una línea bulk que
  // resuelva al mismo kit. Ausente ⇒ sin líneas nuevas (legacy idéntico).
  commercialKitHardwareId?: string,
  // #1579 PR2: contexto de la regla de cantidad — medidas reales de ESTA
  // bahía, choices efectivas, catálogo y política. Ausente ⇒ sin countRule
  // (byte-idéntico; las líneas viejas no cambian).
  countRuleContext?: HingeCountRuleContext,
): {
  readonly components: readonly ModuleComponentInstance[];
  readonly hardwareLines: readonly HardwareLine[];
} {
  const agregado = agregadosCatalog.find((a) => a.id === instance.agregadoId);
  if (!agregado) {
    return { components: [], hardwareLines: [] };
  }

  const mult = Math.max(1, instance.quantity);
  const instanceKey = instance.id ? instance.id : instance.agregadoId;
  const unitSuffix = unitIndex !== undefined ? `-u${unitIndex}` : '';

  const rawComponents = (agregado.components ?? []).map((c) => ({
    ...c,
    quantity: c.quantity * mult,
  }));

  const components = instance.mirrored
    ? rawComponents.map(mirrorComponentInstance)
    : rawComponents;

  // #1579 PR2: el placement con countRule es un PATRÓN — se expande a N
  // posiciones con las medidas reales de ESTA bahía y su demanda viaja en la
  // línea de banda del agregado (exclusiva para ese herraje). Sin contexto
  // (caller viejo) o sin medidas el patrón queda como placement fijo:
  // byte-idéntico con recetas que no lo declaren. El patrón NO cuenta como
  // posición (su demanda es la línea de banda; un placement = una pieza).
  const countDemands = new Map<string, HingeCountDemand>();
  // Posiciones FIJAS del autor (intención): resueltas sobre los componentes
  // SIN expandir y sin los placements de patrón — escalera: posiciones >
  // banda/patrón > línea bulk. Misma cadena de resolución que el patrón
  // (hardwareId → override de instancia → choice efectiva): una fija por rol
  // con elección a nivel grupo TAMBIÉN gana, si no el patrón la pisaría.
  const fixedPlacementCounts = new Map<string, number>();
  for (const comp of components) {
    const placements = comp.overrides?.hardwarePlacements;
    if (!placements) continue;
    for (const p of placements) {
      if (p.countRule) continue; // patrón: demanda por countDemands, no posición
      const resolvedId =
        p.hardwareId ||
        (p.optionRole && instance.optionOverrides?.[p.optionRole]) ||
        (p.optionRole && countRuleContext?.effectiveChoices?.[p.optionRole]) ||
        '';
      if (!resolvedId) continue;
      fixedPlacementCounts.set(
        resolvedId,
        (fixedPlacementCounts.get(resolvedId) ?? 0) + comp.quantity,
      );
    }
  }
  const expandedComponents = countRuleContext
    ? components.map((comp) => {
        const placements = comp.overrides?.hardwarePlacements;
        if (!placements?.some((p) => p.countRule)) return comp;
        if (comp.placementOverride !== 'puerta') return comp; // fuera de una puerta: el motor falla; acá no expande
        const doorHeight = countRuleContext.doorDims?.heightMm ?? agregado.externalDims?.height ?? 0;
        const doorWidth = countRuleContext.doorDims?.widthMm ?? agregado.externalDims?.width ?? 0;
        const expanded: HardwarePlacement[] = [];
        for (const p of placements) {
          if (!p.countRule) {
            expanded.push(p);
            continue;
          }
          const role = p.optionRole?.trim() || hingeDemandRole(hingeDemandPolicy);
          const resolvedId =
            p.hardwareId ||
            instance.optionOverrides?.[role]?.trim() ||
            countRuleContext.effectiveChoices?.[role]?.trim() ||
            '';
          if (!resolvedId) continue; // sin elección: sin patrón (el gate exige el grupo)
          // Posiciones fijas del MISMO herraje ganan (intención del autor):
          // el patrón se retira — no duplica posición ni demanda.
          if (fixedPlacementCounts.has(resolvedId)) {
            continue;
          }
          const hinge = countRuleContext.catalogHardware?.find((hw) => hw.id === resolvedId);
          const policy = hingePolicyForDoor(
            countRuleContext.policySource,
            comp.componentId,
            hinge,
          );
          const count = resolveHingeCount(doorHeight, doorWidth, policy);
          if (count.hinges <= 0) continue;
          const positions = expandHingeCountRulePositions(p.countRule, doorHeight, count.hinges);
          for (const y of positions) {
            expanded.push({
              ...p,
              relativePosition: { ...p.relativePosition, yMm: y, yFormula: undefined },
            });
          }
          const roleForLine = hingeDemandRole(policy);
          const entry = countDemands.get(resolvedId) ?? {
            quantity: 0,
            role: roleForLine,
            overflowHeightMm: 0,
          };
          entry.quantity += count.hinges * comp.quantity;
          if (count.aboveLastBand && doorHeight > entry.overflowHeightMm) {
            entry.overflowHeightMm = doorHeight;
            entry.overflow = count;
          }
          countDemands.set(resolvedId, entry);
        }
        return {
          ...comp,
          overrides: { ...comp.overrides, hardwarePlacements: expanded },
        };
      })
    : components;

  // Count positioned hardware: each hardwarePlacement on a component = 1 unit,
  // scaled by the component's (already mult-scaled) quantity. This is the
  // single source of truth for cost + 3D + future CNC — a positioned hardware
  // is never also counted via a bulk hardwareLine (dedup below). Los
  // placements expandidos del patrón NO cuentan posición (demanda = banda);
  // las posiciones fijas ya están en fixedPlacementCounts.
  const placementCounts = new Map<string, number>(fixedPlacementCounts);

  // Item 2 — los agregados-puerta compran bisagras por banda de altura, la
  // MISMA escalera que las puertas de módulo: posiciones > banda > línea
  // bulk autorizada. El agregado ES la puerta (patrón AGR-PUE): sus
  // externalDims son la caja de la puerta. Sin dims, sin componente puerta
  // o sin elección para el grupo → la banda no aparece (nunca se inventa).
  // Un agregado mixto (mueble con puerta interna) queda fuera del alcance de
  // la banda (su caja no es la de la puerta) — nombrado en la issue.
  const bandCounts = new Map<string, number>();
  const bandRoles = new Map<string, string>();
  const bandNotices = new Map<string, string>();
  const isDoorAggregate = (agregado.components ?? []).some(
    (c) => c.placementOverride === 'puerta',
  );
  const doorBox = agregado.externalDims;
  if (isDoorAggregate && doorBox && doorBox.height > 0) {
    const role = hingeDemandRole(hingeDemandPolicy);
    const chosenId = instance.optionOverrides?.[role]?.trim();
    if (chosenId && !placementCounts.has(chosenId) && !countDemands.has(chosenId)) {
      const perUnit = hingesForDoor(
        doorBox.height,
        doorBox.width,
        hingeDemandPolicy,
      );
      if (perUnit > 0) {
        bandCounts.set(chosenId, perUnit * mult);
        bandRoles.set(chosenId, role);
      }
    }
  }

  const rawHardware = agregado.hardwareLines ?? [];
  // Bulk hardware lines, EXCLUDING any whose resolved hardwareId is also
  // positioned (positions win), band-covered (the derived band replaces the
  // fixed authored line of the same hardware) or count-rule-covered (#1579
  // PR2: el patrón compra ese herraje, la bulk fija del mismo muere).
  const bulkHardwareLines = rawHardware
    .map((h) => {
      const overrideHardwareId =
        instance.optionOverrides && h.optionRole && instance.optionOverrides[h.optionRole]
          ? instance.optionOverrides[h.optionRole]
          : h.hardwareId;
      return {
        ...h,
        id: `${h.id}-agr-${instanceKey}${unitSuffix}`,
        hardwareId: overrideHardwareId ?? h.hardwareId,
        quantity: h.quantity * mult,
      };
    })
    .filter(
      (h) =>
        !(
          h.hardwareId &&
          (placementCounts.has(h.hardwareId) ||
            bandCounts.has(h.hardwareId) ||
            countDemands.has(h.hardwareId))
        ),
    );

  // Position-derived hardware lines (one per positioned hardwareId).
  const placementHardwareLines: HardwareLine[] = [...placementCounts].map(
    ([hwId, qty]) => ({
      id: `placement-agr-${instanceKey}${unitSuffix}-${hwId}`,
      quantity: qty,
      optionRole: 'POSITIONED',
      hardwareId: hwId,
    }),
  );

  // Band-derived demand lines (después de posiciones — mismo orden que el
  // resolve de módulo) + las del patrón countRule (#1579 PR2, con su aviso).
  const bandHardwareLines: HardwareLine[] = [...bandCounts].map(
    ([hwId, qty]) => ({
      id: `${HINGE_DEMAND_LINE_PREFIX}agr-${instanceKey}${unitSuffix}-${hwId}`,
      quantity: qty,
      optionRole: bandRoles.get(hwId) ?? hingeDemandRole(hingeDemandPolicy),
      hardwareId: hwId,
      descriptionOverride: HINGE_DEMAND_DESCRIPTION,
    }),
  );
  const countHardwareLines: HardwareLine[] = [...countDemands].map(
    ([hwId, demand]) => ({
      id: `${HINGE_DEMAND_LINE_PREFIX}agr-${instanceKey}${unitSuffix}-${hwId}`,
      quantity: demand.quantity,
      optionRole: demand.role,
      hardwareId: hwId,
      descriptionOverride: HINGE_DEMAND_DESCRIPTION,
      ...(demand.overflow
        ? { notice: hingeDemandNotice(demand.overflowHeightMm, demand.overflow) }
        : {}),
    }),
  );

  // #1493 slice 3: la línea del kit comercial por bahía — sólo cuando el
  // caller resolvió el kit efectivo de la variante y la receta no autoriza
  // ya una línea bulk que resuelva al mismo kit (la autoría manda).
  const resolvedBulkIds = new Set(bulkHardwareLines.map((h) => h.hardwareId));
  const kitLines: HardwareLine[] =
    commercialKitHardwareId && !resolvedBulkIds.has(commercialKitHardwareId)
      ? [
          {
            id: `kit-agr-${instanceKey}${unitSuffix}`,
            quantity: 1,
            optionRole: 'COMMERCIAL_KIT',
            hardwareId: commercialKitHardwareId,
          },
        ]
      : [];

  const hardwareLines = [
    ...bulkHardwareLines,
    ...placementHardwareLines,
    ...bandHardwareLines,
    ...countHardwareLines,
    ...kitLines,
  ];

  return { components: expandedComponents, hardwareLines };
}

export interface SubspaceUnit {
  readonly unitIndex: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

/**
 * Computes individual sub-space bounding boxes and 3D positions for N units of an Agregado instance.
 */
export function calculateAgregadoSubspaceUnits(
  quantity: number,
  spaceDims: { width: number; height: number; depth: number },
  spacePos: { x: number; y: number; z: number },
  layoutDirection: 'vertical' | 'horizontal' | 'none' = 'none',
  gapMm = 0,
): readonly SubspaceUnit[] {
  const N = Math.max(1, quantity);
  const gap = Math.max(0, gapMm);
  const units: SubspaceUnit[] = [];

  if (layoutDirection === 'vertical' && N > 1) {
    const availableH = Math.max(1, spaceDims.height - (N - 1) * gap);
    const unitH = availableH / N;
    for (let i = 0; i < N; i++) {
      units.push({
        unitIndex: i,
        x: spacePos.x,
        y: spacePos.y,
        z: spacePos.z + i * (unitH + gap),
        width: spaceDims.width,
        height: unitH,
        depth: spaceDims.depth,
      });
    }
  } else if (layoutDirection === 'horizontal' && N > 1) {
    const availableW = Math.max(1, spaceDims.width - (N - 1) * gap);
    const unitW = availableW / N;
    for (let i = 0; i < N; i++) {
      units.push({
        unitIndex: i,
        x: spacePos.x + i * (unitW + gap),
        y: spacePos.y,
        z: spacePos.z,
        width: unitW,
        height: spaceDims.height,
        depth: spaceDims.depth,
      });
    }
  } else {
    for (let i = 0; i < N; i++) {
      units.push({
        unitIndex: i,
        x: spacePos.x,
        y: spacePos.y,
        z: spacePos.z,
        width: spaceDims.width,
        height: spaceDims.height,
        depth: spaceDims.depth,
      });
    }
  }

  return units;
}
