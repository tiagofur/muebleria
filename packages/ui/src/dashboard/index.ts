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
  aggregatePortfolioByOwner,
  countActiveMaterials,
  countActiveProjects,
  countModules,
  formatDashboardMoney,
  selectRecentProjects,
  shouldShowGettingStarted,
  sumMonthlyQuotedTotal,
  yearMonthKey,
  type ActiveFlag,
  type OwnerDirectoryEntry,
  type OwnerPortfolioRow,
  type ProjectLike,
} from './dashboardHelpers';
