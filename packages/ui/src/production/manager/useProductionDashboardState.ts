/**
 * Hook and types for ProductionManagerDashboard state and backend integration.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  PIPELINE_SECTORS,
  PRODUCTION_SECTOR_LABELS_ES,
} from '@muebles/domain';

export type ActiveJob = {
  readonly activityId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly itemId?: string;
  readonly moduleCode?: string;
  readonly operatorId: string;
  readonly operatorName: string;
  readonly machineId?: string;
  readonly machineName?: string;
  readonly startedAt: string;
  readonly durationMin: number;
};

export type SectorDashboard = {
  readonly sector: string;
  readonly label: string;
  readonly activeOperators: number;
  readonly queueLength: number;
  readonly itemsInProgress: number;
  readonly itemsCompletedToday: number;
  readonly avgTimeMinutes: number;
  readonly activeJobs: readonly ActiveJob[];
};

export type DashboardMetrics = {
  readonly totalProjects: number;
  readonly totalItems: number;
  readonly totalInstalled: number;
  readonly avgProgress: number;
  readonly todayCompleted: number;
  readonly todayDamages: number;
  readonly sectors: readonly SectorDashboard[];
};

export interface ProductionManagerRepo {
  getProductionDashboard?: () => Promise<DashboardMetrics>;
  getProductionActiveJobs?: () => Promise<readonly ActiveJob[]>;
}

export function useProductionDashboard(repo?: ProductionManagerRepo) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [activeJobs, setActiveJobs] = useState<readonly ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (repo?.getProductionDashboard && repo?.getProductionActiveJobs) {
        const [dashResult, jobsResult] = await Promise.all([
          repo.getProductionDashboard(),
          repo.getProductionActiveJobs(),
        ]);
        setMetrics(dashResult);
        setActiveJobs(jobsResult);
      } else {
        setMetrics({
          totalProjects: 0,
          totalItems: 0,
          totalInstalled: 0,
          avgProgress: 0,
          todayCompleted: 0,
          todayDamages: 0,
          sectors: PIPELINE_SECTORS.map((sector) => ({
            sector,
            label: PRODUCTION_SECTOR_LABELS_ES[sector],
            activeOperators: 0,
            queueLength: 0,
            itemsInProgress: 0,
            itemsCompletedToday: 0,
            avgTimeMinutes: 0,
            activeJobs: [],
          })),
        });
        setActiveJobs([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [repo]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return { metrics, activeJobs, loading, error, refresh: fetchDashboard };
}
