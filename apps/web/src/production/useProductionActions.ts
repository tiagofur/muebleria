/**
 * Production and installation actions for the App shell (F094, #301, #577,
 * #303; extracted from AppContent by R5). Floor advances with station/warehouse
 * scoping, part/unit execution advances, canonical-or-derived part-execution
 * generation and the installation job/closeout lifecycle. The body moved
 * verbatim from AppContent — the caller passes only the actor roles; the
 * project/catalog/UI/workspace stores are read by the hook itself.
 */

import { useCallback, useMemo } from 'react';
import {
  anyRole,
  cancelInstallationVisit,
  closePunchItem,
  closeProjectCloseout,
  completeInstallation,
  completeInstallationVisit,
  deriveProjectPartExecutions,
  openPunchItem,
  recordClientSignOff,
  releaseAuthorityOf,
  reportFieldIssue,
  scheduleInstallationVisit,
  startInstallationVisit,
  transitionFieldIssue,
  type FieldIssueStatus,
  type InstallationJob,
  type InstallationVisitResult,
  type ItemFloorStatus,
  type Project,
  type PunchSeverity,
} from '@granete/domain';
import { sessionScopeKey } from '../shared/query/sessionScope';
import {
  getProjectStoreState,
  useCatalogStore,
  useProjectStore,
  useUiStore,
  useWorkspaceStore,
} from '../stores';

export function useProductionActions({
  actorRole,
  actorRoles,
}: {
  readonly actorRole: string | null;
  readonly actorRoles: readonly string[];
}) {
  const projectActions = useProjectStore();
  const catalog = useCatalogStore((s) => s.catalog);
  const toast = useUiStore((s) => s.toast);
  const getRepository = useWorkspaceStore((s) => s.getRepository);
  const setItemFloorStatus = projectActions.setItemFloorStatus;

  // Menu reorg — shared floor advance for Producción (stations) and
  // Embarques (cargar/instalar). Server path enforces station scoping +
  // writes the audit event (F094); mirror locally to keep lists in sync.
  const handleFloorAdvance = useCallback(
    (projectId: string, itemId: string, target: ItemFloorStatus) => {
      // packaged → loaded is a warehouse (Almacén) transition, not production.
      // Only almacen and admins can advance past packaged.
      if (target === 'loaded') {
        if (
          !anyRole(actorRoles, (r) =>
            r === 'admin' || r === 'gerente_produccion' || r === 'almacen',
          )
        ) {
          toast({ type: 'error', message: 'La carga de muebles es responsabilidad de Almacén.' });
          return;
        }
      }
      const repo = getRepository();
      if (repo.setProjectItemFloorStatus) {
        void repo
          .setProjectItemFloorStatus(projectId, itemId, target)
          .then((res) => {
            if (res.floorStatus === target) {
              setItemFloorStatus(projectId, itemId, target);
            }
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo avanzar el mueble',
            });
          });
      } else {
        setItemFloorStatus(projectId, itemId, target);
      }
    },
    [getRepository, setItemFloorStatus, toast, actorRole],
  );

  // #301 — physical advances: piece operations and unit transitions go
  // through the part-executions endpoints (server gate + audit); the local
  // mirror applies the same pure domain logic to keep lists in sync. The
  // offline/local workspace uses the pure path directly.
  const handleAdvancePart = useCallback(
    (projectId: string, partId: string) => {
      const repo = getRepository();
      if (repo.advancePartOperation) {
        void repo
          .advancePartOperation(projectId, partId, { advance: true, source: 'manual' })
          .then(() => {
            projectActions.advancePartInstanceLocal(projectId, partId);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo avanzar la pieza',
            });
          });
      } else {
        projectActions.advancePartInstanceLocal(projectId, partId);
      }
    },
    [getRepository, projectActions, toast],
  );

  const handleAdvanceUnit = useCallback(
    (projectId: string, unitId: string) => {
      const repo = getRepository();
      if (repo.advanceModuleUnit) {
        void repo
          .advanceModuleUnit(projectId, unitId, { advance: true, source: 'manual' })
          .then(() => {
            projectActions.advanceModuleUnitLocal(projectId, unitId);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo avanzar la unidad',
            });
          });
      } else {
        const result = projectActions.advanceModuleUnitLocal(projectId, unitId);
        if (!result.ok) {
          toast({ type: 'error', message: result.blockers.join(' · ') });
        }
      }
    },
    [getRepository, projectActions, toast],
  );

  /**
   * #301 — generate the physical executions of a released project from its
   * catalog BOM. API mode validates server-side (lines/quantities/released
   * revision, progress guard); local mode sets them directly. No-op when the
   * project already progressed physically (regeneration needs supervision).
   */
  const handleGeneratePartExecutions = useCallback(
    (projectId: string) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      // #577 / OPS-DT-1: the gate is the release authority (canonical
      // ProductionRelease first — no legacy liberation required), and the
      // executions are stamped with its exact release id (the server guard
      // 409s any other token).
      const authority = project ? releaseAuthorityOf(project) : undefined;
      if (!project || !authority || !catalog) return;
      if (project.partInstances?.length) {
        const hasProgress =
          project.partInstances.some((p) =>
            p.requiredOperations.some((op) => op.status === 'completed' || op.status === 'rework'),
          ) ||
          project.moduleUnits?.some((u) => u.status !== 'awaiting_parts');
        if (hasProgress) return; // regeneration is a supervised action, never automatic
      }
      const repo = getRepository();
      const scope = useWorkspaceStore.getState().sessionScope;
      const scopeKey = scope ? JSON.stringify(sessionScopeKey(scope)) : null;
      const isCurrent = (): boolean => {
        const currentScope = useWorkspaceStore.getState().sessionScope;
        const currentKey = currentScope ? JSON.stringify(sessionScopeKey(currentScope)) : null;
        if (currentKey !== scopeKey) return false;
        const currentProject = getProjectStoreState().projects.find((p) => p.id === projectId);
        return !!currentProject &&
          releaseAuthorityOf(currentProject)?.releaseId === authority.releaseId;
      };
      const generate = (derivationProject: Project, revision: string): void => {
        if (!isCurrent()) return;
        if (repo.generatePartExecutions) {
          if (authority.source === 'canonical') {
            // #577: canonical executions are derived server-side from the
            // exact frozen snapshot + routing program. The client sends an
            // EMPTY payload and applies the authoritative readback — never a
            // local catalog reconstruction.
            void repo
              .generatePartExecutions(projectId, { partInstances: [], moduleUnits: [] })
              .then((result) => {
                if (!isCurrent()) return;
                if (result.canonicalParts && result.canonicalUnits) {
                  projectActions.setPartExecutions(
                    projectId,
                    [...result.canonicalParts],
                    [...result.canonicalUnits],
                  );
                } else {
                  toast({
                    type: 'error',
                    message:
                      'La liberación no devolvió la ejecución física congelada; recargá la obra e intentá de nuevo',
                  });
                }
              })
              .catch((err) => {
                if (!isCurrent()) return;
                toast({
                  type: 'error',
                  message:
                    err instanceof Error && err.message
                      ? err.message
                      : 'No se pudo generar la ejecución física',
                });
              });
            return;
          }
          const derived = deriveProjectPartExecutions(derivationProject, catalog, {
            productionRevision: revision,
          });
          if (!derived.ok) {
            toast({
              type: 'error',
              message: derived.error.projectItemId
                  ? `No se pudieron generar las piezas físicas (línea ${derived.error.projectItemId}): ${derived.error.message}`
                  : derived.error.message,
            });
            return;
          }
          const { parts, units } = derived.executions;
          void repo
            .generatePartExecutions(projectId, { partInstances: parts, moduleUnits: units })
            .then(() => {
              if (!isCurrent()) return;
              projectActions.setPartExecutions(projectId, parts, units);
            })
            .catch((err) => {
              if (!isCurrent()) return;
              toast({
                type: 'error',
                message:
                  err instanceof Error && err.message
                    ? err.message
                    : 'No se pudo generar la ejecución física',
              });
            });
          return;
        }
        // Local/offline workspace: legacy derivation only (canonical
        // generation requires the server's frozen snapshot authority).
        const derived = deriveProjectPartExecutions(derivationProject, catalog, {
          productionRevision: revision,
        });
        if (!derived.ok) {
          toast({
            type: 'error',
            message: derived.error.projectItemId
                ? `No se pudieron generar las piezas físicas (línea ${derived.error.projectItemId}): ${derived.error.message}`
                : derived.error.message,
          });
          return;
        }
        const { parts, units } = derived.executions;
        projectActions.setPartExecutions(projectId, parts, units);
      };
      // The domain adapter rejects canonical inputs without frozen routing
      // evidence. Never reconstruct P1 through current catalog definitions.
      generate(project, authority.releaseId);
    },
    [catalog, getRepository, projectActions, toast],
  );

  /**
   * #303 (OC-070..OC-074) — installation job actions. The pure domain action
   * validates client-side and computes the next job; API mode PUTs it to the
   * installation endpoint (server re-validates transitions and appends the
   * audit lifecycle events) and mirrors the server-persisted job; the
   * local/offline workspace applies the pure result (job + events) directly.
   */
  const runInstallationJobAction = useCallback(
    (
      projectId: string,
      action: (project: Project) => { project: Project; job: InstallationJob },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let result: { project: Project; job: InstallationJob };
      try {
        result = action(project);
      } catch (err) {
        toast({
          type: 'error',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Acción de instalación inválida',
        });
        return;
      }
      const repo = getRepository();
      if (repo.saveInstallation) {
        void repo
          .saveInstallation(projectId, result.job)
          .then(() => {
            projectActions.setInstallationJob(projectId, result.job);
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo guardar la instalación',
            });
          });
      } else {
        projectActions.applyInstallationProject(projectId, result.project);
      }
    },
    [getRepository, projectActions, toast],
  );

  /**
   * #303 — server-authoritative closeout milestones: completar instalación,
   * conformidad del cliente y cierre del proyecto (OC-074 gates). The pure
   * action gives the same validation offline; the endpoint enforces it for
   * every client.
   */
  const runInstallationCloseout = useCallback(
    (
      projectId: string,
      payload: {
        action: 'complete_installation' | 'sign_off' | 'close';
        signedOffBy?: string;
      },
      action: (project: Project) => { project: Project },
    ) => {
      const project = projectActions.projects.find((p) => p.id === projectId);
      if (!project) return;
      let local: { project: Project };
      try {
        local = action(project);
      } catch (err) {
        toast({
          type: 'error',
          message:
            err instanceof Error && err.message
              ? err.message
              : 'Acción de cierre inválida',
        });
        return;
      }
      const repo = getRepository();
      if (repo.installationCloseout) {
        void repo
          .installationCloseout(projectId, payload)
          .then((res) => {
            projectActions.setInstallationJob(projectId, res.installation);
            toast({
              type: 'success',
              message:
                payload.action === 'complete_installation'
                  ? '✓ Instalación completada'
                  : payload.action === 'sign_off'
                    ? '✓ Conformidad registrada'
                    : '✓ Proyecto cerrado',
            });
          })
          .catch((err) => {
            toast({
              type: 'error',
              message:
                err instanceof Error && err.message
                  ? err.message
                  : 'No se pudo completar la acción de cierre',
            });
          });
      } else {
        projectActions.applyInstallationProject(projectId, local.project);
        toast({
          type: 'success',
          message:
            payload.action === 'complete_installation'
              ? '✓ Instalación completada'
              : payload.action === 'sign_off'
                ? '✓ Conformidad registrada'
                : '✓ Proyecto cerrado',
        });
      }
    },
    [getRepository, projectActions, toast],
  );

  const installationJobHandlers = useMemo(
    () => ({
      onScheduleVisit: (projectId: string, params: { date: string; crew: readonly string[]; notes?: string }) =>
        runInstallationJobAction(projectId, (p) => scheduleInstallationVisit(p, params)),
      onStartVisit: (projectId: string, visitId: string) =>
        runInstallationJobAction(projectId, (p) => startInstallationVisit(p, visitId, {})),
      onCompleteVisit: (
        projectId: string,
        visitId: string,
        params: { result: InstallationVisitResult; resultNotes?: string },
      ) => runInstallationJobAction(projectId, (p) => completeInstallationVisit(p, visitId, params)),
      onCancelVisit: (projectId: string, visitId: string) =>
        runInstallationJobAction(projectId, (p) => cancelInstallationVisit(p, visitId, {})),
      onReportIssue: (projectId: string, params: { description: string }) =>
        runInstallationJobAction(projectId, (p) => reportFieldIssue(p, params)),
      onTransitionIssue: (projectId: string, issueId: string, to: FieldIssueStatus) =>
        runInstallationJobAction(projectId, (p) => transitionFieldIssue(p, issueId, to, {})),
      onOpenPunch: (
        projectId: string,
        params: {
          description: string;
          owner: string;
          dueDate?: string;
          severity: PunchSeverity;
          isBlocker: boolean;
        },
      ) => runInstallationJobAction(projectId, (p) => openPunchItem(p, params)),
      onClosePunch: (projectId: string, punchItemId: string, params: { resolutionNotes: string }) =>
        runInstallationJobAction(projectId, (p) => closePunchItem(p, punchItemId, params)),
      onCompleteInstallation: (projectId: string) =>
        runInstallationCloseout(projectId, { action: 'complete_installation' }, (p) =>
          completeInstallation(p, {}),
        ),
      onSignOff: (projectId: string, params: { signedOffBy: string }) =>
        runInstallationCloseout(
          projectId,
          { action: 'sign_off', signedOffBy: params.signedOffBy },
          (p) => recordClientSignOff(p, { signedOffBy: params.signedOffBy }),
        ),
      onCloseProject: (projectId: string) =>
        runInstallationCloseout(projectId, { action: 'close' }, (p) => closeProjectCloseout(p, {})),
    }),
    [runInstallationJobAction, runInstallationCloseout],
  );

  return {
    handleFloorAdvance,
    handleAdvancePart,
    handleAdvanceUnit,
    handleGeneratePartExecutions,
    installationJobHandlers,
  };
}
