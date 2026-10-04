/**
 * Quality actions for the App shell (#302, OC-060..OC-062; extracted from
 * AppContent by R5). Quality-issue reporting, rework with costing and
 * physical piece effect, per-unit QC checklists and the audited supervisor
 * override, plus the per-project quality panel views. The body moved
 * verbatim from AppContent — the hook reads its own stores (project, UI
 * toast, workspace repository) and takes no parameters.
 */

import { useCallback, useMemo } from 'react';
import {
  overrideUnitQc,
  recordReworkAction,
  recordUnitQc,
  reportQualityIssue,
  transitionQualityIssue,
  type Project,
} from '@granete/domain';
import {
  qualityPanelView,
  type QualityHandlers,
  type QualityPanelView,
} from '@granete/ui';
import {
  useProjectStore,
  useUiStore,
  useWorkspaceStore,
} from '../stores';

export function useQualityActions() {
  const projectActions = useProjectStore();
  const toast = useUiStore((s) => s.toast);
  const getRepository = useWorkspaceStore((s) => s.getRepository);

  /**
   * #302 (OC-060..OC-062) — quality actions: report issues, rework with
   * costing (physical piece effect included), per-unit QC checklist and the
   * audited supervisor override.
   */
  const runQualityAction = useCallback(
    (
      projectId: string,
      opts: {
        api?: (repo: ReturnType<typeof getRepository>) => Promise<unknown> | null;
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
          message: err instanceof Error && err.message ? err.message : 'Acción de calidad inválida',
        });
        return;
      }
      const repo = getRepository();
      const apiPromise = opts.api ? opts.api(repo) : null;
      if (apiPromise) {
        void apiPromise
          .then(() => {
            projectActions.applyQualityProject(projectId, local.project);
            toast({ type: 'success', message: opts.successMessage });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message: err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de calidad',
            });
          });
        return;
      }
      projectActions.applyQualityProject(projectId, local.project);
      toast({ type: 'success', message: opts.successMessage });
    },
    [getRepository, projectActions, toast],
  );

  const qualityHandlers = useMemo<QualityHandlers>(
    () => ({
      onReportIssue: (projectId, payload) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.reportQualityIssue ? repo.reportQualityIssue(projectId, payload) : null),
          local: (p) => reportQualityIssue(p, payload),
          successMessage: '✓ Problema de calidad reportado',
        }),
      onRework: (projectId, payload) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.recordQualityRework ? repo.recordQualityRework(projectId, payload) : null),
          local: (p) => recordReworkAction(p, payload.issueId, payload),
          successMessage: '✓ Retrabajo registrado con costo',
        }),
      onTransition: (projectId, issueId, toStatus, notes) =>
        runQualityAction(projectId, {
          api: (repo) =>
            repo.transitionQualityIssue ? repo.transitionQualityIssue(projectId, issueId, toStatus, notes) : null,
          local: (p) => transitionQualityIssue(p, issueId, toStatus, { notes }),
          successMessage: '✓ Estado de calidad actualizado',
        }),
      onRecordQc: (projectId, unitId, checklist) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.recordQualityUnitQc ? repo.recordQualityUnitQc(projectId, unitId, checklist) : null),
          local: (p) => recordUnitQc(p, unitId, { checklist }),
          successMessage: '✓ QC de unidad registrado',
        }),
      onOverrideQc: (projectId, unitId, reason) =>
        runQualityAction(projectId, {
          api: (repo) => (repo.overrideQualityUnitQc ? repo.overrideQualityUnitQc(projectId, unitId, reason) : null),
          local: (p) => overrideUnitQc(p, unitId, { reason }),
          successMessage: '✓ Override de QC registrado (auditado)',
        }),
    }),
    [runQualityAction],
  );

  /** Quality view per project with units at/past the QC gate. */
  const qualityByProject = useMemo<Readonly<Record<string, QualityPanelView>>>(() => {
    const entries = projectActions.projects
      .filter(
        (p) =>
          (p.moduleUnits ?? []).some((u) => u.status === 'module_qc' || u.status === 'packaged') ||
          (p.quality?.issues.length ?? 0) > 0,
      )
      .map((project) => [project.id, qualityPanelView(project)] as const);
    return Object.fromEntries(entries);
  }, [projectActions.projects]);

  return {
    qualityHandlers,
    qualityByProject,
  };
}
