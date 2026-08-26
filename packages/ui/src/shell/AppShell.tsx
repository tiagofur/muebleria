/**
 * App chrome: dark sidebar + top bar + content (design.md §4.1).
 * Presentation only — navigation ids are controlled by the shell.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  FileText,
  Factory,
  KanbanSquare,
  LayoutDashboard,
  Layers,
  LayoutGrid,
  Boxes,
  Compass,
  Hammer,
  ListChecks,
  LogOut,
  Menu,
  Minus,
  Package,
  Puzzle,
  Settings,
  Settings2,
  ShieldCheck,
  Search,
  Store,
  ToggleLeft,
  Truck,
  User,
  WifiOff,
  X,
  Users,
  Palette,
  BarChart3,
  ClipboardList,
  TrendingUp,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { BrandMark } from '../common/BrandMark';
import {
  CommandPalette,
  useCommandPaletteHotkey,
  type CommandPaletteItem,
} from './CommandPalette';
import './appShell.css';

/** Stable nav destinations for AppShell (shell wires screens). */
export type AppNavId =
  | 'home'
  | 'quotes'
  | 'customers'
  | 'showcase'
  | 'plantBoard'
  | 'production'
  | 'shipments'
  | 'installations'
  | 'orders'
  | 'productionDashboard'
  | 'engineeringDashboard'
  | 'engineering'
  | 'warehouseDashboard'
  | 'warehouse'
  | 'salesDashboard'
  | 'modules'
  | 'structures'
  | 'components'
  | 'addOns'
  | 'materials'
  | 'edges'
  | 'hardware'
  | 'finishes'
  | 'optionGroups'
  | 'settings'
  | 'users'
  | 'platform';

export type AppShellSessionUser = {
  readonly email: string;
  readonly role: string;
};

export type AppShellProps = {
  readonly activeId: AppNavId;
  readonly onNavigate: (id: AppNavId) => void;
  readonly children: ReactNode;
  /** Optional meta line in the top bar (e.g. schema version). */
  readonly meta?: string;
  /** @deprecated The topbar no longer shows a screen title (design.md §4.1b);
   * the page-header of each screen owns the title. */
  readonly title?: string;
  /** Optional top-bar trailing actions (custom controls). */
  readonly headerActions?: ReactNode;
  /** When set, renders the standard top-bar «Salir» control (design.md §6.6). */
  readonly onLogout?: () => void;
  /** Auth user for topbar identity (email + role). Guest leaves this unset. */
  readonly user?: AppShellSessionUser | null;
  /** Session mode for badge: auth vs guest (invitado). */
  readonly sessionMode?: 'auth' | 'guest';
  /** Admin-only: show «Usuarios» under CONFIG (registration approval). */
  readonly showAdminUsers?: boolean;
  /** Role-filtered nav ids (F035). When set, filters APP_NAV_SECTIONS. */
  readonly allowedNavIds?: ReadonlySet<string> | readonly string[];
  /**
   * OC-092 workshop size: 'simplified' reduces the sidebar to the small-shop
   * surface (Inicio, Cotizaciones, Órdenes, Almacén, Instalaciones +
   * Config) on top of the RBAC allowlist; 'departmental' (default) keeps the
   * full departmental navigation.
   */
  readonly navMode?: 'simplified' | 'departmental';
  /**
   * Optional real URL per nav id (shell SPA routes). When set, items render as
   * anchors so middle-click / copy-link work; plain click still calls onNavigate.
   */
  readonly hrefForNav?: (id: AppNavId) => string;
  /**
   * Extra command-palette entries (recent quotes/modules, etc.).
   * Nav sections are always included. Cmd/Ctrl+K toggles the palette.
   */
  readonly commandItems?: readonly CommandPaletteItem[];
  /** Called when a non-nav command item is chosen (`id` as provided). */
  readonly onCommandItem?: (id: string) => void;
};

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    admin: 'Admin',
    user: 'Sin puesto',
    vendedor: 'Vendedor',
    gerente_ventas: 'Gerente de ventas',
    gerente_produccion: 'Gerente de producción',
    ingeniero: 'Ingeniero',
    produccion: 'Producción',
    almacen: 'Almacén',
  };
  return map[role] ?? role;
}

/** Optional IA subgroup within a section (Fase 6 UI — design.md §4.1). */
export type NavItemGroup = 'composition' | 'catalogs';

type NavItemDef = {
  readonly id: AppNavId;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Visual subgroup under the section label (e.g. Composición / Catálogos). */
  readonly group?: NavItemGroup;
};

type NavSectionDef = {
  readonly id:
  | 'trabajo'
  | 'ventas'
  | 'produccion'
  | 'ingenieria'
  | 'almacen'
  | 'libreria'
  | 'catalogos'
  | 'config';
  readonly label: string;
  readonly items: readonly NavItemDef[];
};

const ADMIN_USERS_NAV: NavItemDef = {
  id: 'users',
  label: 'Usuarios',
  icon: ShieldCheck,
};

const PLATFORM_NAV: NavItemDef = {
  id: 'platform',
  label: 'Plataforma',
  icon: ShieldCheck,
};

const NAV_GROUP_LABELS: Readonly<Record<NavItemGroup, string>> = {
  composition: 'Composición',
  catalogs: 'Catálogos',
};

/** Canonical sidebar sections — TRABAJO / PRODUCCIÓN / VENTAS / … (design.md §4.1 + §3.7). */
export const APP_NAV_SECTIONS: readonly NavSectionDef[] = [
  {
    id: 'trabajo',
    label: 'TRABAJO',
    items: [
      { id: 'home', label: 'Inicio', icon: LayoutDashboard },
      /**
       * F093 — factory progress board. Visible to EVERY role (sales
       * included): read-only "where is each project right now".
       */
      { id: 'plantBoard', label: 'Estado de Planta', icon: KanbanSquare },
    ],
  },
  {
    id: 'ventas',
    label: 'VENTAS',
    items: [
      /**
       * Dashboard Ventas — pipeline + summary for sales roles.
       * vendedor sees own portfolio; gerente_ventas and admin see all.
       */
      { id: 'salesDashboard', label: 'Dashboard Ventas', icon: TrendingUp },
      { id: 'quotes', label: 'Cotizaciones', icon: FileText },
      { id: 'customers', label: 'Clientes', icon: Users },
      /** Commercial catalog — not engineering ABM. */
      { id: 'showcase', label: 'Vitrina', icon: Store },
    ],
  },
  {
    id: 'produccion',
    label: 'PRODUCCIÓN',
    /**
     * Ordering rule (menu reorg): dashboards FIRST, then general →
     * specific following the workshop process (orden de obra → fabricar →
     * cargar → instalar).
     */
    items: [
      /**
       * Production Manager Dashboard: full visibility for gerente_produccion.
       */
      { id: 'productionDashboard', label: 'Dashboard Producción', icon: BarChart3 },
      /**
       * Órdenes — per-project production workspace queue (the old
       * "Producción" hub). TEMPORARY: slated for removal once its remaining
       * tabs migrate (see roadmap-screens/00-overview.md §M2).
       */
      { id: 'orders', label: 'Órdenes', icon: ListChecks },
      /**
       * Producción (ex-Fábrica) — station work queue, corte → embalaje.
       * Sector-scoped operators see their assigned stations; admin /
       * gerente_produccion see everything + the metrics toggle.
       */
      { id: 'production', label: 'Producción', icon: Factory },
      /**
       * Instalaciones — what's loaded and on its way to the client's site
       * (cargado → instalado). The last process step gets its own screen.
       */
      { id: 'installations', label: 'Instalaciones', icon: Hammer },
    ],
  },
  {
    id: 'ingenieria',
    label: 'INGENIERÍA',
    items: [
      /**
       * Dashboard Ingeniería — analytics, cycle times & workload for technical leadership.
       */
      { id: 'engineeringDashboard', label: 'Dashboard Ingeniería', icon: Compass },
      /**
       * Ingeniería — documentation workspace for engineers.
       * Landing page with project list + engineering status.
       */
      { id: 'engineering', label: 'Ingeniería', icon: ClipboardList },
    ],
  },
  {
    id: 'almacen',
    label: 'COMPRAS / ALMACÉN',
    items: [
      /**
       * Dashboard Almacén — analytics, material demand, stock health & POs.
       */
      { id: 'warehouseDashboard', label: 'Dashboard Almacén', icon: Compass },
      /**
       * Compras / Almacén (Fase 3) — picking lists per active project.
       * admin full, gerente_produccion read-only, almacen own sectors;
       * rbac.ts navIdsForRole decides via roleCanAccessPurchasingNav.
       */
      { id: 'warehouse', label: 'Almacén', icon: Warehouse },
      /**
       * Embarques — staging, loading, and dispatch of finished goods.
       * Moved from PRODUCCIÓN to ALMACÉN (2026-08-18): logistics
       * responsibility, not production.
       */
      { id: 'shipments', label: 'Embarques', icon: Truck },
    ],
  },
  {
    id: 'libreria',
    label: 'LIBRERÍA',
    items: [
      { id: 'modules', label: 'Muebles', icon: Package },
      { id: 'structures', label: 'Estructuras', icon: LayoutGrid },
      { id: 'addOns', label: 'Agregados', icon: Boxes },
      { id: 'components', label: 'Componentes', icon: Puzzle },
      { id: 'optionGroups', label: 'Grupos', icon: ToggleLeft },
    ],
  },
  {
    id: 'catalogos',
    label: 'CATÁLOGOS',
    items: [
      { id: 'materials', label: 'Materiales', icon: Layers },
      { id: 'edges', label: 'Cantos', icon: Minus },
      { id: 'hardware', label: 'Herrajes', icon: Settings2 },
      { id: 'finishes', label: 'Acabados', icon: Palette },
    ],
  },
  {
    id: 'config',
    label: 'CONFIG',
    items: [
      { id: 'settings', label: 'Ajustes', icon: Settings },
    ],
  },
] as const;

export function labelForNavId(id: AppNavId): string {
  if (id === 'platform') return PLATFORM_NAV.label;
  if (id === 'users') return ADMIN_USERS_NAV.label;
  for (const section of APP_NAV_SECTIONS) {
    const item = section.items.find((i) => i.id === id);
    if (item) return item.label;
  }
  return 'Muebles';
}

/**
 * Section label (área) for the topbar "dónde estoy" indicator — design.md §4.1b.
 * The topbar no longer repeats the screen title; the page-header owns it.
 */
export function sectionLabelForNavId(id: AppNavId): string {
  for (const section of APP_NAV_SECTIONS) {
    if (section.items.some((i) => i.id === id)) return section.label;
  }
  return (id === 'users' || id === 'platform') ? 'CONFIG' : 'Muebles';
}

/**
 * Área funcional (design.md §3.2.1) — color de ubicación, nunca de acción.
 * ventas → teal · ingeniería → indigo marca · librería/catálogos → oliva ·
 * producción → naranja taller · almacén → azul acero · trabajo/config → neutro.
 */
export type AppAreaId = 'sales' | 'eng' | 'work' | 'library' | 'warehouse';
export type AppAreaContext = AppAreaId | 'neutral';

const SECTION_AREA: Readonly<Record<string, AppAreaId | null>> = {
  trabajo: null,
  ventas: 'sales',
  produccion: 'work',
  ingenieria: 'eng',
  almacen: 'warehouse',
  libreria: 'library',
  catalogos: 'library',
  config: null,
};

export function areaIdForNavId(id: AppNavId): AppAreaId | null {
  for (const section of APP_NAV_SECTIONS) {
    if (section.items.some((i) => i.id === id)) return SECTION_AREA[section.id] ?? null;
  }
  return null;
}

/** Stable frame context: every destination resolves to an explicit tonal family. */
export function areaContextForNavId(id: AppNavId): AppAreaContext {
  return areaIdForNavId(id) ?? 'neutral';
}

/** Configuration options for resolving sidebar navigation. */
export type ResolveNavOptions = {
  /** If true, includes the admin users panel in the CONFIG section. */
  readonly showAdminUsers?: boolean;
  /** Allowlist of nav section ids (from RBAC). Null/undefined = unrestricted. */
  readonly allowedNavIds?: ReadonlySet<string> | readonly string[] | null;
  /**
   * Small-workshop simplified navigation (OC-092 / F106): reduces the
   * sidebar to the core job destinations (Inicio, Cotizaciones, Órdenes,
   * Almacén, Instalaciones, Ajustes). Catalogs, library and dashboards stay
   * accessible via in-screen navigation and departmental mode.
   */
  readonly navMode?: 'simplified' | 'departmental';
};

/**
 * OC-092 small-workshop navigation surface (docs/operational-ux.md §5):
 * Inicio, Cotizaciones, Órdenes (producción), Almacén (materiales) e
 * Instalaciones — plus CONFIG so the mode itself stays reachable.
 */
const SIMPLIFIED_NAV_IDS: ReadonlySet<string> = new Set([
  'home',
  'quotes',
  'orders',
  'warehouse',
  'installations',
  'settings',
  'users',
]);

/** Sidebar sections filtered by product role (F035) and workshop size (OC-092). */
export function resolveNavSections(
  showAdminUsersOrOptions: boolean | ResolveNavOptions = false,
): readonly NavSectionDef[] {
  const options: ResolveNavOptions =
    typeof showAdminUsersOrOptions === 'boolean'
      ? { showAdminUsers: showAdminUsersOrOptions }
      : showAdminUsersOrOptions;

  const allowed = options.allowedNavIds
    ? new Set(
      options.allowedNavIds instanceof Set
        ? options.allowedNavIds
        : options.allowedNavIds,
    )
    : null;

  const includeUsers =
    allowed != null
      ? allowed.has('users')
      : Boolean(options.showAdminUsers);

  const includePlatform = allowed != null && allowed.has('platform');

  let sections: readonly NavSectionDef[] = APP_NAV_SECTIONS;

  if (options.navMode === 'simplified') {
    sections = sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => SIMPLIFIED_NAV_IDS.has(item.id)),
    }));
  }

  if (allowed != null) {
    sections = sections.map((section) => ({
      ...section,
      items: section.items.filter((item) => allowed.has(item.id)),
    }));
  }

  sections = sections.filter((section) => section.items.length > 0);

  if (!includeUsers && !includePlatform) return sections;

  return sections.map((section) => {
    if (section.id !== 'config') return section;
    let items = [...section.items];
    if (includeUsers && !items.some((i) => i.id === 'users')) {
      items.push(ADMIN_USERS_NAV);
    }
    if (includePlatform && !items.some((i) => i.id === 'platform')) {
      items.push(PLATFORM_NAV);
    }
    return {
      ...section,
      items,
    };
  });
}

export function AppShell({
  activeId,
  onNavigate,
  children,
  meta,
  headerActions,
  onLogout,
  user = null,
  sessionMode,
  showAdminUsers = false,
  allowedNavIds,
  navMode,
  hrefForNav,
  commandItems = [],
  onCommandItem,
}: AppShellProps): ReactNode {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const savedScrollRef = useRef<number | null>(null);
  const navSections = resolveNavSections({
    showAdminUsers,
    allowedNavIds,
    navMode,
  });

  // Persist sidebar scroll position across navigations: save on unmount,
  // restore on re-mount so the user never loses their scroll place.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    return () => {
      savedScrollRef.current = nav.scrollTop;
    };
  }, []);

  // Restore saved position first; auto-scroll the active item only when the
  // saved position doesn't already keep it visible.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const saved = savedScrollRef.current;
    savedScrollRef.current = null;
    if (saved != null) {
      nav.scrollTop = saved;
    }
    // Check whether the active item is already visible after restore.
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active) return;
    if (saved == null && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    // If we restored a position, verify the active item is in the viewport.
    const navRect = nav.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    if (itemRect.top < navRect.top || itemRect.bottom > navRect.bottom) {
      if (typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeId]);

  const handleNavigate = useCallback(
    (id: AppNavId) => {
      onNavigate(id);
      setSidebarOpen(false);
    },
    [onNavigate],
  );

  const togglePalette = useCallback(() => {
    setPaletteOpen((open) => !open);
  }, []);

  useCommandPaletteHotkey(togglePalette, true);

  const paletteItems = useMemo((): CommandPaletteItem[] => {
    const navItems: CommandPaletteItem[] = navSections.flatMap((section) =>
      section.items.map((item) => {
        const subgroup = item.group ? NAV_GROUP_LABELS[item.group] : '';
        return {
          id: `nav:${item.id}`,
          label: item.label,
          group: 'Navegación',
          keywords: [section.label, subgroup, item.label]
            .filter(Boolean)
            .join(' '),
          icon: item.icon,
        };
      }),
    );
    return [...navItems, ...commandItems];
  }, [navSections, commandItems]);

  const onPaletteSelect = useCallback(
    (id: string) => {
      if (id.startsWith('nav:')) {
        const navId = id.slice(4) as AppNavId;
        handleNavigate(navId);
        return;
      }
      onCommandItem?.(id);
    },
    [handleNavigate, onCommandItem],
  );

  const onNavClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>, id: AppNavId) => {
      // Allow modified clicks (new tab) to use the real href when present.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      handleNavigate(id);
    },
    [handleNavigate],
  );

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(
    () => setSidebarOpen((open) => !open),
    [],
  );

  const areaLabel = sectionLabelForNavId(activeId);
  const areaId = areaIdForNavId(activeId);
  const areaContext = areaContextForNavId(activeId);
  const hasIdentity = Boolean(user) || sessionMode === 'guest' || sessionMode === 'auth';
  const hasActions = Boolean(headerActions) || Boolean(onLogout) || hasIdentity;

  return (
    <div className="app-layout" data-area-context={areaContext}>
      {sidebarOpen ? (
        <button
          type="button"
          className="app-layout__backdrop"
          aria-label="Cerrar menú"
          tabIndex={-1}
          onClick={closeSidebar}
        />
      ) : null}

      <aside
        id="app-sidebar-nav"
        className={sidebarOpen ? 'app-sidebar is-open' : 'app-sidebar'}
        aria-label="Navegación principal"
      >
        <div className="app-sidebar__brand">
          <BrandMark size={32} className="app-sidebar__brand-mark" />
          <span className="app-sidebar__brand-text">Granete</span>
        </div>

        <nav ref={navRef} className="app-sidebar__nav" aria-label="Secciones">
          {navSections.map((section) => {
            let lastGroup: NavItemGroup | undefined;
            return (
              <div
                key={section.id}
                className={`app-sidebar__section${SECTION_AREA[section.id] ? ` app-sidebar__section--${SECTION_AREA[section.id]}` : ''}`}
              >
                <p className="app-sidebar__section-label">{section.label}</p>
                <ul className="app-sidebar__list">
                  {section.items.flatMap((item) => {
                    const nodes: ReactNode[] = [];
                    if (item.group && item.group !== lastGroup) {
                      lastGroup = item.group;
                      nodes.push(
                        <li
                          key={`group-${section.id}-${item.group}`}
                          className="app-sidebar__group"
                          role="presentation"
                        >
                          <p
                            className="app-sidebar__group-label"
                            data-testid={`nav-group-${item.group}`}
                          >
                            {NAV_GROUP_LABELS[item.group]}
                          </p>
                        </li>,
                      );
                    }
                    const Icon = item.icon;
                    const active = item.id === activeId;
                    const baseClass = active
                      ? 'app-sidebar__item is-active'
                      : 'app-sidebar__item';
                    const className = item.group
                      ? `${baseClass} app-sidebar__item--nested`
                      : baseClass;
                    const content = (
                      <>
                        <Icon
                          className="app-sidebar__icon"
                          size={16}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        <span>{item.label}</span>
                      </>
                    );
                    nodes.push(
                      <li key={item.id}>
                        {hrefForNav ? (
                          <a
                            href={hrefForNav(item.id)}
                            className={className}
                            aria-current={active ? 'page' : undefined}
                            onClick={(e) => onNavClick(e, item.id)}
                          >
                            {content}
                          </a>
                        ) : (
                          <button
                            type="button"
                            className={className}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => handleNavigate(item.id)}
                          >
                            {content}
                          </button>
                        )}
                      </li>,
                    );
                    return nodes;
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="app-layout__main">
        <header className="app-topbar">
          <button
            type="button"
            className="app-topbar__menu"
            aria-label={sidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar-nav"
            onClick={toggleSidebar}
          >
            {sidebarOpen ? (
              <X size={20} strokeWidth={1.5} aria-hidden />
            ) : (
              <Menu size={20} strokeWidth={1.5} aria-hidden />
            )}
          </button>
          <p className="app-topbar__area" data-area={areaId ?? undefined}>{areaLabel}</p>
          {meta ? <p className="app-topbar__meta">{meta}</p> : null}
          <div className="app-topbar__actions">
            <button
              type="button"
              className="app-topbar__search-trigger"
              onClick={() => setPaletteOpen(true)}
              aria-label="Buscar secciones o atajos (Cmd+K)"
              title="Buscar secciones o atajos (Cmd+K)"
              data-testid="app-topbar-command-trigger"
            >
              <Search size={14} strokeWidth={1.5} aria-hidden />
              <span className="app-topbar__search-text">Buscar…</span>
              <kbd className="app-topbar__search-kbd">⌘K</kbd>
            </button>
            {headerActions}
            {sessionMode === 'guest' ? (
              <div
                className="app-topbar__identity app-topbar__identity--guest"
                data-testid="app-session-identity"
                title="Modo local: datos guardados en este navegador, sin conexión al servidor"
              >
                <WifiOff size={16} strokeWidth={1.5} aria-hidden />
                <span className="app-topbar__identity-text">
                  <span className="app-topbar__identity-name">Invitado</span>
                  <span className="app-topbar__identity-role">Modo local</span>
                </span>
              </div>
            ) : null}
            {sessionMode === 'auth' && user ? (
              <div
                className="app-topbar__identity"
                data-testid="app-session-identity"
                title={user.email}
              >
                <User size={16} strokeWidth={1.5} aria-hidden />
                <span className="app-topbar__identity-text">
                  <span className="app-topbar__identity-name">{user.email}</span>
                  <span className="app-topbar__identity-role">
                    {roleLabel(user.role)}
                  </span>
                </span>
              </div>
            ) : null}
            {onLogout ? (
              <button
                type="button"
                className="app-topbar__logout"
                onClick={onLogout}
                data-testid="app-logout"
              >
                <LogOut size={16} strokeWidth={1.5} aria-hidden />
                Salir
              </button>
            ) : null}
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        onSelect={onPaletteSelect}
      />
    </div>
  );
}
