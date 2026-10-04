/**
 * Structured site survey actions for the App shell (#305, OC-040/OC-041;
 * extracted from AppContent by R5). The dual-write survey action and the
 * handlers for start, spaces, measures capture/verify/approve and the
 * freeze for fabrication. The body moved verbatim from AppContent — the
 * caller passes only the session user; the stores (project, UI toast,
 * workspace repository) are read by the hook.
 */

import { useCallback, useMemo } from 'react';
import {
  approveSpaceMeasures,
  captureSpaceMeasures,
  createSiteSurvey,
  freezeMeasuresForFabrication,
  removeSurveySpace,
  upsertSurveySpace,
  verifySiteSurvey,
  type Project,
} from '@granete/domain';
import type { SiteSurveyView } from '@granete/storage';
import type { SurveyHandlers } from '@granete/ui';
import {
  useProjectStore,
  useUiStore,
  useWorkspaceStore,
} from '../stores';

export function useSiteSurvey({
  authUser,
}: {
  readonly authUser: { readonly id?: string } | null;
}) {
  const projectActions = useProjectStore();
  const toast = useUiStore((s) => s.toast);
  const getRepository = useWorkspaceStore((s) => s.getRepository);

  // #305 — structured site survey (OC-040/OC-041). Same dual-write pattern as
  // costing: the server endpoints are authoritative; offline/local mode runs
  // the mirrored domain functions.
  const runSurveyAction = useCallback(
    (
      projectId: string,
      opts: {
        api?: (repo: ReturnType<typeof getRepository>) => Promise<SiteSurveyView> | null;
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
          message: err instanceof Error && err.message ? err.message : 'Acción de levantamiento inválida',
        });
        return;
      }
      const repo = getRepository();
      const apiPromise = opts.api ? opts.api(repo) : null;
      if (apiPromise) {
        void apiPromise
          .then((view) => {
            // Server is authoritative online: apply the survey it persisted
            // (its entity ids), not the locally-computed payload — otherwise
            // the next action would reference ids the server never saw.
            const project = {
              ...local.project,
              siteSurvey: view.survey ?? local.project.siteSurvey,
            };
            projectActions.applyCostingProject(projectId, project);
            toast({ type: 'success', message: opts.successMessage });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message ? err.message : 'No se pudo completar la acción de levantamiento',
            });
          });
        return;
      }
      projectActions.applyCostingProject(projectId, local.project);
      toast({ type: 'success', message: opts.successMessage });
    },
    [projectActions],
  );

  const surveyHandlers = useMemo<SurveyHandlers>(
    () => ({
      onStart: (projectId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.startSiteSurvey ? repo.startSiteSurvey(projectId) : null),
          local: (p) => createSiteSurvey(p, { byUserId: authUser?.id }),
          successMessage: '✓ Levantamiento iniciado',
        }),
      onUpsertSpace: (projectId, input) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.upsertSurveySpace ? repo.upsertSurveySpace(projectId, input) : null),
          local: (p) => upsertSurveySpace(p, input),
          successMessage: '✓ Espacio guardado',
        }),
      onRemoveSpace: (projectId, spaceId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.removeSurveySpace ? repo.removeSurveySpace(projectId, spaceId) : null),
          local: (p) => removeSurveySpace(p, spaceId),
          successMessage: '✓ Espacio eliminado',
        }),
      onCaptureMeasures: (projectId, spaceId, measures) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.captureSurveyMeasures ? repo.captureSurveyMeasures(projectId, spaceId, measures) : null),
          local: (p) => captureSpaceMeasures(p, { spaceId, measures, byUserId: authUser?.id }),
          successMessage: '✓ Medidas levantadas en obra',
        }),
      onVerify: (projectId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.verifySiteSurvey ? repo.verifySiteSurvey(projectId) : null),
          local: (p) => verifySiteSurvey(p, { byUserId: authUser?.id }),
          successMessage: '✓ Levantamiento verificado',
        }),
      onApproveSpace: (projectId, spaceId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.approveSurveyMeasures ? repo.approveSurveyMeasures(projectId, spaceId) : null),
          local: (p) => approveSpaceMeasures(p, { spaceId, byUserId: authUser?.id }),
          successMessage: '✓ Medidas aprobadas',
        }),
      onFreeze: (projectId) =>
        runSurveyAction(projectId, {
          api: (repo) => (repo.freezeSurveyMeasures ? repo.freezeSurveyMeasures(projectId) : null),
          local: (p) => freezeMeasuresForFabrication(p, { byUserId: authUser?.id }),
          successMessage: '✓ Medidas congeladas para fabricación',
        }),
    }),
    [runSurveyAction, authUser?.id],
  );

  return {
    surveyHandlers,
  };
}
