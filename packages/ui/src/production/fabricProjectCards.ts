import {
  describeMissingPieces,
  deriveLegacyItemFloorStatus,
  type AssemblyReadiness,
  itemsWaitingForSector,
  normalizeItemFloorStatus,
  physicalStationQueue,
  type BoardSheetEstimate,
  type ItemFloorStatus,
  type MissingPieceInfo,
  type ModuleUnitStatus,
  type PartOperationStatus,
  type PartOperationType,
  type PickingStatus,
  type ProductionEdgeTotal,
  type ProductionMaterialTotal,
  type Project,
  type ProjectPickingState,
} from '@granete/domain';

export type FabricStation = 'cutting' | 'edge_banding' | 'assembly' | 'packaging';

/** Physical piece row (#301): one card line per PIECE at cut/edge stations. */
export type FabricStationPartDetail = {
  readonly id: string;
  readonly partCode: string;
  readonly unitIndex: number;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly materialId: string;
  readonly operationType: PartOperationType;
  readonly operationStatus: PartOperationStatus;
};

/** Physical unit row (#301): one card line per UNIT at assembly/packaging. */
export type FabricStationUnitDetail = {
  readonly id: string;
  readonly unitIndex: number;
  /** Total physical units of the same line ("Unidad 2 de 3"). */
  readonly unitTotal: number;
  readonly unitStatus: ModuleUnitStatus;
  readonly packageCount?: number;
  readonly missing: readonly MissingPieceInfo[];
};

export type FabricStationRow = {
  readonly itemId: string;
  readonly moduleName: string;
  readonly quantity: number;
  readonly currentStatus: ItemFloorStatus;
  readonly assemblyReadiness?: AssemblyReadiness;
  readonly part?: FabricStationPartDetail;
  readonly unit?: FabricStationUnitDetail;
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
    readonly pickingStatus?: PickingStatus;
  })[];
  readonly edges: readonly (ProductionEdgeTotal & {
    readonly previewColor?: string;
    readonly pickingStatus?: PickingStatus;
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
    // Process stage gating — the floor only sees works whose materials were
    // released by Almacén (ventas → ingeniería → almacén → producción).
    if (!project.materialsRelease) return [];

    // Physical mode (#301): pieces at cutting/edge, units at assembly/packaging.
    const hasPhysicalExecutions =
      (project.partInstances?.length ?? 0) > 0 && (project.moduleUnits?.length ?? 0) > 0;
    if (hasPhysicalExecutions) {
      const moduleIdByItem = new Map(project.items.map((i) => [i.id, i.moduleId]));
      const legacyByItem = new Map(
        project.items.map((item) => {
          const itemUnits = project.moduleUnits?.filter((u) => u.projectItemId === item.id) ?? [];
          const itemParts = project.partInstances?.filter((p) => p.projectItemId === item.id) ?? [];
          return [
            item.id,
            deriveLegacyItemFloorStatus(itemUnits, itemParts),
          ] as const;
        }),
      );
      const rows = physicalStationQueue(project, station).map((row) => {
        if (row.kind === 'part') {
          return {
            itemId: row.part.projectItemId,
            moduleName: moduleLabelFor?.(moduleIdByItem.get(row.part.projectItemId) ?? '') ?? '',
            quantity: 1,
            currentStatus: legacyByItem.get(row.part.projectItemId) ?? 'pending',
            part: {
              id: row.part.id,
              partCode: row.part.partCode,
              unitIndex: row.part.unitIndex,
              lengthMm: row.part.lengthMm,
              widthMm: row.part.widthMm,
              thicknessMm: row.part.thicknessMm,
              materialId: row.part.materialId,
              operationType: row.operationType,
              operationStatus: row.operationStatus,
            },
          };
        }
        return {
          itemId: row.unit.projectItemId,
          moduleName: moduleLabelFor?.(moduleIdByItem.get(row.unit.projectItemId) ?? '') ?? '',
          quantity: 1,
          currentStatus: legacyByItem.get(row.unit.projectItemId) ?? 'pending',
          assemblyReadiness: row.readiness,
          unit: {
            id: row.unit.id,
            unitIndex: row.unit.unitIndex,
            unitTotal:
              project.moduleUnits?.filter((u) => u.projectItemId === row.unit.projectItemId).length ??
              1,
            unitStatus: row.unit.status,
            packageCount: row.unit.packageCount,
            missing: describeMissingPieces(row.readiness),
          },
        };
      });
      if (rows.length === 0) return [];
      return [
        buildCard(project, station, rows, {
          metricsByProject,
          pickingStates,
          activeClaims,
          customerLabelFor,
        }),
      ];
    }

    const items = itemsWaitingForSector(project, station).map((item) => ({
      itemId: item.id,
      moduleName: moduleLabelFor?.(item.moduleId) ?? item.moduleId,
      quantity: item.quantity,
      currentStatus: normalizeItemFloorStatus(item.floorStatus),
    }));
    if (items.length === 0) return [];

    return [
      buildCard(project, station, items, {
        metricsByProject,
        pickingStates,
        activeClaims,
        customerLabelFor,
      }),
    ];
  });
}

function buildCard(
  project: Project,
  station: FabricStation,
  items: readonly FabricStationRow[],
  input: Pick<
    FabricProjectCardInput,
    'metricsByProject' | 'pickingStates' | 'activeClaims' | 'customerLabelFor'
  >,
): FabricProjectCard {
  const metrics = input.metricsByProject[project.id];
  const sheetByCode = new Map(
    metrics?.sheetEstimates.map((estimate) => [estimate.code, estimate.estimatedSheets]) ?? [],
  );
  const boardsPickingState = input.pickingStates.find(
    (state) => state.projectId === project.id && state.material === 'tableros',
  );
  const edgesPickingState = input.pickingStates.find(
    (state) => state.projectId === project.id && state.material === 'cintillas',
  );
  return {
    projectId: project.id,
    projectName: project.name,
    customerLabel: input.customerLabelFor?.(project.customerId) ?? '',
    items,
    materials: (metrics?.materials ?? []).map((material) => ({
      ...material,
      estimatedSheets: sheetByCode.get(material.materialCode ?? material.key),
      pickingStatus: boardsPickingState?.status,
    })),
    edges: (metrics?.edges ?? []).map((edge) => ({
      ...edge,
      previewColor: metrics?.edgeBandColors[edge.edgeBandCode ?? edge.key],
      pickingStatus: edgesPickingState?.status,
    })),
    activeClaims: input.activeClaims.filter(
      (claim) => claim.projectId === project.id && claim.sector === station,
    ),
  };
}
