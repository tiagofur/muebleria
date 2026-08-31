/**
 * @vitest-environment jsdom
 *
 * F017 — AppShell layout structure, nav map, and collapse CSS.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileText,
  Factory,
  Hammer,
  LayoutDashboard,
  Layers,
  ListChecks,
  Minus,
  Package,
  Settings,
  Settings2,
  Store,
  ToggleLeft,
  Truck,
  Users,
} from 'lucide-react';
import {
  APP_NAV_SECTIONS,
  AppShell,
  areaContextForNavId,
  labelForNavId,
  resolveNavSections,
} from './AppShell';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

describe('AppShell nav model (F017)', () => {
  it('exposes TRABAJO, VENTAS, PRODUCCIÓN, INGENIERIA, ALMACEN, LIBRERIA, CATÁLOGOS and CONFIG sections', () => {
    expect(APP_NAV_SECTIONS.map((s) => s.id)).toEqual(['trabajo', 'ventas', 'produccion', 'ingenieria', 'almacen', 'libreria', 'catalogos', 'config']);
    expect(APP_NAV_SECTIONS.map((s) => s.label)).toEqual([
      'TRABAJO',
      'VENTAS',
      'PRODUCCIÓN',
      'INGENIERÍA',
      'COMPRAS / ALMACÉN',
      'LIBRERÍA',
      'CATÁLOGOS',
      'CONFIG',
    ]);

    const trabajo = APP_NAV_SECTIONS.find((s) => s.id === 'trabajo')!;
    const produccion = APP_NAV_SECTIONS.find((s) => s.id === 'produccion')!;
    const ventas = APP_NAV_SECTIONS.find((s) => s.id === 'ventas')!;
    const ingenieria = APP_NAV_SECTIONS.find((s) => s.id === 'ingenieria')!;
    const libreria = APP_NAV_SECTIONS.find((s) => s.id === 'libreria')!;
    const catalogos = APP_NAV_SECTIONS.find((s) => s.id === 'catalogos')!;
    const config = APP_NAV_SECTIONS.find((s) => s.id === 'config')!;

    expect(trabajo.items.map((i) => i.id)).toEqual([
      'home',
      'plantBoard',
    ]);

    // Ordering rule: dashboard first, then general → specific following the
    // workshop process (Órdenes → Producción → Instalaciones).
    // Embarques moved to ALMACÉN (2026-08-18): logistics responsibility.
    expect(produccion.items.map((i) => i.id)).toEqual([
      'productionDashboard',
      'orders',
      'production',
      'installations',
    ]);
    expect(produccion.items.map((i) => i.label)).toEqual([
      'Dashboard Producción',
      'Órdenes',
      'Producción',
      'Instalaciones',
    ]);

    expect(ventas.items.map((i) => i.id)).toEqual([
      'salesDashboard',
      'quotes',
      'customers',
      'showcase',
    ]);

    expect(ingenieria.items.map((i) => i.id)).toEqual([
      'engineeringDashboard',
      'engineering',
    ]);
    expect(ingenieria.items.map((i) => i.label)).toEqual([
      'Dashboard Ingeniería',
      'Ingeniería',
    ]);

    const almacen = APP_NAV_SECTIONS.find((s) => s.id === 'almacen')!;
    expect(almacen.items.map((i) => i.id)).toEqual([
      'warehouseDashboard',
      'warehouse',
      'shipments',
    ]);
    expect(almacen.items.map((i) => i.label)).toEqual([
      'Dashboard Almacén',
      'Almacén',
      'Embarques',
    ]);

    expect(libreria.items.map((i) => i.id)).toEqual([
      'modules',
      'structures',
      'addOns',
      'components',
      'optionGroups',
    ]);
    expect(libreria.items.map((i) => i.label)).toEqual([
      'Muebles',
      'Estructuras',
      'Agregados',
      'Componentes',
      'Grupos',
    ]);

    expect(catalogos.items.map((i) => i.id)).toEqual([
      'materials',
      'edges',
      'hardware',
      'finishes',
    ]);

    expect(config.items.map((i) => i.id)).toEqual([
      'settings',
    ]);
  });

  it('maps Lucide icons per design.md §3.7', () => {
    const byId = Object.fromEntries(
      APP_NAV_SECTIONS.flatMap((s) => s.items).map((i) => [i.id, i.icon]),
    );

    expect(byId.home).toBe(LayoutDashboard);
    expect(byId.quotes).toBe(FileText);
    expect(byId.customers).toBe(Users);
    expect(byId.showcase).toBe(Store);
    expect(byId.production).toBe(Factory);
    expect(byId.shipments).toBe(Truck);
    expect(byId.installations).toBe(Hammer);
    expect(byId.orders).toBe(ListChecks);
    expect(byId.modules).toBe(Package);
    expect(byId.materials).toBe(Layers);
    expect(byId.edges).toBe(Minus);
    expect(byId.hardware).toBe(Settings2);
    expect(byId.optionGroups).toBe(ToggleLeft);
    expect(byId.settings).toBe(Settings);
  });

  it('labelForNavId resolves known destinations', () => {
    expect(labelForNavId('home')).toBe('Inicio');
    expect(labelForNavId('quotes')).toBe('Cotizaciones');
    expect(labelForNavId('customers')).toBe('Clientes');
    expect(labelForNavId('showcase')).toBe('Vitrina');
    expect(labelForNavId('production')).toBe('Producción');
    expect(labelForNavId('shipments')).toBe('Embarques');
    expect(labelForNavId('installations')).toBe('Instalaciones');
    expect(labelForNavId('orders')).toBe('Órdenes');
    expect(labelForNavId('modules')).toBe('Muebles');
    expect(labelForNavId('optionGroups')).toBe('Grupos');
    expect(labelForNavId('settings')).toBe('Ajustes');
    expect(labelForNavId('users')).toBe('Usuarios');
  });

  it('CATÁLOGOS section contains catalog items', () => {
    const catalogos = APP_NAV_SECTIONS.find((s) => s.id === 'catalogos')!;
    expect(catalogos.items.map((i) => i.id)).toEqual([
      'materials',
      'edges',
      'hardware',
      'finishes',
    ]);
  });

  it('resolveNavSections appends Usuarios only when showAdminUsers', () => {
    const base = resolveNavSections(false);
    const configBase = base.find((s) => s.id === 'config')!;
    expect(configBase.items.map((i) => i.id)).not.toContain('users');

    const admin = resolveNavSections(true);
    const configAdmin = admin.find((s) => s.id === 'config')!;
    expect(configAdmin.items.map((i) => i.id)).toContain('users');
    expect(configAdmin.items.at(-1)?.label).toBe('Usuarios');
  });

  it('resolveNavSections filters by allowedNavIds (F035)', () => {
    const prod = resolveNavSections({
      allowedNavIds: new Set(['home', 'quotes']),
    });
    expect(prod.flatMap((s) => s.items.map((i) => i.id))).toEqual([
      'home',
      'quotes',
    ]);
  });
});

describe('AppShell source structure (F017)', () => {
  it('renders sidebar + topbar + content (no horizontal tabs)', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('className="app-layout"');
    expect(tsx).toContain('app-sidebar');
    expect(tsx).toContain('app-topbar');
    expect(tsx).toContain('app-content');
    expect(tsx).toContain('app-topbar__menu');
    expect(tsx).toContain('Menu');
    expect(tsx).not.toContain('app-nav__tab');
  });

  it('uses BrandMark instead of emoji logo (issue #53)', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('BrandMark');
    expect(tsx).not.toContain('🪑');
  });

  it('auto-scrolls the active sidebar item into view on navigation', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('scrollIntoView');
    expect(tsx).toContain('[aria-current="page"]');
    expect(tsx).toContain('typeof active.scrollIntoView');
  });

  it('persists sidebar scroll position across navigations', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('savedScrollRef');
    expect(tsx).toContain('nav.scrollTop = saved');
    expect(tsx).toContain('savedScrollRef.current = nav.scrollTop');
  });

  it('active item uses is-active and Lucide strokeWidth 1.5', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('is-active');
    expect(tsx).toContain('strokeWidth={1.5}');
    expect(tsx).toContain('size={16}');
  });

  it('accepts headerActions, command search trigger and onLogout Salir control in topbar', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('headerActions');
    expect(tsx).toContain('onLogout');
    expect(tsx).toContain('app-topbar__actions');
    expect(tsx).toContain('app-topbar__search-trigger');
    expect(tsx).toContain('app-topbar__logout');
    expect(tsx).toContain('Salir');
    expect(tsx).toContain('LogOut');
  });
});

describe('AppShell CSS (F017)', () => {
  it('uses design tokens for sidebar, topbar, active brand border', () => {
    const css = read('appShell.css');
    expect(css).toContain('var(--surface-sidebar)');
    expect(css).toContain('var(--surface-card)');
    expect(css).toContain('var(--area-canvas)');
    expect(css).toContain('var(--brand-400)');
    expect(css).toContain('var(--text-inverse)');
    expect(css).toContain('var(--shadow-sm)');
    expect(css).toMatch(/width:\s*260px/);
    expect(css).toMatch(/height:\s*56px/);
    expect(css).toContain('.app-sidebar__item.is-active');
    expect(css).toContain('border-left-color: var(--brand-400)');
    expect(css).toContain('.app-topbar__actions');
    expect(css).toContain('.app-topbar__logout');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('collapses sidebar below 900px with hamburger menu visible', () => {
    const css = read('appShell.css');
    expect(css).toContain('@media (max-width: 899px)');
    expect(css).toContain('translateX(-100%)');
    expect(css).toContain('.app-sidebar.is-open');
    expect(css).toContain('.app-topbar__menu');
    expect(css).toMatch(
      /\.app-topbar__menu\s*\{[\s\S]*?display:\s*none/,
    );
    expect(css).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.app-topbar__menu\s*\{[\s\S]*?display:\s*inline-flex/,
    );
  });

  it('avoids hard-coded prototype colors', () => {
    const css = read('appShell.css');
    expect(css).not.toContain('#1a73e8');
    expect(css).not.toContain('#f0f2f5');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('styles the sidebar scrollbar thin and dark to match the sidebar theme', () => {
    const css = read('appShell.css');
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toContain('scrollbar-color:');
    expect(css).toContain('::-webkit-scrollbar');
    expect(css).toContain('::-webkit-scrollbar-thumb');
  });
});

describe('AppShell session identity (issue #29)', () => {
  it('renders identity block for auth and guest in source', () => {
    const src = read('AppShell.tsx');
    expect(src).toMatch(/sessionMode/);
    expect(src).toMatch(/app-session-identity/);
    expect(src).toMatch(/WifiOff/);
    expect(src).toMatch(/roleLabel/);
  });

  it('styles identity with design tokens', () => {
    const css = read('appShell.css');
    expect(css).toMatch(/\.app-topbar__identity/);
    expect(css).toMatch(/var\(--surface-card\)/);
    expect(css).toMatch(/var\(--text-secondary\)/);
  });

  it('presents authoritative organization identity and a controlled accessible switcher', async () => {
    let releaseSwitch!: () => void;
    const onOrganizationChange = vi.fn(() => new Promise<void>((resolve) => { releaseSwitch = resolve; }));
    const first = {
      id: 'org-1', name: 'Taller Norte', type: 'factory' as const, status: 'active' as const,
      license: { plan: 'pro', status: 'expired' },
    };
    const second = {
      id: 'org-2', name: 'Tienda Centro', type: 'store' as const, status: 'active' as const,
      license: { plan: 'trial', status: 'active' },
    };
    const props = {
      activeId: 'home' as const,
      onNavigate: vi.fn(),
      children: createElement('main'),
      sessionMode: 'auth' as const,
      user: { email: 'ana@example.com', roles: ['admin', 'vendedor'] },
      organization: first,
      organizationChoices: [
        { status: 'active', organization: first },
        { status: 'active', organization: second },
      ],
      onOrganizationChange,
    };
    const { rerender } = render(createElement(AppShell, props));
    const actor = userEvent.setup();
    const switcher = screen.getByRole('combobox', { name: 'Cambiar organización' });

    expect(screen.getByLabelText('Organización activa').textContent).toContain('Taller Norte');
    expect(screen.getByLabelText('Organización activa').textContent).toContain('Fábrica · Activa · Plan pro · Licencia vencida');
    expect(screen.getByTestId('app-session-identity').textContent).toContain('Admin');
    expect(screen.getByTestId('app-session-identity').textContent).toContain('Vendedor');
    switcher.focus();
    expect(document.activeElement).toBe(switcher);
    await actor.selectOptions(switcher, 'org-2');

    expect(onOrganizationChange).toHaveBeenCalledWith('org-2');
    expect(screen.getByLabelText('Organización activa').textContent).toContain('Taller Norte');
    rerender(createElement(AppShell, { ...props, organizationSwitchLoading: true }));
    expect((screen.getByRole('combobox', { name: 'Cambiar organización' }) as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Cambiando');
    releaseSwitch();
  });

  it('hides switching without two active choices and announces support/errors', () => {
    const organization = {
      id: 'org-1', name: 'Taller Norte', type: 'factory' as const, status: 'active' as const,
      license: { plan: 'pro', status: 'active' },
    };
    render(createElement(AppShell, {
      activeId: 'home', onNavigate: vi.fn(), children: createElement('main'),
      sessionMode: 'support', user: { email: 'staff@example.com', roles: ['admin'] },
      organization, organizationChoices: [{ status: 'active', organization }],
      organizationSwitchError: 'La organización cambió en otra pestaña',
      onOrganizationChange: vi.fn(),
    }));

    expect(screen.queryByRole('combobox', { name: 'Cambiar organización' })).toBeNull();
    expect(screen.getByText('Soporte')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('otra pestaña');
  });

  it('offers an accessible authoritative organization refresh after revoked access', async () => {
    const onRefresh = vi.fn();
    render(createElement(AppShell, {
      activeId: 'home', onNavigate: vi.fn(), children: createElement('main'),
      sessionMode: 'auth', organizationSwitchError: 'Tu acceso fue revocado.',
      onOrganizationChoicesRefresh: onRefresh,
    }));

    expect(screen.getByRole('alert').textContent).toContain('revocado');
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar talleres' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('presents guest mode without leaking organization identity or switching', () => {
    const organization = {
      id: 'org-1', name: 'Taller Norte', type: 'factory' as const, status: 'suspended' as const,
      license: { plan: 'pro', status: 'expired' },
    };
    const { rerender } = render(createElement(AppShell, {
      activeId: 'home', onNavigate: vi.fn(), children: createElement('main'),
      sessionMode: 'guest', organization,
      organizationChoices: [{ status: 'active', organization }],
      onOrganizationChange: vi.fn(),
    }));

    expect(screen.getByTestId('app-session-identity').textContent).toContain('Invitado');
    expect(screen.getByTestId('app-session-identity').textContent).toContain('Modo local');
    expect(screen.queryByLabelText('Organización activa')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Cambiar organización' })).toBeNull();

    rerender(createElement(AppShell, {
      activeId: 'home', onNavigate: vi.fn(), children: createElement('main'), sessionMode: 'auth',
      user: { email: 'ana@example.com', roles: ['admin'] }, organization,
    }));
    expect(screen.getByLabelText('Organización activa').textContent).toContain('Suspendida · Plan pro · Licencia vencida');
  });
});


afterEach(() => cleanup());

type HslColor = readonly [number, number, number];

function readAreaToken(area: string, role: string): HslColor {
  const tokens = read('../design-system/tokens.css');
  const match = tokens.match(
    new RegExp(`--area-${area}-${role}: hsl\\((\\d+) (\\d+)% (\\d+)%\\)`),
  );
  if (!match) throw new Error(`Missing area token: ${area}-${role}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function relativeLuminance([hue, saturation, lightness]: HslColor): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const [r, g, b] =
    huePrime < 1 ? [chroma, x, 0]
      : huePrime < 2 ? [x, chroma, 0]
        : huePrime < 3 ? [0, chroma, x]
          : huePrime < 4 ? [0, x, chroma]
            : huePrime < 5 ? [x, 0, chroma]
              : [chroma, 0, x];
  const offset = l - chroma / 2;
  const channel = (value: number): number => {
    const srgb = value + offset;
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground: HslColor, background: HslColor): number {
  const [first, second] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (first! + 0.05) / (second! + 0.05);
}

describe('AppShell tonal area context (F100)', () => {
  it.each([
    ['sales', 'quotes'],
    ['eng', 'engineering'],
    ['library', 'modules'],
    ['library', 'materials'],
    ['work', 'production'],
    ['warehouse', 'warehouse'],
    ['warehouse', 'shipments'],
    ['warehouse', 'warehouseDashboard'],
    ['neutral', 'home'],
    ['neutral', 'settings'],
  ] as const)('renders %s context for %s navigation', (expected, activeId) => {
    const { container } = render(
      createElement(
        AppShell,
        {
          activeId,
          onNavigate: () => undefined,
          children: createElement('div', null, 'Contenido de prueba'),
        },
      ),
    );

    expect(
      container.querySelector('.app-layout')?.getAttribute('data-area-context'),
    ).toBe(expected);
    expect(areaContextForNavId(activeId)).toBe(expected);
  });

  it('uses the semantic context aliases in the shared chrome and canvas', () => {
    const css = read('appShell.css');
    expect(css).toContain('background: var(--area-canvas)');
    expect(css).toContain('background: var(--area-chrome)');
    expect(css).toContain('border-bottom: 1px solid var(--area-border)');
  });

  it('calculates all area ink contrast pairs at WCAG AA or higher', () => {
    const ratios = Object.fromEntries(
      ['sales', 'eng', 'library', 'work', 'warehouse', 'neutral'].flatMap((area) =>
        ['canvas', 'chrome', 'container', 'selected'].map((surface) => [
          `${area}/${surface}`,
          contrastRatio(readAreaToken(area, 'ink'), readAreaToken(area, surface)),
        ]),
      ),
    ) as Record<string, number>;

    expect(ratios).toMatchObject({
      'sales/canvas': expect.closeTo(6.52, 2),
      'sales/chrome': expect.closeTo(6.22, 2),
      'sales/container': expect.closeTo(5.87, 2),
      'sales/selected': expect.closeTo(6.1, 2),
      'eng/canvas': expect.closeTo(10.98, 2),
      'eng/chrome': expect.closeTo(9.86, 2),
      'eng/container': expect.closeTo(8.87, 2),
      'eng/selected': expect.closeTo(9.58, 2),
      'library/canvas': expect.closeTo(7.38, 2),
      'library/chrome': expect.closeTo(7.01, 2),
      'library/container': expect.closeTo(6.59, 2),
      'library/selected': expect.closeTo(6.85, 2),
      'work/canvas': expect.closeTo(7.49, 2),
      'work/chrome': expect.closeTo(7.01, 2),
      'work/container': expect.closeTo(6.54, 2),
      'work/selected': expect.closeTo(6.85, 2),
      'warehouse/canvas': expect.closeTo(9.00, 2),
      'warehouse/chrome': expect.closeTo(8.43, 2),
      'warehouse/container': expect.closeTo(7.87, 2),
      'warehouse/selected': expect.closeTo(8.24, 2),
      'neutral/canvas': expect.closeTo(10.54, 2),
      'neutral/chrome': expect.closeTo(9.75, 2),
      'neutral/container': expect.closeTo(9.54, 2),
      'neutral/selected': expect.closeTo(9.77, 2),
    });
    expect(Object.values(ratios).every((ratio) => ratio >= 4.5)).toBe(true);
  });

  it('calibrates canvas/chrome tints to a perceivable-but-calm intensity (F107)', () => {
    // A 97% lightness the canvas reads as neutral gray in live inspection;
    // the calibration bounds keep the tint perceivable (canvas L<=95.5 with
    // raised chroma, chrome one step above canvas) without tinting work
    // surfaces: container/selected stay at their original steps.
    for (const area of ['sales', 'eng', 'library', 'work', 'warehouse', 'neutral']) {
      const canvas = readAreaToken(area, 'canvas');
      const chrome = readAreaToken(area, 'chrome');
      const container = readAreaToken(area, 'container');

      expect(canvas[2], `${area} canvas lightness`).toBeLessThanOrEqual(95.5);
      expect(canvas[1], `${area} canvas chroma`).toBeGreaterThan(15);
      expect(chrome[2], `${area} chrome lightness`).toBeLessThanOrEqual(92.5);
      expect(chrome[2], `${area} chrome below canvas`).toBeLessThan(canvas[2]);
      expect(chrome[2], `${area} chrome above container`).toBeGreaterThan(container[2]);
    }

    // Work surfaces, primary actions and semantic states stay untouched:
    // the calibrated roles never leak into neutral surfaces or brand tokens.
    const tokens = read('../design-system/tokens.css');
    expect(tokens).toContain('--surface-app: hsl(220 20% 97%)');
    expect(tokens).toContain('--surface-card: hsl(0 0% 100%)');
    expect(tokens).toContain('--brand-500: hsl(245 58% 51%)');
    expect(tokens).toContain('--warning-500: hsl(38 92% 50%)');
  });

  it('resolveNavSections reduced surface for small workshops (OC-092)', () => {
    const simplified = resolveNavSections({ navMode: 'simplified' });
    const ids = simplified.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(['home', 'quotes', 'orders', 'installations', 'warehouse', 'settings']);
    // Advanced capabilities (dashboards, library, catalogs) leave the sidebar —
    // they live inside each job or behind departmental mode.
    expect(ids).not.toContain('salesDashboard');
    expect(ids).not.toContain('modules');
    expect(ids).not.toContain('materials');
  });

  it('simplified mode still respects the RBAC allowlist (OC-092)', () => {
    const vendor = resolveNavSections({
      navMode: 'simplified',
      allowedNavIds: new Set(['home', 'quotes', 'showcase', 'settings']),
    });
    const ids = vendor.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(['home', 'quotes', 'settings']);
  });

  it('departmental mode (default) keeps the full surface', () => {
    const departmental = resolveNavSections({ navMode: 'departmental' });
    const ids = departmental.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain('salesDashboard');
    expect(ids).toContain('modules');
  });
});
