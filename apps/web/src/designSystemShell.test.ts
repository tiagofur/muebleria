import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const appCssPath = join(here, 'app.css');
const appTsxPath = join(here, 'App.tsx');
const mainTsxPath = join(here, 'main.tsx');
const indexHtmlPath = join(webRoot, 'index.html');

describe('web shell design system wiring (F016)', () => {
  it('index.html loads Inter from Google Fonts', () => {
    const html = readFileSync(indexHtmlPath, 'utf8');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('family=Inter');
    expect(html).toContain('fonts.gstatic.com');
  });

  it('main.tsx imports design-system tokens and reset globally', () => {
    const main = readFileSync(mainTsxPath, 'utf8');
    expect(main).toContain("@muebles/ui/design-system/tokens.css");
    expect(main).toContain("@muebles/ui/design-system/reset.css");
  });

  it('app.css has no prototype palette leftovers (shell chrome lives in @muebles/ui)', () => {
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
    expect(app).toContain('AppShell');
    expect(app).toContain('activeId={navId}');
    expect(app).toContain('onNavigate={onNavigate}');
    expect(app).toContain('hrefForNav={pathForNav}');
    expect(app).not.toContain('HomePlaceholder');
    expect(app).toContain('Dashboard');
    expect(app).toContain('navFromPath');
    expect(app).toContain('pathForNav');
    expect(app).not.toContain('app-nav__tab');
    expect(app).not.toContain('className="app-nav"');
    expect(app).not.toContain("useState<CatalogTab>");
  });

  it('App.tsx still routes all former catalog screens', () => {
    const app = readFileSync(appTsxPath, 'utf8');
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
    expect(app).toContain("navId === 'materials'");
    expect(app).toContain("navId === 'edges'");
    expect(app).toContain("navId === 'hardware'");
    expect(app).toContain("navId === 'optionGroups'");
    expect(app).toContain("navId === 'showcase'");
    expect(app).toContain("navId === 'modules'");
    expect(app).toContain("navId === 'projects'");
    expect(app).toContain("navId === 'home'");
    expect(app).toContain('ModuleShowcase');
  });

  it('App.tsx wires Dashboard home with open-from-outside props (F023)', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('dashboardStats');
    expect(app).toContain('dashboardRecent');
    expect(app).toContain('onDashboardOpenProject');
    expect(app).toContain('onDashboardNewProject');
    expect(app).toContain('onDashboardNewModule');
    expect(app).toContain('onDashboardNewMaterial');
    expect(app).toContain('projectsCount={projects.length}');
    expect(app).toContain('openProjectId={routeProjectId}');
    expect(app).toContain('openModuleId={routeModuleId}');
    expect(app).toContain('requestCreateKey={projectsCreateKey}');
    expect(app).toContain('requestCreateKey={modulesCreateKey}');
    expect(app).toContain('requestCreateKey={materialsCreateKey}');
    expect(app).toContain('sumMonthlyQuotedTotal');
    expect(app).toContain('selectRecentProjects');
  });

  it('optionGroups nav mounts only OptionGroupsScreen (no OPT-05 demo)', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).not.toContain('ModulePricePreviewDemo');
    expect(app).not.toContain('price-preview-demo');
    expect(app).not.toContain('Demo preview de precio');
  });
});

describe('web shell login gate (Slice E)', () => {
  it('App.tsx imports LoginScreen and gates session before AppShell', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('LoginScreen');
    expect(app).toContain('SessionGate');
    expect(app).toContain('readSessionMode');
    expect(app).toContain('loginRequest');
    expect(app).toContain('writeSessionMode');
    expect(app).toContain('storeAuthToken');
    expect(app).toContain('session === null');
    expect(app).toContain('onGuestAccess={handleGuestAccess}');
    expect(app).toContain('onLogin={handleLogin}');
    expect(app).toContain("writeSessionMode('guest')");
    expect(app).toContain("writeSessionMode('auth')");
    // Seed workspace still used for guest AND auth (API workspace sync later)
    expect(app).toContain('createSeedWorkspace()');
  });

  it('App.tsx wires RegisterScreen and admin UsersScreen', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('RegisterScreen');
    expect(app).toContain('registerRequest');
    expect(app).toContain('UsersScreen');
    expect(app).toContain('showAdminUsers');
    expect(app).toContain('isAdminRole');
    expect(app).toContain('storeAuthUser');
    expect(app).toContain("authGate === 'register'");
  });

  it('session helpers module exists with token, user and auth routes', () => {
    const sessionPath = join(here, 'session.ts');
    const session = readFileSync(sessionPath, 'utf8');
    expect(session).toContain('muebles_session');
    expect(session).toContain('muebles_token');
    expect(session).toContain('muebles_user');
    expect(session).toContain('/auth/login');
    expect(session).toContain('/auth/register');
    expect(session).toContain('http://localhost:8080/api');
  });
});

describe('web shell logout (Slice F)', () => {
  it('App.tsx wires onLogout from SessionGate through AppShell and clearSession', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('clearSession');
    expect(app).toContain('handleLogout');
    expect(app).toContain('onLogout={onLogout}');
    expect(app).toContain('onLogout={handleLogout}');
    expect(app).toContain('setSession(null)');
  });
});

describe('web shell Toast wiring (F019)', () => {
  it('App root wraps content with ToastProvider and useToast', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    expect(app).toContain('ToastProvider');
    expect(app).toContain('useToast');
    expect(app).toContain('<ToastProvider>');
    expect(app).toContain('const { toast } = useToast()');
  });

  it('fires success toast on material create and Optimizer export success', () => {
    const app = readFileSync(appTsxPath, 'utf8');
    // design.md §4.4: create material → success with code; similar to "Creado correctamente"
    expect(app).toMatch(/toast\(\{\s*type:\s*'success',\s*message:\s*`✓ "\$\{code\}" creado`/);
    expect(app).toContain("message: '✓ Cambios guardados'");
    // Export success toast (browser download or Electron save); validation stays inline
    expect(app).toContain('deliverExcelFile');
    expect(app).toMatch(/\$\{result\.fileName\} descargado/);
    expect(app).toMatch(/\$\{result\.fileName\} guardado/);
    expect(app).toContain('setExportErrors(result.issues)');
    expect(app).toContain('// Validation issues stay inline');
  });
});
