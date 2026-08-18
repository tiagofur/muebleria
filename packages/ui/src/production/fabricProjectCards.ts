import {
  itemsWaitingForSector,
  normalizeItemFloorStatus,
  type BoardSheetEstimate,
  type ItemFloorStatus,
  type ProductionEdgeTotal,
  type ProductionMaterialTotal,
  type Project,
  type ProjectPickingState,
} from '@muebles/domain';

export type FabricStation = 'cutting' | 'edge_banding' | 'assembly' | 'packaging';

export type FabricStationRow = {
  readonly itemId: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly currentStatus: ItemFloorStatus;
};

export type FabricActiveClaim = {
  readonly activityId: string;
  readonly projectId: string;
  readonly sector: FabricStation;
  readonly operatorName: string;
  readonly startedAt: string;
};

export type FabricProjectMetrics = {
  readonly materials: readonly ProductionMaterialTotal[];
  readonly edges: readonly ProductionEdgeTotal[];
  readonly sheetEstimates: readonly BoardSheetEstimate[];
  readonly edgeBandColors: Readonly<Record<string, string | undefined>>;
};

export type FabricProjectCard = {
  readonly projectId: string;
  readonly projectName: string;
  readonly customerLabel: string;
  readonly items: readonly FabricStationRow[];
  readonly materials: readonly (ProductionMaterialTotal & {
    readonly estimatedSheets?: number;
    readonly picked: boolean;
  })[];
  readonly edges: readonly (ProductionEdgeTotal & {
    readonly previewColor?: string;
    readonly picked: boolean;
  })[];
  readonly activeClaims: readonly FabricActiveClaim[];
};

export type FabricProjectCardInput = {
  readonly projects: readonly Project[];
  readonly station: FabricStation;
  readonly metricsByProject: Readonly<Record<string, FabricProjectMetrics | undefined>>;
  readonly pickingStates: readonly ProjectPickingState[];
  readonly activeClaims: readonly FabricActiveClaim[];
  readonly customerLabelFor?: (customerId: string) => string;
  readonly moduleLabelFor?: (moduleId: string) => string;
};

/**
 * Derives one work card per project and manufacturing station. Calculation
 * outputs are supplied by the shell; this selector only joins them with the
 * station queue, persisted category-level picking and active claims.
 */
export function fabricProjectCards({
  projects,
  station,
  metricsByProject,
  pickingStates,
  activeClaims,
  customerLabelFor,
  moduleLabelFor,
}: FabricProjectCardInput): readonly FabricProjectCard[] {
  return projects.flatMap((project) => {
    if (project.status !== 'accepted' && project.status !== 'produced') return [];
    const items = itemsWaitingForSector(project, station).map((item) => ({
      itemId: item.id,
      moduleName: moduleLabelFor?.(item.moduleId) ?? item.moduleId,
      quantity: item.quantity,
      currentStatus: normalizeItemFloorStatus(item.floorStatus),
    }));
    if (items.length === 0) return [];

    const metrics = metricsByProject[project.id];
    const sheetByCode = new Map(
      metrics?.sheetEstimates.map((estimate) => [estimate.code, estimate.estimatedSheets]) ?? [],
    );
    const boardsPicked = pickingStates.some(
      (state) =>
        state.projectId === project.id &&
        state.material === 'tableros' &&
        state.status === 'despachado',
    );
    const edgesPicked = pickingStates.some(
      (state) =>
        state.projectId === project.id &&
        state.material === 'cintillas' &&
        state.status === 'despachado',
    );

    return [{
      projectId: project.id,
      projectName: project.name,
      customerLabel: customerLabelFor?.(project.customerId) ?? '',
      items,
      materials: (metrics?.materials ?? []).map((material) => ({
        ...material,
        estimatedSheets: sheetByCode.get(material.materialCode ?? material.key),
        picked: boardsPicked,
      })),
      edges: (metrics?.edges ?? []).map((edge) => ({
        ...edge,
        previewColor: metrics?.edgeBandColors[edge.edgeBandCode ?? edge.key],
        picked: edgesPicked,
      })),
      activeClaims: activeClaims.filter(
        (claim) => claim.projectId === project.id && claim.sector === station,
      ),
    }];
  });
}
