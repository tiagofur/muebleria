import { useQuery, type QueryKey } from '@tanstack/react-query';
import { GraneteApiClient, type ReleaseCuttingDemand as GeneratedReleaseCuttingDemand } from '@granete/storage';
import type {
  ReleaseCuttingDemandPieceView,
  ReleaseCuttingDemandUnitView,
  ReleaseCuttingDemandView,
} from '@granete/domain';

/**
 * #739 — the frozen board cutting demand of the EXACT pinned release, read
 * through the generated client (getProjectProductionReleaseCuttingDemand).
 * The server owns the projection; this hook only normalizes the generated
 * snake_case contract into the domain view. Errors are honest — there is no
 * fallback to the mutable project/catálogo.
 */

export type EngineeringCuttingDemandContext =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly retry: () => void }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly retry: () => void;
    }
  | {
      readonly kind: 'ready';
      readonly demand: ReleaseCuttingDemandView;
      /** Refetch — used when the domain mapping of a valid payload fails. */
      readonly retry: () => void;
    };

export function engineeringCuttingDemandQueryKey(
  scope: readonly unknown[],
  projectId: string,
  releaseId: string,
): QueryKey {
  return [...scope, 'projects', projectId, 'production-releases', releaseId, 'cutting-demand'];
}

const flag = (n: number): 0 | 1 => (n ? 1 : 0);

const nullableText = (value: string | null | undefined): string | null | undefined =>
  value === undefined ? undefined : value ?? null;

const nullableInt = (value: number | null | undefined): number | null | undefined =>
  value === undefined ? undefined : value ?? null;

function mapPiece(raw: GeneratedReleaseCuttingDemand['units'][number]['pieces'][number]): ReleaseCuttingDemandPieceView {
  return {
    partId: raw.part_id,
    partCode: raw.part_code ?? null,
    description: raw.description,
    quantity: raw.quantity,
    lengthMm: raw.length_mm,
    widthMm: raw.width_mm,
    thicknessMm: raw.thickness_mm,
    materialId: raw.material_id,
    // #793 — snapshot-frozen industrial codes; null on older snapshots.
    frozenMaterialCode: nullableText(raw.material_code),
    frozenEdgeBandCode: nullableText(raw.edge_band_code),
    edgeBandId: raw.edge_band_id ?? null,
    grain: flag(raw.grain),
    l1: flag(raw.l1),
    l2: flag(raw.l2),
    w1: flag(raw.w1),
    w2: flag(raw.w2),
    optionRole: raw.option_role ?? null,
  };
}

function mapDemand(raw: GeneratedReleaseCuttingDemand): ReleaseCuttingDemandView {
  const units: ReleaseCuttingDemandUnitView[] = raw.units.map((unit) => ({
    furnitureInstanceId: unit.furniture_instance_id,
    furnitureDefinitionId: unit.furniture_definition_id,
    workshopOccurrenceOrdinal: unit.workshop_occurrence_ordinal,
    frozenModuleCode: nullableText(unit.module_code),
    frozenModuleName: nullableText(unit.module_name),
    frozenModuleWidthMm: nullableInt(unit.module_width_mm),
    frozenModuleHeightMm: nullableInt(unit.module_height_mm),
    frozenModuleDepthMm: nullableInt(unit.module_depth_mm),
    pieces: unit.pieces.map(mapPiece),
  }));
  return {
    releaseId: raw.release_id,
    releaseNumber: raw.release_number,
    designRevisionId: raw.design_revision_id,
    designRevisionNumber: raw.design_revision_number,
    manufacturingFingerprint: raw.manufacturing_fingerprint,
    schemaVersion: raw.schema_version,
    units,
  };
}

export async function fetchEngineeringCuttingDemand(args: {
  readonly baseUrl: string;
  readonly token: string;
  readonly projectId: string;
  readonly releaseId: string;
  readonly signal?: AbortSignal;
}): Promise<ReleaseCuttingDemandView> {
  const client = new GraneteApiClient(args.baseUrl);
  const raw = await client.getProjectProductionReleaseCuttingDemand(
    args.token,
    args.projectId,
    args.releaseId,
    args.signal,
  );
  if (raw.release_id !== args.releaseId) {
    throw new Error('El despiece no corresponde a la liberación solicitada');
  }
  return mapDemand(raw);
}

export function useEngineeringCuttingDemand(args: {
  readonly baseUrl: string;
  readonly token: string | null;
  readonly projectId: string | null;
  readonly releaseId: string | null;
  readonly queryKey: QueryKey;
}): EngineeringCuttingDemandContext {
  const query = useQuery({
    queryKey: args.queryKey,
    queryFn: ({ signal }) =>
      fetchEngineeringCuttingDemand({
        baseUrl: args.baseUrl,
        token: args.token as string,
        projectId: args.projectId as string,
        releaseId: args.releaseId as string,
        signal,
      }),
    enabled: Boolean(args.token && args.projectId && args.releaseId),
    retry: false,
  });

  const retry = () => void query.refetch();
  if (!args.projectId || !args.token || !args.releaseId) {
    return { kind: 'idle' };
  }
  if (query.isPending) return { kind: 'loading', retry };
  if (query.isError || !query.data) {
    return {
      kind: 'error',
      message:
        'No se pudo leer el despiece congelado de esta liberación. Puede no estar disponible para tu taller o haber quedado incompleto.',
      retry,
    };
  }
  return { kind: 'ready', demand: query.data, retry };
}
