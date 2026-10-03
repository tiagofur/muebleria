import { useQuery } from '@tanstack/react-query';

import {
  buildWebAuthoringResolveRequest,
  type AuthoringResolveRequestV1,
  type ProfileDemandLine,
  type Project,
} from '@granete/domain';
import type { Module } from '@granete/domain';

/**
 * #989: the live preview must price the SAME governed joinery demand the
 * backend quote freezes (asignación → perfil pineado → contactos verificados).
 * The demand is server truth: this hook runs the authoring resolve per project
 * item — the same governed resolve the designer and the release freeze see —
 * and exposes the per-unit `hardwareProfileDemand` for the breakdown mirror.
 * React never derives demand; it joins the server's derivation.
 *
 * Skip contract (mirror of the Go wiring): a project item contributes demand
 * only when its definition exists and it carries the explicit placed dims the
 * resolve needs — preset-driven structure modules without custom dims are the
 * named limitation the release path cannot derive either.
 */

export type ProjectProfileDemandStatus = 'loading' | 'ready' | 'unavailable' | 'error';

export interface ProjectProfileDemandState {
  /** Index-aligned with project.items; undefined entries contribute nothing. */
  readonly matrix: ReadonlyArray<readonly ProfileDemandLine[] | undefined>;
  readonly status: ProjectProfileDemandStatus;
}

export interface ProjectProfileDemandTransports {
  readonly resolve: (
    token: string,
    request: AuthoringResolveRequestV1,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly getCatalogRevision: (token: string, signal: AbortSignal) => Promise<string>;
}

interface CatalogLike {
  readonly modules: readonly Pick<Module, 'id' | 'structureId'>[];
}

interface DemandUnit {
  readonly itemId: string;
  readonly moduleId: string;
  readonly parameters: Record<string, number>;
  readonly materialChoices: Record<string, string>;
}

/** Mirror of the Go ProjectItemAsDemandUnit skip contract: explicit placed
 * dims or a structure-independent definition, never guessed presets. */
export function demandUnitsFromProject(
  project: Project,
  catalog: CatalogLike,
): DemandUnit[] {
  const units: DemandUnit[] = [];
  for (const item of project.items) {
    const module = catalog.modules.find((candidate) => candidate.id === item.moduleId);
    if (!module) continue;
    const dims = item.customDims;
    if (!dims && module.structureId) continue;
    const parameters: Record<string, number> = {};
    if (dims) {
      parameters.widthMm = dims.widthMm;
      parameters.heightMm = dims.heightMm;
      parameters.depthMm = dims.depthMm;
    }
    units.push({
      itemId: item.id,
      moduleId: item.moduleId,
      parameters,
      materialChoices: { ...item.optionChoices },
    });
  }
  return units;
}

/** Fail-closed extraction of the demand lines from one accepted resolve. */
export function extractDemandLines(response: unknown): readonly ProfileDemandLine[] {
  const machining = (response as { resolved?: { machining?: { hardwareProfileDemand?: unknown } } })
    ?.resolved?.machining;
  const demand = machining?.hardwareProfileDemand;
  if (demand === undefined) return [];
  if (!Array.isArray(demand)) throw new Error('hardwareProfileDemand must be an array when present');
  return demand.map((line) => {
    const hardwareId = (line as { hardwareId?: unknown })?.hardwareId;
    const quantity = (line as { quantity?: unknown })?.quantity;
    if (typeof hardwareId !== 'string' || hardwareId.trim() === '') {
      throw new Error('hardwareProfileDemand line has no hardware identity');
    }
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`hardwareProfileDemand line ${hardwareId} has an invalid quantity`);
    }
    return { hardwareId, quantity };
  });
}

export function useProjectProfileDemand(input: {
  readonly project: Project | undefined;
  readonly catalog: CatalogLike | undefined;
  readonly enabled: boolean;
  readonly token: string;
  readonly transports: ProjectProfileDemandTransports;
}): ProjectProfileDemandState {
  const { project, catalog, enabled, token, transports } = input;
  const units = project && catalog && enabled ? demandUnitsFromProject(project, catalog) : [];

  const query = useQuery({
    queryKey: [
      'project-profile-demand',
      units.map((unit) => [unit.itemId, unit.moduleId, unit.parameters, unit.materialChoices]),
    ],
    enabled: units.length > 0,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const revision = await transports.getCatalogRevision(token, signal);
      const perUnit = await Promise.all(
        units.map(async (unit) => {
          const request = buildWebAuthoringResolveRequest({
            furnitureDefinitionId: unit.moduleId,
            catalogRevision: revision,
            parameters: unit.parameters,
            materialChoices: unit.materialChoices,
          });
          const response = await transports.resolve(token, request, signal);
          return extractDemandLines(response);
        }),
      );
      const matrix: Record<string, readonly ProfileDemandLine[]> = {};
      units.forEach((unit, index) => {
        matrix[unit.itemId] = perUnit[index] ?? [];
      });
      return matrix;
    },
  });

  if (!project || !catalog || !enabled || units.length === 0) {
    return { matrix: [], status: 'unavailable' };
  }
  if (query.isPending) return { matrix: [], status: 'loading' };
  if (query.isError) return { matrix: [], status: 'error' };

  const byItem = query.data ?? {};
  return {
    matrix: project.items.map((item) => byItem[item.id] ?? []),
    status: 'ready',
  };
}
