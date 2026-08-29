import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** F121: AppContent.tsx holds the shell orchestration. */
const appContentSrc = () =>
  readFileSync(join(here, 'AppContent.tsx'), 'utf8');
const webRoot = join(here, '..');
const appCssPath = join(here, 'app.css');
const shellViewPath = join(here, 'ShellView.tsx');
const shellViewSrc = () => readFileSync(shellViewPath, 'utf8');
const appTsxPath = join(here, 'App.tsx');
const mainTsxPath = join(here, 'main.tsx');
const indexHtmlPath = join(webRoot, 'index.html');

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

// F057 behavior tests touch globalThis storage; provide inert defaults.
beforeEach(() => {
  (globalThis as { sessionStorage: Storage }).sessionStorage = memoryStorage();
  (globalThis as { localStorage: Storage }).localStorage = memoryStorage();
});

afterEach(() => {
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('web shell design system wiring (F016)', () => {
  it('index.html loads Inter from Google Fonts', () => {
    const html = readFileSync(indexHtmlPath, 'utf8');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('family=Inter');
    expect(html).toContain('fonts.gstatic.com');
  });

  it('main.tsx imports design-system tokens and reset globally', () => {
    const main = readFileSync(mainTsxPath, 'utf8');
    expect(main).toContain("@granete/ui/design-system/tokens.css");
    expect(main).toContain("@granete/ui/design-system/reset.css");
  });

  it('app.css has no prototype palette leftovers (shell chrome lives in @granete/ui)', () => {
    const css = readFileSync(appCssPath, 'utf8');
    expect(css).not.toContain('#1a73e8');
    expect(css).not.toContain('#f0f2f5');
    expect(css).not.toMatch(/system-ui/);
    // After F023, dashboard/home styles live in packages/ui; app.css may be comment-only.
    // If any property rules appear, they must use design tokens.
    const hasRules = /\{[^}]*[a-z-]+:/i.test(css);
    if (hasRules) {
      expect(css).toMatch(/var\(--/);
    }
  });
});

describe('web shell AppShell wiring (F017)', () => {
  it('App.tsx uses AppShell instead of horizontal tabs', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(/* F121 */ shellViewSrc()).toContain('AppShell');
    expect(/* F121: render lives in ShellView */ shellViewSrc()).toContain('activeId={navId}');
    expect(shellViewSrc()).toContain('onNavigate={onNavigate}');
    expect(/* F121 */ shellViewSrc()).toContain('hrefForNav={pathForNav}');
    expect(app).not.toContain('HomePlaceholder');
    expect(shellViewSrc()).toContain('Dashboard');
    expect(/* F121 */ shellViewSrc()).toContain('navFromPath');
    expect(/* F121 */ shellViewSrc()).toContain('pathForNav');
    expect(app).not.toContain('app-nav__tab');
    expect(app).not.toContain('className="app-nav"');
    expect(app).not.toContain("useState<CatalogTab>");
  });

  it('App.tsx still routes all former catalog screens', () => {
    // F121: the render lives in ShellView.
    const app = shellViewSrc();
    for (const screen of [
      'MaterialsCatalog',
      'EdgesCatalog',
      'HardwareCatalog',
      'OptionGroupsScreen',
      'ModulesScreen',
      'ProjectsScreen',
      'Dashboard',
    ]) {
      expect(app, `missing screen ${screen}`).toContain(screen);
    }
    expect(/* F121: render lives in ShellView */ shellViewSrc()).toContain("navId === 'materials'");
    expect(/* F121 */ shellViewSrc()).toContain("navId === 'edges'");
    expect(/* F121 */ shellViewSrc()).toContain("navId === 'hardware'");
    expect(shellViewSrc()).toContain("navId === 'optionGroups'");
    expect(shellViewSrc()).toContain("navId === 'modules'");
    expect(shellViewSrc()).toContain("navId === 'quotes'");
    expect(/* F121 */ shellViewSrc()).toContain("navId === 'home'");
  });

  it('App.tsx wires Dashboard home with open-from-outside props (F023)', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(/* F121 */ shellViewSrc()).toContain('dashboardStats');
    expect(/* F121 */ shellViewSrc()).toContain('dashboardRecent');
    expect(shellViewSrc()).toContain('onDashboardOpenProject');
    expect(/* F121 */ shellViewSrc()).toContain('onDashboardNewProject');
    expect(/* F121 */ shellViewSrc()).toContain('onDashboardNewModule');
    expect(/* F121 */ shellViewSrc()).toContain('onDashboardNewMaterial');
    expect(/* F121: render lives in ShellView */ shellViewSrc()).toContain('projectsCount={projects.length}');
    expect(/* F121 */ shellViewSrc()).toContain('openProjectId={routeProjectId}');
    expect(/* F121 */ shellViewSrc()).toContain('openModuleId={routeModuleId}');
    expect(/* F121 */ shellViewSrc()).toContain('requestCreateKey={projectsCreateKey}');
    expect(/* F121 */ shellViewSrc()).toContain('requestCreateKey={modulesCreateKey}');
    expect(/* F121 */ shellViewSrc()).toContain('requestCreateKey={materialsCreateKey}');
    expect(/* F121 */ shellViewSrc()).toContain('sumMonthlyQuotedTotal');
    expect(/* F121 */ shellViewSrc()).toContain('selectRecentProjects');
  });

  it('optionGroups nav mounts only OptionGroupsScreen (no OPT-05 demo)', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).not.toContain('ModulePricePreviewDemo');
    expect(app).not.toContain('price-preview-demo');
    expect(app).not.toContain('Demo preview de precio');
  });
});

describe('web shell login gate (Slice E)', () => {
  it('App.tsx imports LoginScreen and gates session before AppShell (F057 behavior)', async () => {
    // F057: session/auth state moved to workspaceStore. Verify:
    // 1) App.tsx still imports LoginScreen + uses SessionGate (structure).
    // 2) workspaceStore exposes the auth lifecycle (login/enterAsGuest/etc).
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('SessionGate');
    expect(app).toContain('SessionGate');
    // App.tsx delegates auth actions to workspaceStore (not local handlers).
    expect(app).toContain('useWorkspaceStore');
    // F120: SessionGate lives in its own module.
    expect(readFileSync(join(here, 'SessionGate.tsx'), 'utf8')).toContain('enterAsGuest');
    expect(readFileSync(join(here, 'SessionGate.tsx'), 'utf8')).toContain('onGuestAccess={enterAsGuest}');
    expect(readFileSync(join(here, 'SessionGate.tsx'), 'utf8')).toContain('onLogin={login}');

    // Behavior: the store exposes the full auth lifecycle.
    const { createWorkspaceStore } = await import('./stores/workspaceStore');
    const store = createWorkspaceStore();
    expect(typeof store.getState().login).toBe('function');
    expect(typeof store.getState().enterAsGuest).toBe('function');
    expect(typeof store.getState().logout).toBe('function');
    expect('register' in store.getState()).toBe(false);
  });

  it('uses invitation-first onboarding and keeps admin UsersScreen', () => {
    const gate = readFileSync(join(here, 'SessionGate.tsx'), 'utf8');
    expect(gate).toContain('AcceptInvitationScreen');
    expect(gate).not.toContain('RegisterScreen');
    expect(appContentSrc()).not.toContain('registerRequest');
    expect(shellViewSrc()).toContain('UsersScreen');
    expect(shellViewSrc()).toContain('showAdminUsers');
    expect(appContentSrc()).toContain('isAdminRole');
    expect(appContentSrc()).toContain('storeAuthUser');
    expect(gate).not.toContain("authGate === 'register'");
  });

  it('session helpers module exists with token, user and auth routes', () => {
    const sessionPath = join(here, 'session.ts');
    const session = readFileSync(sessionPath, 'utf8');
    expect(session).toContain('granete_session');
    expect(session).toContain('granete_token');
    expect(session).toContain('granete_user');
    expect(session).toContain('/auth/login');
    expect(session).not.toContain('/auth/register');
    expect(session).toContain('http://localhost:8080/api');
  });
});

describe('web shell logout (Slice F)', () => {
  it('App.tsx wires onLogout from workspaceStore + clearSession behavior (F057)', async () => {
    // F057: logout moved to workspaceStore.logout(). App.tsx reads `logout`
    // from the store and passes it as onLogout to AppContent.
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('onLogout={logout}');

    // Behavior: workspaceStore.logout clears session + storage + workspace.
    const { createWorkspaceStore } = await import('./stores/workspaceStore');
    const store = createWorkspaceStore();
    // Seed an auth session + token, then logout.
    globalThis.localStorage.setItem('granete_token', 'jwt');
    globalThis.sessionStorage.setItem('granete_session', 'auth');
    store.setState({
      session: 'auth',
      workspace: { schemaVersion: 0, catalog: { materials: [], edges: [], hardware: [], optionGroups: [], categories: [], customers: [], modules: [], structures: [], components: [] }, projects: [] },
      loginError: 'stale',
    });

    store.getState().logout();

    expect(store.getState().session).toBeNull();
    expect(store.getState().workspace).toBeNull();
    expect(store.getState().loginError).toBeNull();
    expect(globalThis.localStorage.getItem('granete_token')).toBeNull();
    expect(globalThis.sessionStorage.getItem('granete_session')).toBeNull();
  });
});

describe('web shell Toast wiring (F019)', () => {
  it('App root mounts ToastViewport and reads toast from uiStore (F064)', () => {
    // F064: ToastProvider/useToast eliminated. App.tsx mounts <ToastViewport />
    // (reads from uiStore) and reads `toast` via useUiStore.
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('ToastViewport');
    expect(app).toContain('<ToastViewport');
    expect(app).toContain('useWorkspaceStore'); // F121: root resets stores; toasts via ToastViewport
    expect(app).not.toContain('useToast');
    expect(app).not.toContain('<ToastProvider>');
  });

  it('catalog toast copy lives in catalogStore; export toast stays in App.tsx (F062)', () => {
    // F062 moved catalog handlers (and their toasts) to catalogStore.ts.
    // Export handlers (and their toasts) stay in App.tsx.
    const app = readFileSync(appTsxPath, 'utf8');
    // F117: catalog mutation toasts live in the domain slices.
    const catalogStoreSrc =
      readFileSync(join(here, 'stores/catalog/materials.ts'), 'utf8') +
      readFileSync(join(here, 'stores/catalog/edges.ts'), 'utf8');
    // design.md §4.4: create material → success with code; in catalogStore now.
    expect(catalogStoreSrc).toMatch(/type:\s*'success',\s*message:\s*`✓ "\$\{code\}" creado`/);
    expect(catalogStoreSrc).toContain("message: '✓ Cambios guardados'");
    // Export success toast + inline issues live in runExport since F119;
    // App keeps the RBAC gate copy and the inline-issues comment.
    const runExportSrc = readFileSync(
      join(here, 'exports/runExport.ts'),
      'utf8',
    );
    expect(runExportSrc).toContain('deliverExcelFile');
    expect(runExportSrc).toMatch(/\$\{result\.fileName\} descargado/);
    expect(runExportSrc).toMatch(/\$\{result\.fileName\} guardado/);
    expect(runExportSrc).toContain('ui.setExportErrors(result.issues)');
    expect(runExportSrc).toContain('// Validation issues stay inline');
  });
});
