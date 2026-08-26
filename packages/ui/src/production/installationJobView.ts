/**
 * Pure derived view of a project's installation job for the Instalaciones
 * board (OC-070..OC-074). UI never computes domain state — it reads this.
 */

import {
  INSTALLATION_JOB_STATUS_LABELS_ES,
  blockingPunchItems,
  deriveInstallationJobStatus,
  evaluateCloseoutGates,
  installationUnitsSummary,
  isEventRecorded,
  isInstallationCloseoutSigned,
  isInstallationClosed,
  openFieldIssues,
  openInstallationVisits,
  openPunchItems,
  type CloseoutCheck,
  type InstallationJobStatus,
  type InstallationUnitsSummary,
  type Project,
} from '@granete/domain';

export type InstallationJobCardView = {
  readonly jobStatus: InstallationJobStatus;
  readonly jobStatusLabel: string;
  readonly hasJob: boolean;
  readonly units: InstallationUnitsSummary;
  readonly unitsReady: boolean;
  readonly closeoutChecks: readonly CloseoutCheck[];
  readonly closeoutReady: boolean;
  readonly closeoutSigned: boolean;
  readonly closed: boolean;
  readonly installationCompleted: boolean;
  readonly openVisitCount: number;
  readonly openIssueCount: number;
  readonly openPunchCount: number;
  readonly blockingPunchCount: number;
};

export function installationJobCardView(project: Project): InstallationJobCardView {
  const job = project.installation;
  const jobStatus = deriveInstallationJobStatus(project);
  const checks = evaluateCloseoutGates(project);
  const units = installationUnitsSummary(project);
  return {
    jobStatus,
    jobStatusLabel: INSTALLATION_JOB_STATUS_LABELS_ES[jobStatus],
    hasJob: Boolean(job),
    units,
    unitsReady: units.total > 0 && units.installed === units.total,
    closeoutChecks: checks,
    closeoutReady: checks.every((c) => c.passed),
    closeoutSigned: isInstallationCloseoutSigned(job),
    closed: isInstallationClosed(job),
    installationCompleted: isEventRecorded(project, 'installation_completed'),
    openVisitCount: openInstallationVisits(job).length,
    openIssueCount: openFieldIssues(job).length,
    openPunchCount: openPunchItems(job).length,
    blockingPunchCount: blockingPunchItems(job).length,
  };
}

/** Whether "Completar instalación" is available (plant milestone). */
export function canCompleteInstallationNow(view: InstallationJobCardView): boolean {
  return !view.installationCompleted && view.units.total > 0 && view.unitsReady && view.openVisitCount === 0;
}
