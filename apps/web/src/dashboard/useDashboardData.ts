/**
 * Dashboard home and command palette data for the App shell (OC-090, #54;
 * extracted from AppContent by R5). Workshop analytics, ops exceptions
 * (exception-first, no invented KPIs), dashboard navigation handlers,
 * showcase actions, the Cmd+K recent-items palette and the material cost
 * helper. The body moved verbatim from AppContent — the caller passes only
 * session identity/roles and the portfolio-dashboard gate; the stores
 * (project, catalog, UI) and the router are read by the hook itself.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  computeWorkshopAnalytics,
  deriveOpsExceptions,
  calcMaterialCostPerM2,
  type AnalyticsPeriodDays,
  type WarrantyTicket,
} from '@granete/domain';
import {
  resolveCustomerName,
  selectRecentProjects,
  type CommandPaletteItem,
} from '@granete/ui';
import type { SessionMode } from '../session';
import { pathForNav, projectPath, entityPath } from '../routes';
import {
  useCatalogStore,
  useProjectStore,
  useUiStore,
  useWorkspaceStore,
} from '../stores';

export function useDashboardData({
  session,
  actorRoles,
  canViewPortfolioDashboard,
}: {
  readonly session: SessionMode;
  readonly actorRoles: readonly string[];
  readonly canViewPortfolioDashboard: boolean;
}) {
  const navigate = useNavigate();
  const projectActions = useProjectStore();
  const getRepository = useWorkspaceStore((s) => s.getRepository);
  const projects = useProjectStore((s) => s.projects);
  const catalog = useCatalogStore((s) => s.catalog);
  const toast = useUiStore((s) => s.toast);
  const bumpProjectsCreateKey = useUiStore((s) => s.bumpProjectsCreateKey);
  const bumpModulesCreateKey = useUiStore((s) => s.bumpModulesCreateKey);
  const bumpMaterialsCreateKey = useUiStore((s) => s.bumpMaterialsCreateKey);
  const optionGroups = catalog?.optionGroups ?? [];
  const modules = catalog?.modules ?? [];
  const customers = catalog?.customers ?? [];

  const [analyticsPeriod, setAnalyticsPeriod] =
    useState<AnalyticsPeriodDays>('all');
  const [warrantyTickets, setWarrantyTickets] = useState<
    readonly WarrantyTicket[] | null
  >(null);
  useEffect(() => {
    if (!canViewPortfolioDashboard) return;
    let cancelled = false;
    const repo = getRepository();
    if (!repo?.getWarrantyTickets) {
      setWarrantyTickets([]);
      return;
    }
    repo
      .getWarrantyTickets()
      .then((tickets) => {
        if (!cancelled) setWarrantyTickets(tickets);
      })
      .catch(() => {
        if (!cancelled) setWarrantyTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canViewPortfolioDashboard, getRepository]);

  const workshopAnalytics = useMemo(() => {
    if (!canViewPortfolioDashboard) return undefined;
    return computeWorkshopAnalytics(projects, warrantyTickets ?? [], {
      period: analyticsPeriod,
    });
  }, [canViewPortfolioDashboard, projects, warrantyTickets, analyticsPeriod]);

  // OC-090 — exception-first list for the owner/manager home. Derived from
  // real project state; shortage/WIP/material inputs arrive from the shell
  // derivations when available (no invented KPIs).
  const opsExceptions = useMemo(() => {
    if (!canViewPortfolioDashboard) return [];
    return deriveOpsExceptions(projects);
  }, [canViewPortfolioDashboard, projects]);

  const onDashboardOpenProject = useCallback(
    (projectId: string) => {
      navigate(projectPath(projectId));
    },
    [navigate],
  );

  const onDashboardNewProject = useCallback(() => {
    bumpProjectsCreateKey();
    navigate(pathForNav('quotes'));
  }, [navigate]);

  const onDashboardNewModule = useCallback(() => {
    bumpModulesCreateKey();
    navigate(pathForNav('modules'));
  }, [navigate]);

  const onDashboardNewMaterial = useCallback(() => {
    bumpMaterialsCreateKey();
    navigate(pathForNav('materials'));
  }, [navigate]);

  const onDashboardOpenShowcase = useCallback(() => {
    navigate(pathForNav('showcase'));
  }, [navigate]);

  const onDashboardOpenMaterials = useCallback(() => {
    navigate(pathForNav('materials'));
  }, [navigate]);

  const onDashboardOpenModules = useCallback(() => {
    navigate(pathForNav('modules'));
  }, [navigate]);

  const onShowcaseUseInQuote = useCallback(
    (moduleId: string) => {
      const mod = modules.find((m) => m.id === moduleId);
      bumpProjectsCreateKey();
      // #1142 P2: el handoff sobrevive al toast — estado en sessionStorage
      // que la lista de Cotizaciones muestra hasta que el usuario lo resuelve.
      if (mod) {
        try {
          sessionStorage.setItem(
            'quotes_reference_handoff',
            JSON.stringify({ kind: 'module', code: mod.code, name: mod.name }),
          );
        } catch {
          // storage no disponible: queda el toast como única señal.
        }
      }
      navigate(pathForNav('quotes'));
      toast({
        type: 'info',
        message: mod
          ? `Nueva cotización: agregá «${mod.name}» (${mod.code}) con Agregar mueble.`
          : 'Nueva cotización: agregá el mueble desde Agregar mueble.',
      });
    },
    [modules, navigate, toast],
  );

  const onShowcaseUseProjectAsReference = useCallback(
    (projectId: string) => {
      const proj = projects.find((p) => p.id === projectId);
      bumpProjectsCreateKey();
      if (proj) {
        try {
          sessionStorage.setItem(
            'quotes_reference_handoff',
            JSON.stringify({ kind: 'project', name: proj.name }),
          );
        } catch {
          // storage no disponible: queda el toast como única señal.
        }
      }
      navigate(pathForNav('quotes'));
      toast({
        type: 'info',
        message: proj
          ? `Nueva cotización inspirada en «${proj.name}».`
          : 'Nueva cotización iniciada desde el portafolio.',
      });
    },
    [projects, navigate, toast],
  );


  const dashboardHomeMode = useMemo(():
    | 'default'
    | 'sales'
    | 'engineering' => {
    if (session !== 'auth' || actorRoles.length === 0) return 'default';
    if (actorRoles.includes('vendedor')) return 'sales';
    if (actorRoles.includes('ingeniero')) return 'engineering';
    return 'default';
  }, [session, actorRoles]);

  const modulesWithoutPhotoCount = useMemo(
    () => modules.filter((m) => !m.imageUrl).length,
    [modules],
  );

  /** Recent entities for Cmd+K palette (issue #54). */
  const commandItems = useMemo((): CommandPaletteItem[] => {
    const projectItems: CommandPaletteItem[] = selectRecentProjects(
      projects,
      12,
    ).map((p) => ({
      id: `project:${p.id}`,
      label: p.name,
      group: 'Cotizaciones',
      keywords: resolveCustomerName(p.customerId, customers),
    }));
    const moduleItems: CommandPaletteItem[] = [...modules]
      .slice(0, 12)
      .map((m) => ({
        id: `module:${m.id}`,
        label: `${m.code} — ${m.name}`,
        group: 'Muebles',
        keywords: m.code,
      }));
    return [...projectItems, ...moduleItems];
  }, [projects, modules, customers]);

  const onCommandItem = useCallback(
    (id: string) => {
      if (id.startsWith('project:')) {
        navigate(projectPath(id.slice('project:'.length)));
        return;
      }
      if (id.startsWith('module:')) {
        navigate(entityPath('modules', id.slice('module:'.length)));
      }
    },
    [navigate],
  );

  const groupLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of optionGroups) {
      map[g.code] = `${g.name} (${g.code})`;
    }
    return map;
  }, [optionGroups]);

  const getMaterialCostPerM2 = useCallback(
    (input: {
      widthMm: number;
      lengthMm: number;
      boardPrice: number;
      wastePercent: number;
    }) =>
      calcMaterialCostPerM2(
        input.widthMm,
        input.lengthMm,
        input.boardPrice,
        input.wastePercent,
      ),
    [],
  );

  return {
    analyticsPeriod,
    setAnalyticsPeriod,
    warrantyTickets,
    workshopAnalytics,
    opsExceptions,
    onDashboardOpenProject,
    onDashboardNewProject,
    onDashboardNewModule,
    onDashboardNewMaterial,
    onDashboardOpenShowcase,
    onDashboardOpenMaterials,
    onDashboardOpenModules,
    onShowcaseUseInQuote,
    onShowcaseUseProjectAsReference,
    dashboardHomeMode,
    modulesWithoutPhotoCount,
    commandItems,
    onCommandItem,
    groupLabels,
    getMaterialCostPerM2,
  };
}
