/**
 * Real-time active operator jobs list for ProductionManagerDashboard.
 */

import type { ReactNode } from 'react';
import { Clock, Settings, Users } from 'lucide-react';
import type { ActiveJob } from './useProductionDashboardState';

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}min`;
}

export function ActiveJobRow({ job }: { readonly job: ActiveJob }): ReactNode {
  return (
    <div
      className="pm-dashboard__job-row"
      data-testid={`pm-active-job-${job.activityId}`}
    >
      <div className="pm-dashboard__job-info">
        <span className="pm-dashboard__job-operator">
          <Users size={14} strokeWidth={1.5} aria-hidden />
          {job.operatorName}
        </span>
        <span className="pm-dashboard__job-project">{job.projectName}</span>
        <span className="pm-dashboard__job-module">{job.moduleCode}</span>
        {job.machineName && (
          <span className="pm-dashboard__job-machine">
            <Settings size={12} strokeWidth={1.5} aria-hidden />
            {job.machineName}
          </span>
        )}
      </div>
      <div className="pm-dashboard__job-time">
        <Clock size={14} strokeWidth={1.5} aria-hidden />
        <span>{formatDuration(job.durationMin)}</span>
      </div>
    </div>
  );
}

export interface ProductionManagerActiveJobsProps {
  readonly jobs: readonly ActiveJob[];
}

export function ProductionManagerActiveJobs({
  jobs,
}: ProductionManagerActiveJobsProps): ReactNode {
  if (jobs.length === 0) return null;

  return (
    <div className="pm-dashboard__jobs">
      <h3 className="pm-dashboard__section-title">Trabajos Activos</h3>
      <div className="pm-dashboard__job-list">
        {jobs.map((job) => (
          <ActiveJobRow key={job.activityId} job={job} />
        ))}
      </div>
    </div>
  );
}
