/**
 * usePurchasingDerivations — production/purchasing derivations for the shell
 * (F120 extract from App.tsx): picking lists per plant-active project,
 * warehouse aggregates, FabricScreen metrics, stock debit lines.
 */

import { useCallback, useMemo } from 'react';

import type {
  BoardSheetEstimate,
  Catalog,
  Customer,
  EdgeBand,
  HardwarePurchaseRow,
  MaterialBoard,
  MaterialStock,
  Module,
  PickingMaterial,
  ProductionCutRow,
  Project,
  StockMaterialKind,
  WarehouseProjectInput,
} from '@muebles/domain';
import {
  computeProductionTotals,
  estimateBoardSheets,
  filterProjectsByProcessStage,
  generateCutRows,
  generateHardwareList,
  generateProjectMaterialSummary,
} from '@muebles/domain';
import {
  filterProductionVisible,
  resolveCustomerName,
  type ActiveProjectMaterial,
  type FabricProjectMetrics,
} from '@muebles/ui';
import type { StockCatalogView } from './stockCatalog';

import type { StockDebitLine } from '../stores/purchasingStore';

export interface PurchasingDerivationsDeps {
  readonly catalog: Catalog | null;
  readonly projects: readonly Project[];
  readonly materials: readonly MaterialBoard[];
  readonly customers: readonly Customer[];
  readonly edges: readonly EdgeBand[];
  readonly modules: readonly Module[];
  readonly stockRows: MaterialStock[] | null;
  readonly stockCatalog: StockCatalogView;
}

export function usePurchasingDerivations(deps: PurchasingDerivationsDeps) {
  const { catalog, projects, materials, customers, edges, modules, stockRows, stockCatalog } = deps;

  /**
   * Fase 3 — Compras/Almacén: picking lists per plant-active project.
   * Derives hardware rows + cut rows (and sheet estimates for Tableros)
   * from the domain; unresolved projects contribute empty lists.
   */
  const purchasingProjects = useMemo((): ActiveProjectMaterial[] => {
    if (!catalog) return [];
    // Process stage gating — Almacén only sees works whose engineering was
    // sent but whose materials are not released yet (stage "almacen").
    return filterProjectsByProcessStage(
      filterProductionVisible(projects),
      'almacen',
    ).map((project) => {
      let hardware: readonly HardwarePurchaseRow[] = [];
      let cutRows: readonly ProductionCutRow[] = [];
      let sheetEstimates: readonly BoardSheetEstimate[] = [];
      try {
        hardware = generateHardwareList(project, catalog);
      } catch {
        // Unresolved BOM → project shows without a hardware list.
      }
      try {
        cutRows = generateCutRows(project, catalog);
      } catch {
        // Unresolved despiece → project shows without boards/edges.
      }
      try {
        const summary = generateProjectMaterialSummary(project, catalog);
        sheetEstimates = estimateBoardSheets(summary.materials, materials).filter(
          (s) => s.estimatedSheets > 0,
        );
      } catch {
        // No sheet estimate → Tableros falls back to pieces/m².
      }
      return {
        projectId: project.id,
        projectName: project.name,
        hardware,
        cutRows,
        sheetEstimates,
      };
    });
  }, [catalog, projects, materials]);

  const warehouseProjects = useMemo((): readonly WarehouseProjectInput[] => {
    return filterProjectsByProcessStage(
      filterProductionVisible(projects),
      'almacen',
    ).map((project) => {
      const purchProj = purchasingProjects.find((p) => p.projectId === project.id);
      let boardAreaM2 = 0;
      let edgeLengthMl = 0;
      let hardwareCount = 0;
      if (purchProj) {
        const totals = computeProductionTotals(purchProj.cutRows);
        boardAreaM2 = totals.totalAreaM2;
        edgeLengthMl = totals.totalEdgeMl;
        hardwareCount = purchProj.hardware.reduce((sum, row) => sum + row.quantity, 0);
      }
      return {
        ...project,
        customerLabel: resolveCustomerName(project.customerId, customers),
        boardAreaM2: Math.round(boardAreaM2 * 100) / 100,
        edgeLengthMl: Math.round(edgeLengthMl * 10) / 10,
        hardwareCount,
      };
    });
  }, [projects, purchasingProjects, customers]);

  // F096 — presentation DTO for the FabricScreen board. The shell owns the
  // domain calls; the React screen only renders this already-resolved data.
  const fabricMetricsByProject = useMemo<Readonly<Record<string, FabricProjectMetrics>>>(() => {
    const edgeBandColors = Object.fromEntries(
      edges.map((edge) => [edge.code, edge.previewColor]),
    );
    return Object.fromEntries(purchasingProjects.map((project) => [project.projectId, {
      ...computeProductionTotals(project.cutRows),
      sheetEstimates: project.sheetEstimates ?? [],
      edgeBandColors,
    }]));
  }, [purchasingProjects, edges]);

  const moduleLabelForFabric = useCallback((moduleId: string) => {
    const module = modules.find((candidate) => candidate.id === moduleId);
    return module ? `${module.code} · ${module.name}` : moduleId;
  }, [modules]);

  /**
   * Líneas de stock que un despacho de picking descuenta (06 §3): solo
   * materiales con fila de stock (backward compatible). Herrajes por
   * hardwareId; tableros por materialId de la estimación de planchas;
   * cintillas resolviendo el código de canto → id de catálogo.
   */
  const stockDebitLinesFor = useCallback(
    (
      projectId: string,
      material: PickingMaterial,
    ): Array<{ kind: StockMaterialKind; materialId: string; quantity: number }> => {
      if (!stockRows) return [];
      const project = purchasingProjects.find((p) => p.projectId === projectId);
      if (!project) return [];
      const tracked = (kind: StockMaterialKind, id: string | undefined): id is string =>
        Boolean(id) && stockRows.some((r) => r.kind === kind && r.materialId === id);

      if (material === 'herrajes') {
        return project.hardware
          .filter((h) => tracked('herrajes', h.hardwareId))
          .map((h) => ({
            kind: 'herrajes' as const,
            materialId: h.hardwareId!,
            quantity: h.purchaseQuantity,
          }));
      }
      if (material === 'tableros') {
        return (project.sheetEstimates ?? [])
          .filter((s) => tracked('tableros', s.materialId))
          .map((s) => ({
            kind: 'tableros' as const,
            materialId: s.materialId,
            quantity: s.estimatedSheets,
          }));
      }
      const totals = computeProductionTotals(project.cutRows);
      const lines: Array<{ kind: StockMaterialKind; materialId: string; quantity: number }> =
        [];
      for (const e of totals.edges) {
        const id = stockCatalog.edgeIdByCode[e.edgeBandCode ?? e.key];
        if (tracked('cintillas', id)) {
          lines.push({ kind: 'cintillas', materialId: id, quantity: e.ml });
        }
      }
      return lines;
    },
    [purchasingProjects, stockRows, stockCatalog],
  );


  /**
   * OC-050: requirement lines of a project's released BOM (herrajes por
   * hardwareId con compra por paquete, tableros por planchas estimadas,
   * cintillas por ml de canto) — the input for materializing the planning
   * snapshot. Unlike stockDebitLinesFor, untracked materials are included:
   * a requirement exists whether or not the warehouse tracks the material.
   */
  const requirementLinesFor = useCallback(
    (
      projectId: string,
    ): Array<{ kind: StockMaterialKind; materialId: string; quantity: number }> => {
      const project = purchasingProjects.find((p) => p.projectId === projectId);
      if (!project) return [];
      const lines: Array<{ kind: StockMaterialKind; materialId: string; quantity: number }> = [];
      for (const h of project.hardware) {
        if (h.hardwareId) lines.push({ kind: 'herrajes', materialId: h.hardwareId, quantity: h.purchaseQuantity });
      }
      for (const s of project.sheetEstimates ?? []) {
        if (s.estimatedSheets > 0) lines.push({ kind: 'tableros', materialId: s.materialId, quantity: s.estimatedSheets });
      }
      const totals = computeProductionTotals(project.cutRows);
      for (const e of totals.edges) {
        const id = stockCatalog.edgeIdByCode[e.edgeBandCode ?? e.key];
        if (id && e.ml > 0) lines.push({ kind: 'cintillas', materialId: id, quantity: e.ml });
      }
      return lines;
    },
    [purchasingProjects, stockCatalog],
  );

  return {
    purchasingProjects,
    warehouseProjects,
    fabricMetricsByProject,
    moduleLabelForFabric,
    stockDebitLinesFor,
    requirementLinesFor,
  };
}
