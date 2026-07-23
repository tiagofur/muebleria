/**
 * Production cut plan + printable piece labels + edge-banding instructions.
 *
 * F046 (#96) piece labels, F048 (#98) optimizer part description, EXP-05 board
 * parts only, EXP-04 sorting, VAL-05 empty-cut-list gate.
 */

import { ResolutionError, ValidationError } from '../errors';
import { effectiveOptionChoices } from '../optionChoices';
import type {
  Catalog,
  EdgeAssignment,
  PieceLabel,
  ProductionCutRow,
  Project,
} from '../types';
import { resolveBom } from './bom';
import {
  edgeFlags,
  findEdgeBand,
  findMaterial,
  findModule,
} from './shared';

function edgeBinaryFlags(
  edges: readonly EdgeAssignment[],
): Pick<ProductionCutRow, 'L1' | 'L2' | 'W1' | 'W2'> {
  const flags = edgeFlags(edges);
  const bit = (n: number): 0 | 1 => (n ? 1 : 0);
  return {
    L1: bit(flags.L1),
    L2: bit(flags.L2),
    W1: bit(flags.W1),
    W2: bit(flags.W2),
  };
}

interface SortableCutRow {
  readonly moduleCode: string;
  readonly partCode: string;
  readonly partId: string;
  readonly description: string;
  readonly row: ProductionCutRow;
}

/**
 * Optimizer column D text with stable codes (F048 / #98).
 * `{partCode} · {partName} · {moduleCode}` or `{partName} · {moduleCode}`.
 */
export function formatOptimizerPartDescription(
  moduleCode: string,
  partName: string,
  partCode?: string,
): string {
  const name = partName.trim();
  const mod = moduleCode.trim();
  const code = partCode?.trim();
  if (code) {
    return `${code} · ${name} · ${mod}`;
  }
  return `${name} · ${mod}`;
}

/**
 * Expand project board parts into Optimizer cut-list rows (PRD §14).
 * Board parts only (EXP-05). Quantity = part.quantity × item.quantity (EXP-02).
 * Sorted by module code, then part code (EXP-04). Never includes hardware.
 * Description includes part/module codes for workshop ID (F048) without new columns.
 */
export function generateCutRows(
  project: Project,
  catalog: Catalog,
): ProductionCutRow[] {
  const sortable: SortableCutRow[] = [];

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
    );

    for (const part of bom.boardParts) {
      const material = findMaterial(catalog, part.materialId);
      if (!material) {
        throw new ResolutionError(
          `Material not found: ${part.materialId}`,
          {
            projectId: project.id,
            partId: part.id,
            materialId: part.materialId,
            field: 'materialId',
          },
        );
      }

      const edgeBits = edgeBinaryFlags(part.edges);
      const partCode = part.code;
      const labelRef = partCode?.trim() || `${module.code}/${part.id}`;
      const description = formatOptimizerPartDescription(
        module.code,
        part.description,
        partCode,
      );
      sortable.push({
        moduleCode: module.code,
        partCode: partCode ?? '',
        partId: part.id,
        description: part.description,
        row: {
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          description,
          materialName: material.name,
          grain: part.grain,
          ...edgeBits,
          partName: part.description,
          partCode,
          moduleCode: module.code,
          labelRef,
        },
      });
    }
  }

  // VAL-05
  if (sortable.length === 0) {
    throw new ValidationError('no hay piezas de tablero para exportar', {
      projectId: project.id,
      field: 'boardParts',
    });
  }

  sortable.sort((a, b) => {
    const byModule = a.moduleCode.localeCompare(b.moduleCode);
    if (byModule !== 0) return byModule;
    const byPartCode = a.partCode.localeCompare(b.partCode);
    if (byPartCode !== 0) return byPartCode;
    const byDescription = a.description.localeCompare(b.description);
    if (byDescription !== 0) return byDescription;
    return a.partId.localeCompare(b.partId);
  });

  return sortable.map((entry) => entry.row);
}

const EDGE_SIDE_ORDER = ['L1', 'L2', 'W1', 'W2'] as const;

/**
 * Human-readable edge-banding instruction for workshop labels (F046 / #96).
 * Uses Optimizer side codes L1/L2/W1/W2.
 */
export function formatEdgeBandingInstruction(
  sides: Readonly<{
    L1: boolean;
    L2: boolean;
    W1: boolean;
    W2: boolean;
  }>,
  edge?: Readonly<{
    code: string;
    name: string;
    thicknessMm: number;
  }> | null,
): string {
  const enabled = EDGE_SIDE_ORDER.filter((s) => sides[s]);
  if (enabled.length === 0) {
    return 'Sin encintar';
  }

  let sidesText: string;
  if (enabled.length === 1) {
    sidesText = enabled[0]!;
  } else if (enabled.length === 2) {
    sidesText = `${enabled[0]} y ${enabled[1]}`;
  } else {
    sidesText = `${enabled.slice(0, -1).join(', ')} y ${enabled[enabled.length - 1]}`;
  }

  if (edge) {
    return `Encintar ${sidesText} con ${edge.name} ${edge.thicknessMm} mm (${edge.code})`;
  }
  return `Encintar ${sidesText} (definir canto)`;
}

interface SortablePieceLabel {
  readonly moduleCode: string;
  readonly partCode: string;
  readonly partId: string;
  readonly description: string;
  readonly label: PieceLabel;
}

/**
 * Build printable piece labels from resolved board parts (F046 / #96).
 * Never includes hardware. Quantity = part.quantity × item.quantity.
 * Sorted like cut rows (module code, part code, description).
 */
export function generatePieceLabels(
  project: Project,
  catalog: Catalog,
): PieceLabel[] {
  const sortable: SortablePieceLabel[] = [];

  for (const item of project.items) {
    if (!(item.quantity > 0)) {
      throw new ValidationError(
        `Project item quantity must be > 0 (got ${item.quantity})`,
        {
          projectId: project.id,
          projectItemId: item.id,
          field: 'quantity',
        },
      );
    }

    const module = findModule(catalog, item.moduleId);
    if (!module) {
      throw new ResolutionError(
        `Module not found for project item: ${item.moduleId}`,
        {
          projectId: project.id,
          projectItemId: item.id,
          moduleId: item.moduleId,
          field: 'moduleId',
        },
      );
    }

    const bom = resolveBom(
      module,
      effectiveOptionChoices(item.optionChoices, project.projectLevelChoices),
      catalog,
      item.measurePresetId,
      item.structureRevisionPin,
    );

    for (const part of bom.boardParts) {
      const material = findMaterial(catalog, part.materialId);
      if (!material) {
        throw new ResolutionError(
          `Material not found: ${part.materialId}`,
          {
            projectId: project.id,
            partId: part.id,
            materialId: part.materialId,
            field: 'materialId',
          },
        );
      }

      const flags = edgeBinaryFlags(part.edges);
      const sides = {
        L1: flags.L1 === 1,
        L2: flags.L2 === 1,
        W1: flags.W1 === 1,
        W2: flags.W2 === 1,
      };

      let edgeBandCode: string | undefined;
      let edgeBandName: string | undefined;
      let edgeForInstruction: {
        code: string;
        name: string;
        thicknessMm: number;
      } | null = null;

      if (part.edgeBandId) {
        const edge = findEdgeBand(catalog, part.edgeBandId);
        if (!edge) {
          throw new ResolutionError(
            `Edge band not found: ${part.edgeBandId}`,
            {
              projectId: project.id,
              partId: part.id,
              edgeBandId: part.edgeBandId,
              field: 'edgeBandId',
            },
          );
        }
        edgeBandCode = edge.code;
        edgeBandName = edge.name;
        edgeForInstruction = {
          code: edge.code,
          name: edge.name,
          thicknessMm: edge.thicknessMm,
        };
      }

      sortable.push({
        moduleCode: module.code,
        partCode: part.code ?? '',
        partId: part.id,
        description: part.description,
        label: {
          moduleCode: module.code,
          moduleName: module.name,
          partCode: part.code,
          description: part.description,
          quantity: part.quantity * item.quantity,
          lengthMm: part.lengthMm,
          widthMm: part.widthMm,
          materialCode: material.code,
          materialName: material.name,
          edgeBandCode,
          edgeBandName,
          L1: sides.L1,
          L2: sides.L2,
          W1: sides.W1,
          W2: sides.W2,
          edgeBandingInstruction: formatEdgeBandingInstruction(
            sides,
            edgeForInstruction,
          ),
        },
      });
    }
  }

  if (sortable.length === 0) {
    throw new ValidationError('no hay piezas de tablero para etiquetar', {
      projectId: project.id,
      field: 'boardParts',
    });
  }

  sortable.sort((a, b) => {
    const byModule = a.moduleCode.localeCompare(b.moduleCode);
    if (byModule !== 0) return byModule;
    const byPartCode = a.partCode.localeCompare(b.partCode);
    if (byPartCode !== 0) return byPartCode;
    const byDescription = a.description.localeCompare(b.description);
    if (byDescription !== 0) return byDescription;
    return a.partId.localeCompare(b.partId);
  });

  return sortable.map((entry) => entry.label);
}
