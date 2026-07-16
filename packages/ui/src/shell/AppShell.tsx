/**
 * App chrome: dark sidebar + top bar + content (design.md §4.1).
 * Presentation only — navigation ids are controlled by the shell.
 */

import {
  useCallback,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import {
  FileText,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  Minus,
  Package,
  Settings2,
  ShieldCheck,
  ToggleLeft,
  User,
  WifiOff,
  X,
  Users,
  type LucideIcon,
} from 'lucide-react';
import './appShell.css';

/** Stable nav destinations for AppShell (shell wires screens). */
export type AppNavId =
  | 'home'
  | 'projects'
  | 'customers'
  | 'modules'
  | 'materials'
  | 'edges'
  | 'hardware'
  | 'optionGroups'
  | 'users';

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
  /** Top bar title; defaults to active nav label. */
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
  /**
   * Optional real URL per nav id (shell SPA routes). When set, items render as
   * anchors so middle-click / copy-link work; plain click still calls onNavigate.
   */
  readonly hrefForNav?: (id: AppNavId) => string;
};

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    admin: 'Admin',
    user: 'Usuario',
    vendedor: 'Vendedor',
    disenador: 'Diseñador',
    carpintero: 'Carpintero',
  };
  return map[role] ?? role;
}

type NavItemDef = {
  readonly id: AppNavId;
  readonly label: string;
  readonly icon: LucideIcon;
};

type NavSectionDef = {
  readonly id: 'trabajo' | 'config';
  readonly label: string;
  readonly items: readonly NavItemDef[];
};

const ADMIN_USERS_NAV: NavItemDef = {
  id: 'users',
  label: 'Usuarios',
  icon: ShieldCheck,
};

/** Canonical sidebar sections — TRABAJO / CONFIG (design.md §4.1 + §3.7). */
export const APP_NAV_SECTIONS: readonly NavSectionDef[] = [
  {
    id: 'trabajo',
    label: 'TRABAJO',
    items: [
      { id: 'home', label: 'Home', icon: LayoutDashboard },
      { id: 'projects', label: 'Cotizaciones', icon: FileText },
      { id: 'customers', label: 'Clientes', icon: Users },
      { id: 'modules', label: 'Muebles', icon: Package },
    ],
  },
  {
    id: 'config',
    label: 'CONFIG',
    items: [
      { id: 'materials', label: 'Materiales', icon: Layers },
      { id: 'edges', label: 'Cantos', icon: Minus },
      { id: 'hardware', label: 'Herrajes', icon: Settings2 },
      { id: 'optionGroups', label: 'Grupos', icon: ToggleLeft },
    ],
  },
] as const;

export function labelForNavId(id: AppNavId): string {
  if (id === 'users') return ADMIN_USERS_NAV.label;
  for (const section of APP_NAV_SECTIONS) {
    const item = section.items.find((i) => i.id === id);
    if (item) return item.label;
  }
  return 'Muebles';
}

/** Sidebar sections; optionally append admin Usuarios under CONFIG. */
export function resolveNavSections(
  showAdminUsers = false,
): readonly NavSectionDef[] {
  if (!showAdminUsers) return APP_NAV_SECTIONS;
  return APP_NAV_SECTIONS.map((section) => {
    if (section.id !== 'config') return section;
    if (section.items.some((i) => i.id === 'users')) return section;
    return {
      ...section,
      items: [...section.items, ADMIN_USERS_NAV],
    };
  });
}

export function AppShell({
  activeId,
  onNavigate,
  children,
  meta,
  title,
  headerActions,
  onLogout,
  user = null,
  sessionMode,
  showAdminUsers = false,
  hrefForNav,
}: AppShellProps): ReactNode {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navSections = resolveNavSections(showAdminUsers);

  const handleNavigate = useCallback(
    (id: AppNavId) => {
      onNavigate(id);
      setSidebarOpen(false);
    },
    [onNavigate],
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

  const heading = title ?? labelForNavId(activeId);
  const hasIdentity = Boolean(user) || sessionMode === 'guest' || sessionMode === 'auth';
  const hasActions = Boolean(headerActions) || Boolean(onLogout) || hasIdentity;

  return (
    <div className="app-layout">
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
          <span className="app-sidebar__brand-mark" aria-hidden>
            🪑
          </span>
          <span className="app-sidebar__brand-text">Muebles</span>
        </div>

        <nav className="app-sidebar__nav" aria-label="Secciones">
          {navSections.map((section) => (
            <div key={section.id} className="app-sidebar__section">
              <p className="app-sidebar__section-label">{section.label}</p>
              <ul className="app-sidebar__list">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === activeId;
                  const className = active
                    ? 'app-sidebar__item is-active'
                    : 'app-sidebar__item';
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
                  return (
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
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
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
          <h1 className="app-topbar__title">{heading}</h1>
          {meta ? <p className="app-topbar__meta">{meta}</p> : null}
          {hasActions ? (
            <div className="app-topbar__actions">
              {headerActions}
              {sessionMode === 'guest' ? (
                <div
                  className="app-topbar__identity"
                  data-testid="app-session-identity"
                  title="Modo invitado: datos locales, sin API"
                >
                  <WifiOff size={16} strokeWidth={1.5} aria-hidden />
                  <span className="app-topbar__identity-text">
                    <span className="app-topbar__identity-name">Invitado</span>
                    <span className="app-topbar__identity-role">Sin conexión</span>
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
          ) : null}
        </header>

        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
