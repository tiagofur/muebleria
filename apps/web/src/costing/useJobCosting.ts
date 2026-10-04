/**
 * Job costing for the App shell (#304, OC-080..OC-084; extracted from
 * AppContent by R5). Per-project costing views (local aggregate + server
 * authoritative valuation), material/edge/hardware labels, the dual-write
 * costing action and the costing handlers (baseline, labor rate, time
 * entries, other costs). The body moved verbatim from AppContent — the
 * caller passes only the session user and the showCosts flag; the stores
 * (project, catalog, UI toast, workspace repository) are read by the hook.
 * The server-views loader effect stays in AppContent (effect order) and
 * consumes costingServerViews/setCostingServerViews from here.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  captureCostBaseline,
  computeJobCostSummary,
  recordOtherCost,
  recordTimeEntry,
  releaseAuthorityOf,
  reworkCostSummary,
  setLaborRate,
  voidOtherCost,
  voidTimeEntry,
  type Project,
} from '@granete/domain';
import {
  costingPanelView,
  MATERIAL_BASIS_LABELS_ES,
  type CostingHandlers,
  type CostingPanelView,
} from '@granete/ui';
import type { JobCostingView } from '@granete/storage';
import {
  useCatalogStore,
  useProjectStore,
  useUiStore,
  useWorkspaceStore,
} from '../stores';

export function useJobCosting({
  authUser,
  showCosts,
}: {
  readonly authUser: { readonly id?: string; readonly name?: string } | null;
  readonly showCosts: boolean;
}) {
  const projectActions = useProjectStore();
  const catalog = useCatalogStore((s) => s.catalog);
  const toast = useUiStore((s) => s.toast);
  const getRepository = useWorkspaceStore((s) => s.getRepository);

  // ── Job costing (OC-080..OC-084, #304) ────────────────────────────────────
  // Views resolve locally from the project aggregate; when the server costing
  // view is loaded (repo API), its summary/material take over — the server is
  // the only one that can value the job-assigned stock consumption (OC-082).

  const [costingServerViews, setCostingServerViews] = useState<
    Readonly<Record<string, JobCostingView>>
  >({});

  const costingViewByProject = useMemo<Readonly<Record<string, CostingPanelView>>>(() => {
    if (!showCosts) return {};
    const entries: [string, CostingPanelView][] = [];
    for (const project of projectActions.projects) {
      const costing = project.costing;
      const hasSource = Boolean(project.priceSnapshot || releaseAuthorityOf(project));
      if (!costing && !hasSource) continue;
      const serverView = costingServerViews[project.id];
      if (serverView) {
        entries.push([
          project.id,
          costingPanelView(project, {
            summary: serverView.summary,
            materialLines: serverView.material.lines.map((line) => ({
              ...line,
              basisLabel: MATERIAL_BASIS_LABELS_ES[line.basis] ?? line.basis,
            })),
            missingValuationMaterialIds: serverView.material.missingValuationMaterialIds,
          }),
        ]);
        continue;
      }
      const rework = reworkCostSummary(project.quality);
      entries.push([
        project.id,
        costingPanelView(project, {
          summary: computeJobCostSummary({
            baseline: costing?.baseline,
            timeEntries: costing?.timeEntries ?? [],
            laborRatePerHour: costing?.laborRatePerHour ?? 0,
            rework,
            otherCosts: costing?.otherCosts ?? [],
          }),
        }),
      ]);
    }
    return Object.fromEntries(entries);
  }, [showCosts, projectActions.projects, costingServerViews]);

  const costingLabelsByMaterial = useMemo<Readonly<Record<string, string>>>(() => {
    const labels: Record<string, string> = {};
    for (const board of catalog?.materials ?? []) labels[board.id] = `${board.code} — ${board.name}`;
    for (const edge of catalog?.edges ?? []) labels[edge.id] = `${edge.code} — ${edge.name}`;
    for (const hardware of catalog?.hardware ?? []) labels[hardware.id] = `${hardware.code} — ${hardware.name}`;
    return labels;
  }, [catalog]);

  const runCostingAction = useCallback(
    (
      projectId: string,
      opts: {
        api?: (repo: ReturnType<typeof getRepository>) => Promise<JobCostingView> | null;
        local: (project: Project) => { project: Project };
        successMessage: string;
      },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: { project: Project };
      try {
        local = opts.local(project);
      } catch (err) {
        toast({
          type: 'error',
          message: err instanceof Error && err.message ? err.message : 'Acción de costos inválida',
        });
        return;
      }
      const repo = getRepository();
      const apiPromise = opts.api ? opts.api(repo) : null;
      if (apiPromise) {
        void apiPromise
          .then((view) => {
            projectActions.applyCostingProject(projectId, local.project);
            setCostingServerViews((prev) => ({ ...prev, [projectId]: view }));
            toast({ type: 'success', message: opts.successMessage });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message: err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de costos',
            });
          });
        return;
      }
      projectActions.applyCostingProject(projectId, local.project);
      toast({ type: 'success', message: opts.successMessage });
    },
    [getRepository, projectActions, toast],
  );

  const costingHandlers = useMemo<CostingHandlers>(
    () => ({
      onCaptureBaseline: (projectId) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.captureCostBaseline ? repo.captureCostBaseline(projectId) : null),
          local: (p) => captureCostBaseline(p, { byUserId: authUser?.id }),
          successMessage: '✓ Baseline de costos capturado',
        }),
      onSetLaborRate: (projectId, ratePerHour) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.setCostingLaborRate ? repo.setCostingLaborRate(projectId, ratePerHour) : null),
          local: (p) => setLaborRate(p, { ratePerHour }),
          successMessage: '✓ Tarifa horaria actualizada',
        }),
      onRecordTime: (projectId, payload) =>
        runCostingAction(projectId, {
          api: (repo) =>
            repo.recordCostingTime
              ? repo.recordCostingTime(projectId, {
                  category: payload.category as never,
                  minutes: payload.minutes,
                  note: payload.note,
                })
              : null,
          local: (p) =>
            recordTimeEntry(p, {
              category: payload.category as never,
              minutes: payload.minutes,
              note: payload.note,
              byUserId: authUser?.id,
              byName: authUser?.name,
            }),
          successMessage: '✓ Tiempo registrado',
        }),
      onVoidTime: (projectId, entryId) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.voidCostingTime ? repo.voidCostingTime(projectId, entryId) : null),
          local: (p) => voidTimeEntry(p, entryId, { byUserId: authUser?.id }),
          successMessage: '✓ Registro anulado',
        }),
      onRecordOtherCost: (projectId, payload) =>
        runCostingAction(projectId, {
          api: (repo) =>
            repo.recordCostingOtherCost
              ? repo.recordCostingOtherCost(projectId, {
                  kind: payload.kind as never,
                  amount: payload.amount,
                  vendor: payload.vendor,
                  note: payload.note,
                })
              : null,
          local: (p) =>
            recordOtherCost(p, {
              kind: payload.kind as never,
              amount: payload.amount,
              vendor: payload.vendor,
              note: payload.note,
              byUserId: authUser?.id,
              byName: authUser?.name,
            }),
          successMessage: '✓ Costo registrado',
        }),
      onVoidOtherCost: (projectId, costId) =>
        runCostingAction(projectId, {
          api: (repo) => (repo.voidCostingOtherCost ? repo.voidCostingOtherCost(projectId, costId) : null),
          local: (p) => voidOtherCost(p, costId, { byUserId: authUser?.id }),
          successMessage: '✓ Costo anulado',
        }),
    }),
    [runCostingAction, authUser?.id, authUser?.name],
  );

  return {
    costingViewByProject,
    costingLabelsByMaterial,
    costingHandlers,
    costingServerViews,
    setCostingServerViews,
  };
}
