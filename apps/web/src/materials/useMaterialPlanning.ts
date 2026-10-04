/**
 * Material planning actions for the App shell (#302, OC-050..OC-062;
 * extracted from AppContent by R5). Per-project card views for the almacén
 * stage, derive/reserve/release actions with scope truth and epoch guards,
 * and the planning handlers including shortage PO creation. The body moved
 * verbatim from AppContent — the caller passes only the session user and the
 * purchasing requirement-lines derivation; the stores (project, catalog, UI
 * toast, workspace repository, purchasing stock/POs) are read by the hook.
 */

import { useCallback, useMemo, useRef } from 'react';
import {
  filterProjectsByProcessStage,
  materializeRequirements,
  releaseAuthorityOf,
  releaseProjectMaterials,
  reserveProjectMaterials,
  type MaterialRequirementLine,
  type Project,
  type StockMaterialKind,
} from '@granete/domain';
import {
  materialPlanningCardView,
  shortagePoLines,
  type MaterialPlanningCardView,
  type MaterialPlanningHandlers,
} from '@granete/ui';
import { buildStockCatalog } from '../derivations/stockCatalog';
import { sessionScopeKey } from '../shared/query/sessionScope';
import {
  getProjectStoreState,
  getPurchasingStoreState,
  useCatalogStore,
  useProjectStore,
  usePurchasingStore,
  useUiStore,
  useWorkspaceStore,
} from '../stores';

export function useMaterialPlanning({
  authUser,
  requirementLinesFor,
}: {
  readonly authUser: { readonly id?: string } | null;
  readonly requirementLinesFor: (
    projectId: string,
  ) => Array<{ kind: StockMaterialKind; materialId: string; quantity: number }>;
}) {
  const projectActions = useProjectStore();
  const catalog = useCatalogStore((s) => s.catalog);
  const toast = useUiStore((s) => s.toast);
  const getRepository = useWorkspaceStore((s) => s.getRepository);
  const stockRows = usePurchasingStore((s) => s.stockRows);
  const purchaseOrders = usePurchasingStore((s) => s.purchaseOrders);
  const materials = catalog?.materials ?? [];
  const stockCatalog = useMemo(() => buildStockCatalog(catalog), [catalog]);

  /** Evidence view per almacén-stage project (coverage + release gates). */
  const planningByProject = useMemo<Readonly<Record<string, MaterialPlanningCardView>>>(() => {
    const plannings = projectActions.projects
      .map((p) => p.materialPlanning)
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    const entries = filterProjectsByProcessStage(projectActions.projects, 'almacen')
      .map((project) => [
        project.id,
        materialPlanningCardView(project, plannings, stockRows ?? [], purchaseOrders ?? []),
      ] as const);
    return Object.fromEntries(entries);
  }, [projectActions.projects, stockRows, purchaseOrders]);

  /**
   * #302 (OC-050..OC-054) — material planning actions. API mode calls the
   * dedicated materials endpoints (server enforces the release binding,
   * reservation caps and the OC-054 gates with audited override); the
   * local/offline workspace runs the pure domain actions.
   */
  const materialActionEpoch = useRef(new Map<string, number>());
  const runMaterialPlanningAction = useCallback(
    (
      projectId: string,
      kind: 'derive' | 'reserve' | 'release',
      payload: { lines?: readonly MaterialRequirementLine[]; overrideReason?: string },
      localAction: (project: Project) => Project,
      successMessage: string,
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      const epoch = (materialActionEpoch.current.get(projectId) ?? 0) + 1;
      materialActionEpoch.current.set(projectId, epoch);
      const repo = getRepository();
      const scope = useWorkspaceStore.getState().sessionScope;
      const scopeKey = scope ? JSON.stringify(sessionScopeKey(scope)) : null;
      const requirements = project.materialPlanning?.requirements;
      const productionReleaseId = releaseAuthorityOf(project)?.source === 'canonical'
        ? requirements?.releaseId : undefined;
      const currentProject = (): Project | undefined => {
        if (materialActionEpoch.current.get(projectId) !== epoch) return;
        const currentScope = useWorkspaceStore.getState().sessionScope;
        if ((currentScope ? JSON.stringify(sessionScopeKey(currentScope)) : null) !== scopeKey) return;
        const current = getProjectStoreState().projects.find((p) => p.id === projectId);
        if (current?.materialPlanning?.requirements?.releaseId !== requirements?.releaseId ||
          current?.materialPlanning?.id !== project.materialPlanning?.id) return;
        return current;
      };
      const fail = (err: unknown): void => {
        if (!currentProject()) return;
        toast({ type: 'error', message: err instanceof Error ? err.message : 'No se pudo completar la acción de materiales' });
      };
      const applyServer = (view: { planning: unknown; released: boolean }): void => {
        const current = currentProject();
        if (!current) return;
        const planning = view.planning as Project['materialPlanning'];
        if (!planning || (planning.release && !planning.release.releasedBy) || (productionReleaseId && planning.requirements?.releaseId !== productionReleaseId)) {
          fail(new Error('La respuesta no corresponde a la planificación solicitada'));
          return;
        }
        projectActions.applyMaterialPlanningProject(projectId, {
          ...current,
          materialPlanning: planning,
          materialsRelease: planning.release
            ? { releasedAt: planning.release.releasedAt, releasedBy: planning.release.releasedBy! }
            : current.materialsRelease,
        });
        toast({ type: 'success', message: successMessage });
      };
      if (kind === 'reserve' && repo.reserveMaterials) {
        void repo.reserveMaterials(projectId, undefined, { productionReleaseId }).then(applyServer).catch(fail);
        return;
      }
      if (kind === 'release' && repo.releaseMaterials) {
        void repo.releaseMaterials(projectId, payload.overrideReason, { productionReleaseId }).then(applyServer).catch(fail);
        return;
      }
      if (kind === 'derive' && repo.deriveMaterialRequirements && payload.lines) {
        void repo.deriveMaterialRequirements(projectId, payload.lines).then(applyServer).catch(fail);
        return;
      }
      if (releaseAuthorityOf(project)?.source === 'canonical') {
        fail(new Error('La planificación canónica requiere conexión con el servidor'));
        return;
      }
      try {
        projectActions.applyMaterialPlanningProject(projectId, localAction(project));
        toast({ type: 'success', message: successMessage });
      } catch (err) { fail(err); }
    },
    [getRepository, projectActions, toast],
  );

  const planningHandlers = useMemo<MaterialPlanningHandlers>(
    () => ({
      onDerive: (projectId) => {
        const project = projectActions.projects.find((p) => p.id === projectId);
        const authority = project ? releaseAuthorityOf(project) : undefined;
        const repo = getRepository();
        const epoch = (materialActionEpoch.current.get(projectId) ?? 0) + 1;
        materialActionEpoch.current.set(projectId, epoch);
        const scope = useWorkspaceStore.getState().sessionScope;
        const scopeKey = scope ? JSON.stringify(sessionScopeKey(scope)) : null;
        const isCurrent = (): boolean => {
          if (materialActionEpoch.current.get(projectId) !== epoch) return false;
          const currentScope = useWorkspaceStore.getState().sessionScope;
          const currentKey = currentScope ? JSON.stringify(sessionScopeKey(currentScope)) : null;
          if (currentKey !== scopeKey) return false;
          const current = getProjectStoreState().projects.find((p) => p.id === projectId);
          return !!current &&
            releaseAuthorityOf(current)?.releaseId === authority?.releaseId;
        };
        // Canonical demand is frozen server-side; never re-resolve mutable catalog here.
        if (authority?.source === 'canonical' && repo.deriveMaterialRequirements) {
          void repo
            .deriveMaterialRequirements(projectId, [], { productionReleaseId: authority.releaseId })
            .then((view) => {
              if (!isCurrent()) return;
              const current = getProjectStoreState().projects.find((p) => p.id === projectId);
              if (!current) return;
              projectActions.applyMaterialPlanningProject(projectId, {
                ...current,
                materialPlanning:
                  (view.planning as Project['materialPlanning']) ?? current.materialPlanning,
              });
              toast({
                type: 'success',
                message: '✓ Requerimientos derivados de la liberación canónica',
              });
            })
            .catch((err: unknown) => {
              if (!isCurrent()) return;
              toast({
                type: 'error',
                message:
                  err instanceof Error && err.message
                    ? err.message
                    : 'No se pudo completar la acción de materiales',
              });
            });
          return;
        }
        if (authority?.source === 'canonical') {
          toast({ type: 'error', message: 'No se puede leer la revisión liberada en esta conexión' });
          return;
        }
        const lines = requirementLinesFor(projectId);
        if (lines.length === 0) {
          toast({ type: 'error', message: 'El BOM liberado no produjo líneas de requerimiento' });
          return;
        }
        runMaterialPlanningAction(
          projectId,
          'derive',
          { lines },
          (p) => materializeRequirements(p, { lines, derivedBy: authUser?.id }).project,
          '✓ Requerimientos derivados del BOM liberado',
        );
      },
      onReserve: (projectId) => {
        const plannings = projectActions.projects
          .map((p) => p.materialPlanning)
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
        runMaterialPlanningAction(
          projectId,
          'reserve',
          {},
          (p) => reserveProjectMaterials(p, { stock: stockRows ?? [], plannings }).project,
          '✓ Material reservado (el faltante queda auditado)',
        );
      },
      onRelease: (projectId, overrideReason) => {
        const plannings = projectActions.projects
          .map((p) => p.materialPlanning)
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
        runMaterialPlanningAction(
          projectId,
          'release',
          { overrideReason },
          (p) =>
            releaseProjectMaterials(p, {
              stock: stockRows ?? [],
              plannings,
              byUserId: authUser?.id,
              overrideReason,
            }).project,
          overrideReason
            ? '✓ Material liberado con override (auditado)'
            : '✓ Material completo — liberado a producción',
        );
      },
      onCreateShortagePO: (projectId) => {
        const view = planningByProject[projectId];
        if (!view || view.shortageLines.length === 0) return;
        const items = shortagePoLines(view).map((l) => ({ ...l, allocatedProjectId: projectId }));
        void getPurchasingStoreState()
          .savePurchaseOrder({
            supplierId: '',
            items,
            requiredBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          })
          .then(() => {
            toast({
              type: 'success',
              message: `✓ Borrador de OC creado con ${items.length} línea(s) del faltante — completá el proveedor en Compras`,
            });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message: err instanceof Error && err.message ? err.message : 'No se pudo crear la OC',
            });
          });
      },
    }),
    [
      runMaterialPlanningAction,
      requirementLinesFor,
      stockRows,
      projectActions.projects,
      authUser?.id,
      planningByProject,
      catalog,
      materials,
      stockCatalog,
      getRepository,
      toast,
    ],
  );

  return {
    planningByProject,
    planningHandlers,
  };
}
