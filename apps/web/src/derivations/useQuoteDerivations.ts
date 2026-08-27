/**
 * useQuoteDerivations — quote/estimate derivations for the shell (F120
 * extract from App.tsx): workshop settings + cost visibility, module preview
 * & card estimates, selected-project quote, material summary, project card
 * estimates, and the dashboard stats/recent/portfolio derivations.
 */

import { useMemo } from 'react';

import type {
  Catalog,
  Customer,
  MaterialBoard,
  Module,
  Project,
  ProjectMaterialSummary,
  QuoteBreakdown,
  WorkshopSettings,
} from '@granete/domain';
import {
  generateProjectMaterialSummary,
  resolveWorkshopSettings,
  roleLabelEs,
  rolesCanViewCosts,
} from '@granete/domain';
import { computeModuleCostPreview, computeSelectedProjectBreakdown } from './breakdown';
import {
  aggregatePortfolioByOwner,
  countActiveMaterials,
  countActiveProjects,
  countModules,
  resolveCustomerName,
  selectRecentProjects,
  sumMonthlyQuotedTotal,
} from '@granete/ui';
import type { SessionMode } from '../session';

export interface QuoteDerivationsDeps {
  readonly workspaceSettings: WorkshopSettings | undefined;
  readonly session: SessionMode;
  readonly actorRoles: readonly string[] | null | undefined;
  readonly catalog: Catalog | null;
  readonly modules: readonly Module[];
  readonly materials: readonly MaterialBoard[];
  readonly customers: readonly Customer[];
  readonly projects: readonly Project[];
  readonly selectedProject: Project | undefined | null;
  readonly editingModuleId: string | null;
  readonly canViewPortfolioDashboard: boolean;
  readonly assignableOwners: readonly { id: string; name: string; role?: string }[];
}

export function useQuoteDerivations(deps: QuoteDerivationsDeps) {
  const {
    workspaceSettings,
    session,
    actorRoles,
    catalog,
    modules,
    materials,
    customers,
    projects,
    selectedProject,
    editingModuleId,
    canViewPortfolioDashboard,
    assignableOwners,
  } = deps;

  const workshopSettings = resolveWorkshopSettings(workspaceSettings);
  /** Guest/local: full costs; auth uses COST-01 + COST-02 flag (F039/F044). */
  const showCosts =
    session === 'guest' ||
    rolesCanViewCosts(actorRoles ?? [], {
      vendedorCanViewCosts: workshopSettings.vendedorCanViewCosts,
    });

  const modulePreview = useMemo(() => {
    if (!editingModuleId || !catalog) {
      return {
        costPreview: null as QuoteBreakdown | null,
        previewBlocked: false,
        missingGroups: [] as readonly string[],
        previewError: null as string | null,
      };
    }
    const mod = modules.find((m) => m.id === editingModuleId);
    if (!mod) {
      return {
        costPreview: null,
        previewBlocked: true,
        missingGroups: [] as readonly string[],
        previewError: null as string | null,
      };
    }
    return computeModuleCostPreview(mod, catalog);
  }, [editingModuleId, modules, catalog]);

  /** Sale-price estimates for module cards — domain only in the shell (F021). */
  const moduleEstimates = useMemo(() => {
    const map: Record<string, number | null> = {};
    if (!catalog) return map;
    for (const mod of modules) {
      const preview = computeModuleCostPreview(mod, catalog);
      map[mod.id] = preview.costPreview?.salePrice ?? null;
    }
    return map;
  }, [modules, catalog]);

  const projectQuote = useMemo(
    () =>
      catalog
        ? computeSelectedProjectBreakdown(selectedProject ?? undefined, catalog)
        : {
            breakdown: null as QuoteBreakdown | null,
            previewBlocked: false,
            missingGroups: [] as readonly string[],
            breakdownError: null as string | null,
          },
    [selectedProject, catalog],
  );

  /** F047: m² / herrajes summary — same gate as price preview. */
  const materialSummary = useMemo((): ProjectMaterialSummary | null => {
    if (!catalog || !selectedProject) return null;
    if (projectQuote.previewBlocked || !projectQuote.breakdown) return null;
    try {
      return generateProjectMaterialSummary(selectedProject ?? undefined, catalog);
    } catch {
      return null;
    }
  }, [catalog, selectedProject, projectQuote.previewBlocked, projectQuote.breakdown]);

  /** Sale-price estimates for project cards — domain only in the shell (F022). */
  const projectEstimates = useMemo(() => {
    const map: Record<string, number | null> = {};
    if (!catalog) return map;
    for (const project of projects) {
      if (project.priceSnapshot) {
        map[project.id] = project.priceSnapshot.breakdown.salePrice;
        continue;
      }
      const quote = computeSelectedProjectBreakdown(project, catalog);
      map[project.id] = quote.breakdown?.salePrice ?? null;
    }
    return map;
  }, [projects, catalog]);


  /**
   * Dashboard stats + recent list (F023).
   * monthlyQuotedTotal: sum of sale prices for quoted/accepted projects whose
   * updatedAt falls in the current calendar month (uses projectEstimates /
   * priceSnapshot — domain engine only in shell).
   */
  const dashboardStats = useMemo(
    () => ({
      activeProjects: countActiveProjects(projects),
      monthlyQuotedTotal: sumMonthlyQuotedTotal(projects, projectEstimates),
      modulesCount: countModules(modules),
      activeMaterials: countActiveMaterials(materials),
    }),
    [projects, projectEstimates, modules, materials],
  );

  const dashboardRecent = useMemo(() => {
    return selectRecentProjects(projects, 5).map((project) => ({
      id: project.id,
      name: project.name,
      customerLabel: resolveCustomerName(project.customerId, customers),
      status: project.status,
      updatedAt: project.updatedAt,
      salePrice: projectEstimates[project.id] ?? null,
    }));
  }, [projects, customers, projectEstimates]);

  /** F037: multi-owner portfolio table for gerente/admin only. */
  const dashboardOwnerBreakdown = useMemo(() => {
    if (!canViewPortfolioDashboard) return undefined;
    return aggregatePortfolioByOwner(
      projects,
      projectEstimates,
      assignableOwners,
      (role) => roleLabelEs(role),
    );
  }, [
    canViewPortfolioDashboard,
    projects,
    projectEstimates,
    assignableOwners,
  ]);


  return {
    workshopSettings,
    showCosts,
    modulePreview,
    moduleEstimates,
    projectQuote,
    materialSummary,
    projectEstimates,
    dashboardStats,
    dashboardRecent,
    dashboardOwnerBreakdown,
  };
}
