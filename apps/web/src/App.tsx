/**
 * Thin web shell — holds catalog state; presentation lives in @muebles/ui.
 * Price formulas call @muebles/domain only here (not in UI package).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
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
  Workspace,
} from '@muebles/domain';
import {
  calcProjectBreakdown,
  duplicateModule as deepCopyModule,
  duplicateProject as deepCopyProject,
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
} from '@muebles/ui';
import {
  APIWorkspaceRepository,
  LocalStorageWorkspaceRepository,
  createSeedWorkspace,
} from '@muebles/storage';
import {
  buildHardwareListExport,
  downloadHardwareListXlsx,
} from './exportHardwareList';
import {
  buildOptimizerExport,
  downloadOptimizerXlsx,
} from './exportOptimizer';
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
      grain: p.grain,
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
    currency: 'UYU',
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
      ? new APIWorkspaceRepository()
      : new LocalStorageWorkspaceRepository();
  }, [session]);

  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    setWorkspace(null);
    repository.load()
      .then((ws) => {
        setWorkspace(ws);
      })
      .catch((err) => {
        console.error("Failed to load workspace:", err);
        setWorkspace(createSeedWorkspace());
      });
  }, [repository]);

  const [navId, setNavId] = useState<AppNavId>('home');
  const [editingModuleId, setEditingModuleId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [exportErrors, setExportErrors] = useState<readonly ExportIssue[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [projectsOpenId, setProjectsOpenId] = useState<string | null>(null);
  const [projectsCreateKey, setProjectsCreateKey] = useState(0);
  const [modulesCreateKey, setModulesCreateKey] = useState(0);

  const [backendBreakdown, setBackendBreakdown] = useState<QuoteBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const selectedProject = useMemo(() => {
    if (!workspace?.projects) return undefined;
    return workspace.projects.find((p) => p.id === selectedProjectId);
  }, [workspace, selectedProjectId]);

  useEffect(() => {
    if (session !== 'auth' || !selectedProjectId || !selectedProject) {
      setBackendBreakdown(null);
      return;
    }

    let active = true;
    setBreakdownLoading(true);

    const fetchBreakdown = async () => {
      try {
        const token = localStorage.getItem('muebles_token');
        const res = await fetch(`http://localhost:8080/api/projects/${selectedProjectId}/calculate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
          },
        });
        if (!res.ok) throw new Error('Error calculating breakdown in backend');
        const data = await res.json();
        if (active) {
          setBackendBreakdown(data as QuoteBreakdown);
        }
      } catch (err) {
        console.error("Backend calculation error:", err);
      } finally {
        if (active) {
          setBreakdownLoading(false);
        }
      }
    };

    const timeoutId = setTimeout(fetchBreakdown, 300);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [selectedProjectId, selectedProject, session]);

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

  const patchCatalog = useCallback(
    (patch: Partial<Workspace['catalog']>) => {
      setWorkspace((prev) => {
        if (!prev) return prev;
        const nextCatalog = { ...prev.catalog, ...patch };
        repository.saveCatalog(nextCatalog).catch((err) => {
          console.error("Error al guardar catálogo:", err);
          toast({ type: 'error', message: 'Error de conexión al sincronizar cambios' });
        });
        return {
          ...prev,
          catalog: nextCatalog,
        };
      });
    },
    [repository, toast],
  );

  const patchProjects = useCallback((next: readonly Project[]) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      for (const p of next) {
        repository.saveProject(p).catch((err) => {
          console.error("Error al guardar proyecto:", err);
        });
      }
      return { ...prev, projects: next };
    });
  }, [repository]);

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

  const onDashboardOpenProject = useCallback((projectId: string) => {
    setProjectsOpenId(projectId);
    setNavId('projects');
  }, []);

  const onDashboardNewProject = useCallback(() => {
    setProjectsOpenId(null);
    setProjectsCreateKey((k) => k + 1);
    setNavId('projects');
  }, []);

  const onDashboardNewModule = useCallback(() => {
    setModulesCreateKey((k) => k + 1);
    setNavId('modules');
  }, []);

  const groupLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of optionGroups) {
      map[g.code] = `${g.name} (${g.code})`;
    }
    return map;
  }, [optionGroups]);

  const createMaterial = (draft: MaterialDraft) => {
    const code = draft.code.trim();
    const item: MaterialBoard = {
      id: newId(),
      code,
      name: draft.name.trim(),
      widthMm: draft.widthMm,
      lengthMm: draft.lengthMm,
      thicknessMm: draft.thicknessMm,
      grainDefault: draft.grainDefault,
      boardPrice: draft.boardPrice,
      costPerM2: draft.costPerM2,
      wastePercent: draft.wastePercent,
      defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
      notes: optionalNotes(draft.notes),
      active: true,
    };
    patchCatalog({ materials: [...materials, item] });
    toast({ type: 'success', message: `✓ "${code}" creado` });
  };

  const updateMaterial = (id: string, draft: MaterialDraft) => {
    patchCatalog({
      materials: materials.map((m) =>
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
              costPerM2: draft.costPerM2,
              wastePercent: draft.wastePercent,
              defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
              notes: optionalNotes(draft.notes),
            }
          : m,
      ),
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setMaterialActive = (id: string, active: boolean) => {
    const target = materials.find((m) => m.id === id);
    patchCatalog({
      materials: materials.map((m) => (m.id === id ? { ...m, active } : m)),
    });
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
    patchCatalog({ edges: [...edges, item] });
    toast({ type: 'success', message: `✓ "${code}" creado` });
    return id;
  };

  const updateEdge = (id: string, draft: EdgeDraft) => {
    patchCatalog({
      edges: edges.map((e) =>
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
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setEdgeActive = (id: string, active: boolean) => {
    const target = edges.find((e) => e.id === id);
    patchCatalog({
      edges: edges.map((e) => (e.id === id ? { ...e, active } : e)),
    });
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
    patchCatalog({ hardware: [...hardware, item] });
    toast({ type: 'success', message: `✓ "${code}" creado` });
  };

  const updateHardware = (id: string, draft: HardwareDraft) => {
    patchCatalog({
      hardware: hardware.map((h) =>
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
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setHardwareActive = (id: string, active: boolean) => {
    const target = hardware.find((h) => h.id === id);
    patchCatalog({
      hardware: hardware.map((h) => (h.id === id ? { ...h, active } : h)),
    });
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
    patchCatalog({ optionGroups: [...optionGroups, item] });
    toast({ type: 'success', message: `✓ "${code}" creado` });
  };

  const updateOptionGroup = (id: string, draft: OptionGroupDraft) => {
    patchCatalog({
      optionGroups: optionGroups.map((g) =>
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
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const deleteOptionGroup = (id: string) => {
    patchCatalog({
      optionGroups: optionGroups.filter((g) => g.id !== id),
    });
    toast({ type: 'info', message: 'Grupo de opciones eliminado' });
  };

  const createCategory = (draft: CategoryDraft) => {
    const item: ModuleCategory = {
      id: newId(),
      name: draft.name.trim(),
      parentId: draft.parentId.trim() || undefined,
      sortOrder: Number(draft.sortOrder) || 0,
    };
    patchCatalog({ categories: [...categories, item] });
    toast({ type: 'success', message: `✓ Categoría "${item.name}" creada` });
  };

  const updateCategory = (id: string, draft: CategoryDraft) => {
    patchCatalog({
      categories: categories.map((c) =>
        c.id === id
          ? {
              ...c,
              name: draft.name.trim(),
              parentId: draft.parentId.trim() || undefined,
              sortOrder: Number(draft.sortOrder) || 0,
            }
          : c,
      ),
    });
    toast({ type: 'success', message: '✓ Categoría actualizada' });
  };

  const deleteCategory = (id: string) => {
    const hasChildren = categories.some((c) => c.parentId === id);
    if (hasChildren) {
      toast({
        type: 'warning',
        message: 'No se puede eliminar: tiene subcategorías',
      });
      return;
    }
    patchCatalog({
      categories: categories.filter((c) => c.id !== id),
      modules: modules.map((m) =>
        m.categoryId === id ? { ...m, categoryId: undefined } : m,
      ),
    });
    toast({ type: 'info', message: 'Categoría eliminada' });
  };

  const createModule = (draft: ModuleDraft) => {
    const item = draftToModule(newId(), draft);
    patchCatalog({ modules: [...modules, item] });
    toast({ type: 'success', message: `✓ "${item.code}" creado` });
  };

  const updateModule = (id: string, draft: ModuleDraft) => {
    patchCatalog({
      modules: modules.map((m) => (m.id === id ? draftToModule(id, draft) : m)),
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const deleteModule = (id: string) => {
    patchCatalog({ modules: modules.filter((m) => m.id !== id) });
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
    patchCatalog({ modules: [...modules, copy] });
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
    patchCatalog({ customers: [...customers, item] });
    toast({ type: 'success', message: `✓ Cliente "${item.name}" creado` });
  };

  const updateCustomer = (id: string, draft: CustomerDraft) => {
    patchCatalog({
      customers: customers.map((c) =>
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
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const setCustomerActive = (id: string, active: boolean) => {
    const target = customers.find((c) => c.id === id);
    patchCatalog({
      customers: customers.map((c) => (c.id === id ? { ...c, active } : c)),
    });
    if (target) {
      toast({
        type: 'info',
        message: active
          ? `↑ "${target.name}" reactivado`
          : `↓ "${target.name}" desactivado`,
      });
    }
  };

  const createProject = (draft: ProjectDraft) => {
    const now = new Date().toISOString();
    let createdName = draft.name.trim();
    setWorkspace((prev) => {
      if (!prev) return prev;
      const resolved = resolveCustomerFromDraft(
        draft,
        prev.catalog.customers ?? [],
      );
      const catalog = { ...prev.catalog, customers: resolved.customers };
      const meta = draftToProjectMeta(draft, resolved.customerId);
      createdName = meta.name;
      const base: Project = {
        id: newId(),
        ...meta,
        status: 'draft',
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      // Capture snapshot if created already as quoted/accepted (PRD §7.4).
      const project = transitionProjectStatus(
        base,
        meta.status,
        catalog,
        now,
      );

      // Persistir de forma asíncrona
      repository.saveCatalog(catalog).catch(() => {});
      repository.saveProject(project).catch(() => {});

      return {
        ...prev,
        catalog,
        projects: [...prev.projects, project],
      };
    });
    toast({ type: 'success', message: `✓ "${createdName}" creado` });
  };

  const updateProject = (id: string, draft: ProjectDraft) => {
    const now = new Date().toISOString();
    setWorkspace((prev) => {
      if (!prev) return prev;
      const resolved = resolveCustomerFromDraft(
        draft,
        prev.catalog.customers ?? [],
      );
      const catalog = { ...prev.catalog, customers: resolved.customers };
      const meta = draftToProjectMeta(draft, resolved.customerId);

      let updatedProject: Project | null = null;
      const updatedProjects = prev.projects.map((p) => {
        if (p.id !== id) return p;
        const withMeta: Project = {
          ...p,
          name: meta.name,
          customerId: meta.customerId,
          currency: meta.currency,
          marginFactor: meta.marginFactor,
          laborFixedCost: meta.laborFixedCost,
          notes: meta.notes,
          updatedAt: now,
        };
        // Status change captures or clears priceSnapshot (PRD §7.4).
        updatedProject = transitionProjectStatus(withMeta, meta.status, catalog, now);
        return updatedProject;
      });

      // Persistir de forma asíncrona
      repository.saveCatalog(catalog).catch(() => {});
      if (updatedProject) {
        repository.saveProject(updatedProject).catch(() => {});
      }

      return {
        ...prev,
        catalog,
        projects: updatedProjects,
      };
    });
    toast({ type: 'success', message: '✓ Cambios guardados' });
  };

  const deleteProject = (id: string) => {
    repository.deleteProject(id).catch((err) => {
      console.error("Error al eliminar proyecto:", err);
    });
    patchProjects(projects.filter((p) => p.id !== id));
    if (selectedProjectId === id) {
      setSelectedProjectId(null);
    }
    toast({ type: 'info', message: 'Proyecto eliminado' });
  };

  const duplicateProjectById = (id: string) => {
    const source = projects.find((p) => p.id === id);
    if (!source) return;
    const copy = deepCopyProject(source, {
      newId: newId(),
      itemIdFactory: newId,
      nowIso: new Date().toISOString(),
    });
    patchProjects([...projects, copy]);
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
    patchProjects(
      projects.map((p) =>
        p.id === projectId
          ? { ...p, items: [...p.items, item], updatedAt: now }
          : p,
      ),
    );
  };

  const updateProjectItem = (projectId: string, item: ProjectItem) => {
    const now = new Date().toISOString();
    patchProjects(
      projects.map((p) =>
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
    patchProjects(
      projects.map((p) =>
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

  const onProjectSelectionChange = useCallback((projectId: string | null) => {
    setSelectedProjectId(projectId);
    setExportErrors([]);
    if (projectId === null) {
      setProjectsOpenId(null);
    }
  }, []);

  const onNavigate = useCallback(
    (id: AppNavId) => {
      if (id === 'users' && !showAdminUsers) return;
      setNavId(id);
      if (id !== 'projects') {
        setProjectsOpenId(null);
      }
    },
    [showAdminUsers],
  );

  const sessionLabel =
    session === 'auth'
      ? authUser?.role === 'admin'
        ? 'Admin'
        : 'Sesión'
      : 'Invitado';

  // Loading gate AFTER all hooks — never return early before useCallback/useMemo.
  if (!workspace || !catalog) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
          <p className="text-slate-400 font-medium animate-pulse text-sm">
            Cargando espacio de trabajo...
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      activeId={navId}
      onNavigate={onNavigate}
      meta={`Semilla plantilla · schema v${workspace.schemaVersion} · ${sessionLabel}`}
      onLogout={onLogout}
      showAdminUsers={showAdminUsers}
    >
      {navId === 'home' ? (
        <Dashboard
          stats={dashboardStats}
          recentProjects={dashboardRecent}
          onOpenProject={onDashboardOpenProject}
          onNewProject={onDashboardNewProject}
          onNewModule={onDashboardNewModule}
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
        />
      ) : null}
      {navId === 'edges' ? (
        <EdgesCatalog
          edges={edges}
          onCreate={createEdge}
          onUpdate={updateEdge}
          onDeactivate={(id) => setEdgeActive(id, false)}
          onReactivate={(id) => setEdgeActive(id, true)}
        />
      ) : null}
      {navId === 'hardware' ? (
        <HardwareCatalog
          hardware={hardware}
          onCreate={createHardware}
          onUpdate={updateHardware}
          onDeactivate={(id) => setHardwareActive(id, false)}
          onReactivate={(id) => setHardwareActive(id, true)}
        />
      ) : null}
      {navId === 'optionGroups' ? (
        <OptionGroupsScreen
          optionGroups={optionGroups}
          materials={materials}
          edges={edges}
          hardware={hardware}
          onCreate={createOptionGroup}
          onUpdate={updateOptionGroup}
          onDelete={deleteOptionGroup}
        />
      ) : null}
      {navId === 'customers' ? (
        <CustomersScreen
          customers={customers}
          onCreate={createCustomer}
          onUpdate={updateCustomer}
          onDeactivate={(id) => setCustomerActive(id, false)}
          onReactivate={(id) => setCustomerActive(id, true)}
        />
      ) : null}
      {navId === 'users' && showAdminUsers && authToken ? (
        <UsersScreen baseUrl={DEFAULT_API_BASE} token={authToken} />
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
          previewBlocked={projectQuote.previewBlocked}
          missingGroups={projectQuote.missingGroups}
          groupLabels={groupLabels}
          onExport={handleExportOptimizer}
          onExportHardware={handleExportHardwareList}
          exportErrors={exportErrors}
          exportBusy={exportBusy}
          projectEstimates={projectEstimates}
          openProjectId={projectsOpenId}
          requestCreateKey={projectsCreateKey}
        />
      ) : null}
    </AppShell>
  );
}
