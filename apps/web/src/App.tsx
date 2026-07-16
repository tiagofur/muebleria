/**
 * Thin web shell — holds catalog state; presentation lives in @muebles/ui.
 * Price formulas call @muebles/domain only here (not in UI package).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  Catalog,
  Customer,
  EdgeBand,
  ExportIssue,
  Hardware,
  MaterialBoard,
  Module,
  ModuleCategory,
  OptionChoices,
  OptionGroup,
  Project,
  ProjectItem,
  QuoteBreakdown,
  WorkshopSettings,
  Workspace,
} from '@muebles/domain';
import {
  calcMaterialCostPerM2,
  calcProjectBreakdown,
  duplicateModule as deepCopyModule,
  duplicateProject as deepCopyProject,
  resolveWorkshopSettings,
  suggestDuplicateCode,
  transitionProjectStatus,
} from '@muebles/domain';
import {
  AppShell,
  EdgesCatalog,
  HardwareCatalog,
  MaterialsCatalog,
  ModulesScreen,
  OptionGroupsScreen,
  ProjectsScreen,
  Dashboard,
  LoginScreen,
  RegisterScreen,
  SettingsScreen,
  UsersScreen,
  ToastProvider,
  canShowPricePreview,
  canShowProjectPricePreview,
  countActiveMaterials,
  countActiveProjects,
  countModules,
  defaultOptionChoicesForModule,
  edgesFromFlags,
  parseOptionalNumber,
  requiredGroupCodesForModule,
  resolveCustomerName,
  selectRecentProjects,
  sumMonthlyQuotedTotal,
  useToast,
  type AppNavId,
  type EdgeDraft,
  type HardwareDraft,
  type MaterialDraft,
  type ModuleDraft,
  type CategoryDraft,
  type OptionGroupDraft,
  type ProjectDraft,
  CustomersScreen,
  type CustomerDraft,
  PageLoading,
  type CommandPaletteItem,
} from '@muebles/ui';
import {
  APIWorkspaceRepository,
  LocalStorageWorkspaceRepository,
  breakdownFromApi,
  createSeedWorkspace,
} from '@muebles/storage';
import {
  buildCommercialQuoteExport,
  downloadCommercialQuoteXlsx,
} from './exportCommercialQuote';
import {
  buildHardwareListExport,
  downloadHardwareListXlsx,
} from './exportHardwareList';
import {
  buildOptimizerExport,
  downloadOptimizerXlsx,
} from './exportOptimizer';
import {
  entityIdFromPath,
  entityPath,
  isEntitySection,
  navFromPath,
  pathForNav,
  projectPath,
  type EntitySection,
} from './routes';
import {
  clearSession,
  DEFAULT_API_BASE,
  isAdminRole,
  loginRequest,
  readAuthToken,
  readAuthUser,
  readSessionMode,
  registerRequest,
  storeAuthToken,
  storeAuthUser,
  writeSessionMode,
  type SessionMode,
} from './session';


function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function optionalNotes(notes: string): string | undefined {
  const trimmed = notes.trim();
  return trimmed ? trimmed : undefined;
}

function draftToModule(id: string, draft: ModuleDraft): Module {
  const width = parseOptionalNumber(draft.externalWidth);
  const height = parseOptionalNumber(draft.externalHeight);
  const depth = parseOptionalNumber(draft.externalDepth);
  const hasDims =
    width !== undefined || height !== undefined || depth !== undefined;

  return {
    id,
    code: draft.code.trim(),
    name: draft.name.trim(),
    notes: optionalNotes(draft.notes),
    categoryId: draft.categoryId.trim() || undefined,
    baseLaborCost: parseOptionalNumber(draft.baseLaborCost),
    externalDims: hasDims
      ? {
          width: width ?? 0,
          height: height ?? 0,
          depth: depth ?? 0,
        }
      : undefined,
    boardParts: draft.boardParts.map((p) => ({
      id: p.id,
      code: p.code.trim() || undefined,
      description: p.description.trim(),
      quantity: p.quantity,
      lengthMm: p.lengthMm,
      widthMm: p.widthMm,
      edges: edgesFromFlags(p.edgeL1, p.edgeL2, p.edgeW1, p.edgeW2),
      optionRole: p.optionRole.trim(),
    })),
    hardwareLines: draft.hardwareLines.map((l) => ({
      id: l.id,
      quantity: l.quantity,
      descriptionOverride: optionalNotes(l.descriptionOverride),
      optionRole:
        l.mode === 'fixed'
          ? l.optionRole.trim() || 'FIXED'
          : l.optionRole.trim(),
      hardwareId:
        l.mode === 'fixed' && l.hardwareId.trim()
          ? l.hardwareId.trim()
          : undefined,
    })),
  };
}

/**
 * MOD-06: domain cost preview for a single saved module using default option choices.
 * Pure wiring in the shell — UI only receives QuoteBreakdown props.
 */
function computeModuleCostPreview(
  module: Module,
  catalog: Workspace['catalog'],
): {
  costPreview: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
} {
  const required = requiredGroupCodesForModule(module, catalog.optionGroups);
  const choices = defaultOptionChoicesForModule(
    module,
    catalog.optionGroups,
  ) as OptionChoices;
  const gate = canShowPricePreview(required, choices);
  if (!gate.ok) {
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
    };
  }

  const now = new Date().toISOString();
  const project: Project = {
    id: 'module-preview-project',
    name: 'Preview módulo',
    customerId: 'Preview',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'module-preview-item',
        moduleId: module.id,
        quantity: 1,
        optionChoices: choices,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  try {
    const costPreview = calcProjectBreakdown(project, catalog);
    return { costPreview, previewBlocked: false, missingGroups: [] };
  } catch {
    return {
      costPreview: null,
      previewBlocked: true,
      missingGroups: required,
    };
  }
}

/**
 * Prefer an existing catalog customer id from the draft. Only create when the
 * "Nuevo cliente" path sends a name without a selected id.
 * Stores Project.customerId, never free-text on Project.
 */
function resolveCustomerFromDraft(
  draft: ProjectDraft,
  customers: readonly Customer[],
): { customerId: string; customers: Customer[] } {
  const selectedId = draft.customerId.trim();
  if (selectedId) {
    // Keep id as-is (including orphan ids not in catalog) — never invent.
    return { customerId: selectedId, customers: [...customers] };
  }

  const trimmed = (draft.customerName ?? '').trim();
  if (!trimmed) {
    // Validation should prevent this; keep a stable empty path.
    return { customerId: '', customers: [...customers] };
  }

  const key = trimmed.toLocaleLowerCase('es-UY');
  const existing = customers.find(
    (c) => c.name.trim().toLocaleLowerCase('es-UY') === key,
  );
  if (existing) {
    return { customerId: existing.id, customers: [...customers] };
  }
  const created: Customer = {
    id: newId(),
    name: trimmed,
    active: true,
  };
  return { customerId: created.id, customers: [...customers, created] };
}

function draftToProjectMeta(
  draft: ProjectDraft,
  customerId: string,
): Pick<
  Project,
  | 'name'
  | 'customerId'
  | 'currency'
  | 'marginFactor'
  | 'laborFixedCost'
  | 'status'
  | 'notes'
> {
  return {
    name: draft.name.trim(),
    customerId,
    currency: draft.currency.trim(),
    marginFactor: Number(draft.marginFactor),
    laborFixedCost: Number(draft.laborFixedCost),
    status: draft.status,
    notes: optionalNotes(draft.notes),
  };
}

/**
 * PRJ-06 / UX-03: domain breakdown for the selected project when option gate is open.
 */
function computeSelectedProjectBreakdown(
  project: Project | undefined,
  catalog: Workspace['catalog'],
): {
  breakdown: QuoteBreakdown | null;
  previewBlocked: boolean;
  missingGroups: readonly string[];
} {
  if (!project) {
    return { breakdown: null, previewBlocked: false, missingGroups: [] };
  }
  if (project.items.length === 0) {
    return { breakdown: null, previewBlocked: false, missingGroups: [] };
  }

  const gate = canShowProjectPricePreview(
    project,
    catalog.modules,
    catalog.optionGroups,
  );
  if (!gate.ok) {
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: gate.missingGroups,
    };
  }

  try {
    const breakdown = calcProjectBreakdown(project, catalog);
    return { breakdown, previewBlocked: false, missingGroups: [] };
  } catch {
    return {
      breakdown: null,
      previewBlocked: true,
      missingGroups: [],
    };
  }
}

/** Thin web shell — wiring only; cost formulas only via domain engine. */
export function App(): ReactNode {
  return (
    <ToastProvider>
      <SessionGate />
    </ToastProvider>
  );
}

/**
 * Login gate: session null → LoginScreen | RegisterScreen;
 * guest|auth → workspace app. Separated from AppContent so hooks always run.
 */
function SessionGate(): ReactNode {
  const [session, setSession] = useState<SessionMode | null>(() =>
    readSessionMode(),
  );
  const [authGate, setAuthGate] = useState<'login' | 'register'>('login');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  const handleGuestAccess = useCallback(() => {
    writeSessionMode('guest');
    setLoginError(null);
    setRegisterError(null);
    setSession('guest');
  }, []);

  const handleLogin = useCallback(async (email: string, password: string) => {
    setLoginLoading(true);
    setLoginError(null);
    try {
      const { token, user } = await loginRequest(email, password);
      storeAuthToken(token);
      storeAuthUser(user);
      writeSessionMode('auth');
      setSession('auth');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'No se pudo iniciar sesión';
      setLoginError(message);
    } finally {
      setLoginLoading(false);
    }
  }, []);

  const handleRegister = useCallback(
    async (name: string, email: string, password: string) => {
      setRegisterLoading(true);
      setRegisterError(null);
      try {
        await registerRequest(name, email, password);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'No se pudo registrar';
        setRegisterError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setRegisterLoading(false);
      }
    },
    [],
  );

  const handleLogout = useCallback(() => {
    clearSession();
    setLoginError(null);
    setRegisterError(null);
    setAuthGate('login');
    setSession(null);
  }, []);

  if (session === null) {
    if (authGate === 'register') {
      return (
        <RegisterScreen
          onRegister={handleRegister}
          onBack={() => {
            setAuthGate('login');
            setRegisterError(null);
          }}
          loading={registerLoading}
          error={registerError}
        />
      );
    }
    return (
      <LoginScreen
        onLogin={handleLogin}
        onGuestAccess={handleGuestAccess}
        onRegister={() => {
          setLoginError(null);
          setAuthGate('register');
        }}
        loading={loginLoading}
        error={loginError}
      />
    );
  }

  return <AppContent session={session} onLogout={handleLogout} />;
}

function AppContent({
  session,
  onLogout,
}: {
  readonly session: SessionMode;
  readonly onLogout: () => void;
}): ReactNode {
  const { toast } = useToast();
  const authUser = useMemo(
    () => (session === 'auth' ? readAuthUser() : null),
    [session],
  );
  const authToken = useMemo(
    () => (session === 'auth' ? readAuthToken() : null),
    [session],
  );
  const showAdminUsers = session === 'auth' && isAdminRole(authUser?.role);

  const repository = useMemo(() => {
    return session === 'auth'
      ? new APIWorkspaceRepository(DEFAULT_API_BASE)
      : new LocalStorageWorkspaceRepository();
  }, [session]);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setWorkspace(null);
    setWorkspaceLoadError(null);
    repository
      .load()
      .then((ws) => {
        setWorkspace(ws);
      })
      .catch((err) => {
        // Do not silently seed — surface failure and offer explicit recover (#13).
        console.error('Failed to load workspace:', err);
        setWorkspaceLoadError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el espacio de trabajo',
        );
      });
  }, [repository]);

  const location = useLocation();
  const navigate = useNavigate();
  const navId: AppNavId = navFromPath(location.pathname) ?? 'home';
  const routeEntityId =
    isEntitySection(navId)
      ? entityIdFromPath(location.pathname, navId)
      : null;
  const routeProjectId =
    navId === 'projects' ? routeEntityId : null;
  const routeModuleId = navId === 'modules' ? routeEntityId : null;

  // Keep the address bar on a known section path (bookmarkable SPA routes).
  useEffect(() => {
    const resolved = navFromPath(location.pathname);
    if (resolved === null) {
      navigate(pathForNav('home'), { replace: true });
      return;
    }
    if (resolved === 'users' && !showAdminUsers) {
      navigate(pathForNav('home'), { replace: true });
    }
  }, [location.pathname, navigate, showAdminUsers]);

  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  // Calculate / export target follows URL detail when present.
  const selectedProjectId = routeProjectId;
  const [exportErrors, setExportErrors] = useState<readonly ExportIssue[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [projectsCreateKey, setProjectsCreateKey] = useState(0);
  const [modulesCreateKey, setModulesCreateKey] = useState(0);
  const [materialsCreateKey, setMaterialsCreateKey] = useState(0);

  const [backendBreakdown, setBackendBreakdown] =
    useState<QuoteBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  const selectedProject = useMemo(() => {
    if (!workspace?.projects) return undefined;
    return workspace.projects.find((p) => p.id === selectedProjectId);
  }, [workspace, selectedProjectId]);

  useEffect(() => {
    if (session !== 'auth' || !selectedProjectId || !selectedProject) {
      setBackendBreakdown(null);
      setBreakdownError(null);
      setBreakdownLoading(false);
      return;
    }

    let active = true;
    setBreakdownLoading(true);
    setBreakdownError(null);

    const fetchBreakdown = async () => {
      try {
        const token = readAuthToken();
        const res = await fetch(
          `${DEFAULT_API_BASE}/projects/${selectedProjectId}/calculate`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );
        if (!res.ok) {
          throw new Error(`No se pudo recalcular (${res.status})`);
        }
        const data = breakdownFromApi((await res.json()) as Record<string, unknown>);
        if (active) {
          setBackendBreakdown(data);
          setBreakdownError(null);
        }
      } catch (err) {
        console.error('Backend calculation error:', err);
        if (active) {
          // Fall back to local domain breakdown; surface error in panel + toast.
          setBackendBreakdown(null);
          const message =
            'No se pudo recalcular en el servidor; mostrando valores locales';
          setBreakdownError(message);
          toast({ type: 'error', message });
        }
      } finally {
        if (active) {
          setBreakdownLoading(false);
        }
      }
    };

    const timeoutId = setTimeout(() => {
      void fetchBreakdown();
    }, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [selectedProjectId, selectedProject, session, toast]);

  // Derive catalog slices safely so hooks below always run (Rules of Hooks).
  // Early return for loading MUST stay after every useCallback/useMemo.
  const catalog = workspace?.catalog;
  const materials = catalog?.materials ?? [];
  const edges = catalog?.edges ?? [];
  const hardware = catalog?.hardware ?? [];
  const optionGroups = catalog?.optionGroups ?? [];
  const modules = catalog?.modules ?? [];
  const categories = catalog?.categories ?? [];
  const customers = catalog?.customers ?? [];
  const projects = workspace?.projects ?? [];
  const workshopSettings = resolveWorkshopSettings(workspace?.settings);

  // Latest workspace for patches — avoids stale closures (#15).
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  /**
   * Catalog updater (reducer style). Computes next from ref, then setState +
   * save outside any React updater (StrictMode-safe, no double POST).
   */
  const patchCatalog = useCallback(
    (updater: (catalog: Catalog) => Catalog) => {
      const prev = workspaceRef.current;
      if (!prev) return;
      const nextCatalog = updater(prev.catalog);
      const next: Workspace = { ...prev, catalog: nextCatalog };
      workspaceRef.current = next;
      setWorkspace(next);
      repository.saveCatalog(nextCatalog).catch((err) => {
        console.error('Error al guardar catálogo:', err);
        toast({
          type: 'error',
          message: 'Error de conexión al sincronizar cambios',
        });
      });
    },
    [repository, toast],
  );

  /**
   * Projects updater (reducer style). Saves only projects whose reference
   * changed vs previous list (#15).
   */
  const patchProjects = useCallback(
    (updater: (projects: readonly Project[]) => readonly Project[]) => {
      const prev = workspaceRef.current;
      if (!prev) return;
      const nextProjects = updater(prev.projects);
      const next: Workspace = { ...prev, projects: nextProjects };
      workspaceRef.current = next;
      setWorkspace(next);
      const prevById = new Map(prev.projects.map((p) => [p.id, p]));
      for (const p of nextProjects) {
        if (prevById.get(p.id) !== p) {
          repository.saveProject(p).catch((err) => {
            console.error('Error al guardar proyecto:', err);
          });
        }
      }
    },
    [repository],
  );

  const modulePreview = useMemo(() => {
    if (!editingModuleId || !catalog) {
      return {
        costPreview: null as QuoteBreakdown | null,
        previewBlocked: false,
        missingGroups: [] as readonly string[],
      };
    }
    const mod = modules.find((m) => m.id === editingModuleId);
    if (!mod) {
      return {
        costPreview: null,
        previewBlocked: true,
        missingGroups: [] as readonly string[],
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
        ? computeSelectedProjectBreakdown(selectedProject, catalog)
        : {
            breakdown: null as QuoteBreakdown | null,
            previewBlocked: false,
            missingGroups: [] as readonly string[],
          },
    [selectedProject, catalog],
  );

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

  const onDashboardOpenProject = useCallback(
    (projectId: string) => {
      navigate(projectPath(projectId));
    },
    [navigate],
  );

  const onDashboardNewProject = useCallback(() => {
    setProjectsCreateKey((k) => k + 1);
    navigate(pathForNav('projects'));
  }, [navigate]);

  const onDashboardNewModule = useCallback(() => {
    setModulesCreateKey((k) => k + 1);
    navigate(pathForNav('modules'));
  }, [navigate]);

  const onDashboardNewMaterial = useCallback(() => {
    setMaterialsCreateKey((k) => k + 1);
    navigate(pathForNav('materials'));
  }, [navigate]);

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
        navigate(modulePath(id.slice('module:'.length)));
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

  const createMaterial = (draft: MaterialDraft) => {
    const code = draft.code.trim();
    // Domain formula in the shell only (issue #14 — UI must not import calc).
    const costPerM2 = calcMaterialCostPerM2(
      draft.widthMm,
      draft.lengthMm,
      draft.boardPrice,
      draft.wastePercent,
    );
    const item: MaterialBoard = {
      id: newId(),
      code,
      name: draft.name.trim(),
      widthMm: draft.widthMm,
      lengthMm: draft.lengthMm,
      thicknessMm: draft.thicknessMm,
      grainDefault: draft.grainDefault,
      boardPrice: draft.boardPrice,
      costPerM2,
      wastePercent: draft.wastePercent,
      defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
      notes: optionalNotes(draft.notes),
      active: true,
    };
    patchCatalog((c) => ({ ...c, materials: [...c.materials, item] }));
    toast({ type: 'success', message: `✓ "${code}" creado` });
  };

  const updateMaterial = (id: string, draft: MaterialDraft) => {
    const costPerM2 = calcMaterialCostPerM2(
      draft.widthMm,
      draft.lengthMm,
      draft.boardPrice,
      draft.wastePercent,
    );
    patchCatalog((c) => ({
      ...c,
      materials: c.materials.map((m) =>
        m.id === id
          ? {
              ...m,
              code: draft.code.trim(),
              name: draft.name.trim(),
              widthMm: draft.widthMm,
              lengthMm: draft.lengthMm,
              thicknessMm: draft.thicknessMm,
              grainDefault: draft.grainDefault,
              boardPrice: draft.boardPrice,
              costPerM2,
              wastePercent: draft.wastePercent,
              defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
              notes: optionalNotes(draft.notes),
            }
          : m,
      ),
    }));
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setMaterialActive = (id: string, active: boolean) => {
    const target = materials.find((m) => m.id === id);
    patchCatalog((c) => ({
      ...c,
      materials: c.materials.map((m) => (m.id === id ? { ...m, active } : m)),
    }));
    if (target) {
      toast({
        type: 'info',
        message: active
          ? `↑ "${target.name}" reactivado`
          : `↓ "${target.name}" desactivado`,
      });
    }
  };

  const createEdge = (draft: EdgeDraft): string => {
    const code = draft.code.trim();
    const id = newId();
    const item: EdgeBand = {
      id,
      code,
      name: draft.name.trim(),
      thicknessMm: draft.thicknessMm,
      costPerMl: draft.costPerMl,
      notes: optionalNotes(draft.notes),
      active: true,
    };
    patchCatalog((c) => ({ ...c, edges: [...c.edges, item] }));
    toast({ type: 'success', message: `✓ "${code}" creado` });
    return id;
  };

  const updateEdge = (id: string, draft: EdgeDraft) => {
    patchCatalog((c) => ({
      ...c,
      edges: c.edges.map((e) =>
        e.id === id
          ? {
              ...e,
              code: draft.code.trim(),
              name: draft.name.trim(),
              thicknessMm: draft.thicknessMm,
              costPerMl: draft.costPerMl,
              notes: optionalNotes(draft.notes),
            }
          : e,
      ),
    }));
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setEdgeActive = (id: string, active: boolean) => {
    const target = edges.find((e) => e.id === id);
    patchCatalog((c) => ({
      ...c,
      edges: c.edges.map((e) => (e.id === id ? { ...e, active } : e)),
    }));
    if (target) {
      toast({
        type: 'info',
        message: active
          ? `↑ "${target.name}" reactivado`
          : `↓ "${target.name}" desactivado`,
      });
    }
  };

  const createHardware = (draft: HardwareDraft) => {
    const code = draft.code.trim();
    const item: Hardware = {
      id: newId(),
      code,
      name: draft.name.trim(),
      unit: draft.unit,
      costPerUnit: draft.costPerUnit,
      notes: optionalNotes(draft.notes),
      active: true,
    };
    patchCatalog((c) => ({ ...c, hardware: [...c.hardware, item] }));
    toast({ type: 'success', message: `✓ "${code}" creado` });
  };

  const updateHardware = (id: string, draft: HardwareDraft) => {
    patchCatalog((c) => ({
      ...c,
      hardware: c.hardware.map((h) =>
        h.id === id
          ? {
              ...h,
              code: draft.code.trim(),
              name: draft.name.trim(),
              unit: draft.unit,
              costPerUnit: draft.costPerUnit,
              notes: optionalNotes(draft.notes),
            }
          : h,
      ),
    }));
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setHardwareActive = (id: string, active: boolean) => {
    const target = hardware.find((h) => h.id === id);
    patchCatalog((c) => ({
      ...c,
      hardware: c.hardware.map((h) => (h.id === id ? { ...h, active } : h)),
    }));
    if (target) {
      toast({
        type: 'info',
        message: active
          ? `↑ "${target.name}" reactivado`
          : `↓ "${target.name}" desactivado`,
      });
    }
  };

  const createOptionGroup = (draft: OptionGroupDraft) => {
    const code = draft.code.trim();
    const item: OptionGroup = {
      id: newId(),
      code,
      name: draft.name.trim(),
      kind: draft.kind,
      required: draft.required,
      optionIds: [...draft.optionIds],
    };
    patchCatalog((c) => ({ ...c, optionGroups: [...c.optionGroups, item] }));
    toast({ type: 'success', message: `✓ "${code}" creado` });
  };

  const updateOptionGroup = (id: string, draft: OptionGroupDraft) => {
    patchCatalog((c) => ({
      ...c,
      optionGroups: c.optionGroups.map((g) =>
        g.id === id
          ? {
              ...g,
              code: draft.code.trim(),
              name: draft.name.trim(),
              kind: draft.kind,
              required: draft.required,
              optionIds: [...draft.optionIds],
            }
          : g,
      ),
    }));
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const deleteOptionGroup = (id: string) => {
    patchCatalog((c) => ({
      ...c,
      optionGroups: c.optionGroups.filter((g) => g.id !== id),
    }));
    toast({ type: 'info', message: 'Grupo de opciones eliminado' });
  };

  const createCategory = (draft: CategoryDraft) => {
    const item: ModuleCategory = {
      id: newId(),
      name: draft.name.trim(),
      parentId: draft.parentId.trim() || undefined,
      sortOrder: Number(draft.sortOrder) || 0,
    };
    patchCatalog((c) => ({
      ...c,
      categories: [...(c.categories ?? []), item],
    }));
    toast({ type: 'success', message: `✓ Categoría "${item.name}" creada` });
  };

  const updateCategory = (id: string, draft: CategoryDraft) => {
    patchCatalog((cat) => ({
      ...cat,
      categories: (cat.categories ?? []).map((c) =>
        c.id === id
          ? {
              ...c,
              name: draft.name.trim(),
              parentId: draft.parentId.trim() || undefined,
              sortOrder: Number(draft.sortOrder) || 0,
            }
          : c,
      ),
    }));
    toast({ type: 'success', message: '✓ Categoría actualizada' });
  };

  const deleteCategory = (id: string) => {
    const cats = workspaceRef.current?.catalog.categories ?? [];
    const hasChildren = cats.some((c) => c.parentId === id);
    if (hasChildren) {
      toast({
        type: 'warning',
        message: 'No se puede eliminar: tiene subcategorías',
      });
      return;
    }
    patchCatalog((c) => ({
      ...c,
      categories: (c.categories ?? []).filter((cat) => cat.id !== id),
      modules: c.modules.map((m) =>
        m.categoryId === id ? { ...m, categoryId: undefined } : m,
      ),
    }));
    toast({ type: 'info', message: 'Categoría eliminada' });
  };

  const createModule = (draft: ModuleDraft) => {
    const item = draftToModule(newId(), draft);
    patchCatalog((c) => ({ ...c, modules: [...c.modules, item] }));
    toast({ type: 'success', message: `✓ "${item.code}" creado` });
  };

  const updateModule = (id: string, draft: ModuleDraft) => {
    patchCatalog((c) => ({
      ...c,
      modules: c.modules.map((m) => (m.id === id ? draftToModule(id, draft) : m)),
    }));
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const deleteModule = (id: string) => {
    patchCatalog((c) => ({
      ...c,
      modules: c.modules.filter((m) => m.id !== id),
    }));
    if (editingModuleId === id) {
      setEditingModuleId(null);
    }
    toast({ type: 'info', message: 'Módulo eliminado' });
  };

  const duplicateModuleById = (id: string) => {
    const source = modules.find((m) => m.id === id);
    if (!source) return;
    const newCode = suggestDuplicateCode(
      source.code,
      modules.map((m) => m.code),
    );
    const copy = deepCopyModule(source, {
      newId: newId(),
      newCode,
      nextNestedId: newId,
    });
    patchCatalog((c) => ({ ...c, modules: [...c.modules, copy] }));
    toast({ type: 'success', message: `✓ Duplicado como ${newCode}` });
  };

  const createCustomer = (draft: CustomerDraft) => {
    const item: Customer = {
      id: newId(),
      name: draft.name.trim(),
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      address: draft.address.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      active: true,
    };
    patchCatalog((c) => ({
      ...c,
      customers: [...(c.customers ?? []), item],
    }));
    toast({ type: 'success', message: `✓ Cliente "${item.name}" creado` });
  };

  const updateCustomer = (id: string, draft: CustomerDraft) => {
    patchCatalog((cat) => ({
      ...cat,
      customers: (cat.customers ?? []).map((c) =>
        c.id === id
          ? {
              ...c,
              name: draft.name.trim(),
              email: draft.email.trim() || undefined,
              phone: draft.phone.trim() || undefined,
              address: draft.address.trim() || undefined,
              notes: draft.notes.trim() || undefined,
            }
          : c,
      ),
    }));
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setCustomerActive = (id: string, active: boolean) => {
    const target = customers.find((c) => c.id === id);
    patchCatalog((cat) => ({
      ...cat,
      customers: (cat.customers ?? []).map((c) =>
        c.id === id ? { ...c, active } : c,
      ),
    }));
    if (target) {
      toast({
        type: 'info',
        message: active
          ? `↑ "${target.name}" reactivado`
          : `↓ "${target.name}" desactivado`,
      });
    }
  };

  const saveWorkshopSettings = useCallback(
    (settings: WorkshopSettings) => {
      const resolved = resolveWorkshopSettings(settings);
      const prev = workspaceRef.current;
      if (!prev) return;
      const next: Workspace = { ...prev, settings: resolved };
      workspaceRef.current = next;
      setWorkspace(next);
      repository.save(next).catch((err) => {
        console.error('Error al guardar ajustes:', err);
        toast({
          type: 'error',
          message: 'No se pudieron guardar los ajustes',
        });
      });
      toast({ type: 'success', message: '✓ Preferencias del taller guardadas' });
    },
    [repository, toast],
  );

  const createProject = (draft: ProjectDraft) => {
    if (!workspace) return;
    const now = new Date().toISOString();
    // Build id + payload OUTSIDE setState — React Strict Mode re-runs updaters
    // in dev; newId()/save inside the updater created two different projects.
    const resolved = resolveCustomerFromDraft(
      draft,
      workspace.catalog.customers ?? [],
    );
    const catalog = { ...workspace.catalog, customers: resolved.customers };
    const meta = draftToProjectMeta(draft, resolved.customerId);
    const base: Project = {
      id: newId(),
      ...meta,
      status: 'draft',
      items: [],
      createdAt: now,
      updatedAt: now,
    };
    // Capture snapshot if created already as quoted/accepted (PRD §7.4).
    const project = transitionProjectStatus(base, meta.status, catalog, now);

    setWorkspace((prev) => {
      if (!prev) return prev;
      const next: Workspace = {
        ...prev,
        catalog: { ...prev.catalog, customers: resolved.customers },
        projects: [...prev.projects, project],
      };
      workspaceRef.current = next;
      return next;
    });

    repository.saveCatalog(catalog).catch((err) => {
      console.error('Error al guardar catálogo:', err);
    });
    // POST-only create — no PUT 404 probe in the console.
    repository.createProject(project).catch((err) => {
      console.error('Error al crear proyecto:', err);
      toast({
        type: 'error',
        message: 'No se pudo guardar la cotización en el servidor',
      });
    });
    toast({ type: 'success', message: `✓ "${meta.name}" creado` });
  };

  const updateProject = (id: string, draft: ProjectDraft) => {
    if (!workspace) return;
    const now = new Date().toISOString();
    const resolved = resolveCustomerFromDraft(
      draft,
      workspace.catalog.customers ?? [],
    );
    const catalog = { ...workspace.catalog, customers: resolved.customers };
    const meta = draftToProjectMeta(draft, resolved.customerId);

    const existing = workspace.projects.find((p) => p.id === id);
    if (!existing) return;

    const withMeta: Project = {
      ...existing,
      name: meta.name,
      customerId: meta.customerId,
      currency: meta.currency,
      marginFactor: meta.marginFactor,
      laborFixedCost: meta.laborFixedCost,
      notes: meta.notes,
      updatedAt: now,
    };
    // Status change captures or clears priceSnapshot (PRD §7.4).
    const updatedProject = transitionProjectStatus(
      withMeta,
      meta.status,
      catalog,
      now,
    );

    setWorkspace((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        catalog: { ...prev.catalog, customers: resolved.customers },
        projects: prev.projects.map((p) =>
          p.id === id ? updatedProject : p,
        ),
      };
    });

    repository.saveCatalog(catalog).catch((err) => {
      console.error('Error al guardar catálogo:', err);
    });
    repository.saveProject(updatedProject).catch((err) => {
      console.error('Error al guardar proyecto:', err);
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const deleteProject = (id: string) => {
    repository.deleteProject(id).catch((err) => {
      console.error('Error al eliminar proyecto:', err);
    });
    patchProjects((ps) => ps.filter((p) => p.id !== id));
    if (selectedProjectId === id) {
      navigate(pathForNav('projects'));
    }
    toast({ type: 'info', message: 'Cotización eliminada' });
  };

  const duplicateProjectById = (id: string) => {
    const source = projects.find((p) => p.id === id);
    if (!source) return;
    const copy = deepCopyProject(source, {
      newId: newId(),
      itemIdFactory: newId,
      nowIso: new Date().toISOString(),
    });
    setWorkspace((prev) =>
      prev ? { ...prev, projects: [...prev.projects, copy] } : prev,
    );
    repository.createProject(copy).catch((err) => {
      console.error('Error al duplicar proyecto:', err);
      toast({
        type: 'error',
        message: 'No se pudo guardar el duplicado en el servidor',
      });
    });
    toast({ type: 'success', message: `✓ Duplicado como ${copy.name}` });
  };

  const addProjectItem = (
    projectId: string,
    input: {
      moduleId: string;
      quantity: number;
      optionChoices: OptionChoices;
    },
  ) => {
    const now = new Date().toISOString();
    const item: ProjectItem = {
      id: newId(),
      moduleId: input.moduleId,
      quantity: input.quantity,
      optionChoices: input.optionChoices,
    };
    patchProjects((ps) =>
      ps.map((p) =>
        p.id === projectId
          ? { ...p, items: [...p.items, item], updatedAt: now }
          : p,
      ),
    );
  };

  const updateProjectItem = (projectId: string, item: ProjectItem) => {
    const now = new Date().toISOString();
    patchProjects((ps) =>
      ps.map((p) =>
        p.id === projectId
          ? {
              ...p,
              items: p.items.map((i) => (i.id === item.id ? item : i)),
              updatedAt: now,
            }
          : p,
      ),
    );
  };

  const removeProjectItem = (projectId: string, itemId: string) => {
    const now = new Date().toISOString();
    patchProjects((ps) =>
      ps.map((p) =>
        p.id === projectId
          ? {
              ...p,
              items: p.items.filter((i) => i.id !== itemId),
              updatedAt: now,
            }
          : p,
      ),
    );
  };

  const handleExportOptimizer = useCallback(async () => {
    if (!selectedProject || !catalog) return;
    setExportBusy(true);
    setExportErrors([]);
    try {
      const result = await buildOptimizerExport(selectedProject, catalog);
      if (!result.ok) {
        // Validation issues stay inline (ExportIssueList) — not as toasts.
        setExportErrors(result.issues);
        return;
      }
      downloadOptimizerXlsx(result.bytes, result.fileName);
      toast({
        type: 'success',
        message: `✓ ${result.fileName} descargado`,
      });
    } finally {
      setExportBusy(false);
    }
  }, [selectedProject, catalog, toast]);

  const handleExportHardwareList = useCallback(async () => {
    if (!selectedProject || !catalog) return;
    setExportBusy(true);
    setExportErrors([]);
    try {
      const result = await buildHardwareListExport(selectedProject, catalog);
      if (!result.ok) {
        setExportErrors(result.issues);
        return;
      }
      downloadHardwareListXlsx(result.bytes, result.fileName);
      toast({
        type: 'success',
        message: `✓ ${result.fileName} descargado`,
      });
    } finally {
      setExportBusy(false);
    }
  }, [selectedProject, catalog, toast]);

  const handleExportCommercialQuote = useCallback(async () => {
    if (!selectedProject || !catalog) return;
    setExportBusy(true);
    setExportErrors([]);
    try {
      const result = await buildCommercialQuoteExport(
        selectedProject,
        catalog,
        customers,
      );
      if (!result.ok) {
        setExportErrors(result.issues);
        return;
      }
      downloadCommercialQuoteXlsx(result.bytes, result.fileName);
      toast({
        type: 'success',
        message: `✓ ${result.fileName} descargado`,
      });
    } finally {
      setExportBusy(false);
    }
  }, [selectedProject, catalog, customers, toast]);

  const onEntitySelectionChange = useCallback(
    (section: EntitySection, id: string | null) => {
      if (section === 'projects') {
        setExportErrors([]);
      }
      const target = id ? entityPath(section, id) : pathForNav(section);
      if (location.pathname !== target) {
        navigate(target);
      }
    },
    [location.pathname, navigate],
  );

  const onProjectSelectionChange = useCallback(
    (projectId: string | null) => {
      onEntitySelectionChange('projects', projectId);
    },
    [onEntitySelectionChange],
  );

  const onModuleSelectionChange = useCallback(
    (moduleId: string | null) => {
      onEntitySelectionChange('modules', moduleId);
    },
    [onEntitySelectionChange],
  );

  const onNavigate = useCallback(
    (id: AppNavId) => {
      if (id === 'users' && !showAdminUsers) return;
      navigate(pathForNav(id));
    },
    [navigate, showAdminUsers],
  );

  // Loading / recover gate AFTER all hooks — never return early before useCallback/useMemo.
  if (workspaceLoadError) {
    return (
      <div
        className="workspace-load-error"
        role="alert"
        data-testid="workspace-load-error"
      >
        <div className="workspace-load-error__card">
          <h1 className="workspace-load-error__title">
            No se pudo cargar el espacio de trabajo
          </h1>
          <p className="workspace-load-error__message">{workspaceLoadError}</p>
          <div className="workspace-load-error__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reintentar
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setWorkspace(createSeedWorkspace());
                setWorkspaceLoadError(null);
              }}
            >
              Usar datos demo
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workspace || !catalog) {
    return (
      <PageLoading
        fullPage
        label="Cargando espacio de trabajo…"
        data-testid="workspace-loading"
      />
    );
  }

  return (
    <AppShell
      activeId={navId}
      onNavigate={onNavigate}
      hrefForNav={pathForNav}
      meta={`schema v${workspace.schemaVersion}`}
      onLogout={onLogout}
      sessionMode={session}
      user={
        authUser ? { email: authUser.email, role: authUser.role } : null
      }
      showAdminUsers={showAdminUsers}
      commandItems={commandItems}
      onCommandItem={onCommandItem}
    >
      {navId === 'home' ? (
        <Dashboard
          stats={dashboardStats}
          recentProjects={dashboardRecent}
          projectsCount={projects.length}
          onOpenProject={onDashboardOpenProject}
          onNewProject={onDashboardNewProject}
          onNewModule={onDashboardNewModule}
          onNewMaterial={onDashboardNewMaterial}
        />
      ) : null}
      {navId === 'materials' ? (
        <MaterialsCatalog
          materials={materials}
          edges={edges}
          onCreate={createMaterial}
          onCreateEdge={createEdge}
          onUpdate={updateMaterial}
          onDeactivate={(id) => setMaterialActive(id, false)}
          onReactivate={(id) => setMaterialActive(id, true)}
          getCostPerM2={getMaterialCostPerM2}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('materials', id)}
          requestCreateKey={materialsCreateKey}
        />
      ) : null}
      {navId === 'edges' ? (
        <EdgesCatalog
          edges={edges}
          onCreate={createEdge}
          onUpdate={updateEdge}
          onDeactivate={(id) => setEdgeActive(id, false)}
          onReactivate={(id) => setEdgeActive(id, true)}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('edges', id)}
        />
      ) : null}
      {navId === 'hardware' ? (
        <HardwareCatalog
          hardware={hardware}
          onCreate={createHardware}
          onUpdate={updateHardware}
          onDeactivate={(id) => setHardwareActive(id, false)}
          onReactivate={(id) => setHardwareActive(id, true)}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('hardware', id)}
        />
      ) : null}
      {navId === 'optionGroups' ? (
        <OptionGroupsScreen
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          modules={modules}
          onCreate={createOptionGroup}
          onUpdate={updateOptionGroup}
          onDelete={deleteOptionGroup}
          openEntityId={routeEntityId}
          onSelectionChange={(id) =>
            onEntitySelectionChange('optionGroups', id)
          }
        />
      ) : null}
      {navId === 'customers' ? (
        <CustomersScreen
          customers={customers}
          onCreate={createCustomer}
          onUpdate={updateCustomer}
          onDeactivate={(id) => setCustomerActive(id, false)}
          onReactivate={(id) => setCustomerActive(id, true)}
          openEntityId={routeEntityId}
          onSelectionChange={(id) => onEntitySelectionChange('customers', id)}
        />
      ) : null}
      {navId === 'users' && showAdminUsers && authToken ? (
        <UsersScreen baseUrl={DEFAULT_API_BASE} token={authToken} />
      ) : null}
      {navId === 'settings' ? (
        <SettingsScreen
          settings={workshopSettings}
          onSave={saveWorkshopSettings}
        />
      ) : null}
      {navId === 'modules' ? (
        <ModulesScreen
          modules={modules}
          optionGroups={optionGroups}
          hardware={hardware}
          categories={categories}
          onCreate={createModule}
          onUpdate={updateModule}
          onDelete={deleteModule}
          onCreateCategory={createCategory}
          onUpdateCategory={updateCategory}
          onDeleteCategory={deleteCategory}
          onDuplicate={duplicateModuleById}
          onEditingChange={setEditingModuleId}
          onSelectionChange={onModuleSelectionChange}
          openModuleId={routeModuleId}
          costPreview={modulePreview.costPreview}
          previewBlocked={modulePreview.previewBlocked}
          missingGroups={modulePreview.missingGroups}
          groupLabels={groupLabels}
          moduleEstimates={moduleEstimates}
          requestCreateKey={modulesCreateKey}
        />
      ) : null}
      {navId === 'projects' ? (
        <ProjectsScreen
          projects={projects}
          modules={modules}
          categories={categories}
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          customers={customers}
          onCreate={createProject}
          onUpdate={updateProject}
          onDelete={deleteProject}
          onDuplicate={duplicateProjectById}
          onAddItem={addProjectItem}
          onUpdateItem={updateProjectItem}
          onRemoveItem={removeProjectItem}
          onSelectionChange={onProjectSelectionChange}
          breakdown={backendBreakdown ?? projectQuote.breakdown}
          breakdownLoading={breakdownLoading}
          breakdownError={breakdownError}
          previewBlocked={projectQuote.previewBlocked}
          missingGroups={projectQuote.missingGroups}
          groupLabels={groupLabels}
          onExport={handleExportOptimizer}
          onExportHardware={handleExportHardwareList}
          onExportCommercialQuote={handleExportCommercialQuote}
          exportErrors={exportErrors}
          exportBusy={exportBusy}
          projectEstimates={projectEstimates}
          openProjectId={routeProjectId}
          requestCreateKey={projectsCreateKey}
          workshopSettings={workshopSettings}
        />
      ) : null}
    </AppShell>
  );
}
