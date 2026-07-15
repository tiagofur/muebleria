/**
 * Dashboard / home UI surface (F023).
 */

export {
  Dashboard,
  type DashboardProps,
  type DashboardRecentProject,
  type DashboardStats,
} from './Dashboard';

export {
  countActiveMaterials,
  countActiveProjects,
  countModules,
  formatDashboardMoney,
  selectRecentProjects,
  sumMonthlyQuotedTotal,
  yearMonthKey,
  type ActiveFlag,
  type ProjectLike,
} from './dashboardHelpers';
