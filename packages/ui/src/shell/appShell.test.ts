/**
 * F017 — AppShell layout structure, nav map, and collapse CSS.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FileText,
  LayoutDashboard,
  Layers,
  Minus,
  Package,
  Settings2,
  ToggleLeft,
  Users,
} from 'lucide-react';
import {
  APP_NAV_SECTIONS,
  labelForNavId,
  resolveNavSections,
} from './AppShell';

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

describe('AppShell nav model (F017)', () => {
  it('exposes TRABAJO and CONFIG sections with required destinations', () => {
    expect(APP_NAV_SECTIONS.map((s) => s.id)).toEqual(['trabajo', 'config']);
    expect(APP_NAV_SECTIONS.map((s) => s.label)).toEqual([
      'TRABAJO',
      'CONFIG',
    ]);

    const trabajo = APP_NAV_SECTIONS.find((s) => s.id === 'trabajo')!;
    const config = APP_NAV_SECTIONS.find((s) => s.id === 'config')!;

    expect(trabajo.items.map((i) => i.id)).toEqual([
      'home',
      'projects',
      'customers',
      'modules',
    ]);
    expect(trabajo.items.map((i) => i.label)).toEqual([
      'Inicio',
      'Cotizaciones',
      'Clientes',
      'Muebles',
    ]);

    expect(config.items.map((i) => i.id)).toEqual([
      'materials',
      'edges',
      'hardware',
      'optionGroups',
    ]);
    expect(config.items.map((i) => i.label)).toEqual([
      'Materiales',
      'Cantos',
      'Herrajes',
      'Grupos',
    ]);
  });

  it('maps Lucide icons per design.md §3.7', () => {
    const byId = Object.fromEntries(
      APP_NAV_SECTIONS.flatMap((s) => s.items).map((i) => [i.id, i.icon]),
    );

    expect(byId.home).toBe(LayoutDashboard);
    expect(byId.projects).toBe(FileText);
    expect(byId.customers).toBe(Users);
    expect(byId.modules).toBe(Package);
    expect(byId.materials).toBe(Layers);
    expect(byId.edges).toBe(Minus);
    expect(byId.hardware).toBe(Settings2);
    expect(byId.optionGroups).toBe(ToggleLeft);
  });

  it('labelForNavId resolves known destinations', () => {
    expect(labelForNavId('home')).toBe('Inicio');
    expect(labelForNavId('projects')).toBe('Cotizaciones');
    expect(labelForNavId('customers')).toBe('Clientes');
    expect(labelForNavId('optionGroups')).toBe('Grupos');
    expect(labelForNavId('users')).toBe('Usuarios');
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

  it('active item uses is-active and Lucide strokeWidth 1.5', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('is-active');
    expect(tsx).toContain('strokeWidth={1.5}');
    expect(tsx).toContain('size={16}');
  });

  it('accepts headerActions and onLogout Salir control in topbar', () => {
    const tsx = read('AppShell.tsx');
    expect(tsx).toContain('headerActions');
    expect(tsx).toContain('onLogout');
    expect(tsx).toContain('app-topbar__actions');
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
    expect(css).toContain('var(--surface-app)');
    expect(css).toContain('var(--brand-400)');
    expect(css).toContain('var(--text-inverse)');
    expect(css).toContain('var(--shadow-sm)');
    expect(css).toMatch(/width:\s*240px/);
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
});
