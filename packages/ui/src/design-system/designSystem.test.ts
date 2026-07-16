import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '../..');
const packageJsonPath = join(uiRoot, 'package.json');
const tokensPath = join(here, 'tokens.css');
const resetPath = join(here, 'reset.css');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('design system (F016)', () => {
  it('tokens.css exposes required CSS custom property families', () => {
    const css = read(tokensPath);

    const requiredPrefixes = [
      '--brand-',
      '--surface-',
      '--text-',
      '--shadow-',
      '--space-',
      '--radius-',
      '--duration-',
      '--ease-',
    ] as const;

    for (const prefix of requiredPrefixes) {
      expect(css, `missing token family ${prefix}`).toContain(prefix);
    }

    // Spot-check primary tokens used by shell migration
    expect(css).toContain('--brand-500:');
    expect(css).toContain('--surface-app:');
    expect(css).toContain('--font-sans:');
    expect(css).toContain('--duration-fast:');
    expect(css).toContain('--ease-out:');
    // Product motion: no bounce spring (issue #55)
    expect(css).not.toContain('--ease-spring');
    expect(css).not.toMatch(/cubic-bezier\(\s*0\.34\s*,\s*1\.56/);
    expect(css).toContain(
      '--transition-transform: transform var(--duration-normal) var(--ease-out)',
    );

    // Compact density (issue #49)
    expect(css).toContain('--density-table-pad-y:');
    expect(css).toContain('--density-page-gap:');
    expect(css).toContain('--density-modal-body:');
    expect(css).toContain('--density-card-pad:');
    expect(css).toContain('--density-row-min-height:');

    // Canonical breakpoints / touch (issue #34)
    expect(css).toContain('--bp-phone-max:');
    expect(css).toContain('--bp-tablet-min:');
    expect(css).toContain('--bp-desktop-min:');
    expect(css).toContain('--bp-cards-3-min:');
    expect(css).toContain('--touch-min:');
  });

  it('responsive pass: card grids 1/2/3 and table scroll affordance (issue #34)', () => {
    const modules = read(join(uiRoot, 'src/modules/modules.css'));
    const projects = read(join(uiRoot, 'src/projects/projects.css'));
    const catalogs = read(join(uiRoot, 'src/catalogs/catalogs.css'));
    const shell = read(join(uiRoot, 'src/shell/appShell.css'));

    for (const [label, css] of [
      ['module-card-grid', modules],
      ['project-card-grid', projects],
    ] as const) {
      expect(css, label).toContain('grid-template-columns: 1fr');
      expect(css, label).toMatch(/@media \(min-width: 640px\)/);
      expect(css, label).toMatch(/@media \(min-width: 1100px\)/);
      expect(css, label).toContain('repeat(2, minmax(0, 1fr))');
      expect(css, label).toContain('repeat(3, minmax(0, 1fr))');
      // Prefer fixed ladder over unbounded auto-fill on the main list grid
      expect(css, label).not.toMatch(
        new RegExp(
          `\\.${label}\\s*\\{[\\s\\S]{0,160}auto-fill`,
        ),
      );
    }

    expect(catalogs).toContain('overscroll-behavior-x: contain');
    expect(catalogs).toContain('-webkit-overflow-scrolling: touch');
    expect(catalogs).toContain('var(--touch-min)');
    expect(catalogs).toMatch(/@media \(max-width: 639px\)/);
    expect(catalogs).toMatch(/@media \(max-width: 767px\)/);
    expect(shell).toContain('var(--touch-min)');
  });

  it('catalog tables and modals use density tokens (issue #49)', () => {
    const catalogs = read(join(uiRoot, 'src/catalogs/catalogs.css'));
    const modal = read(join(uiRoot, 'src/common/modal.css'));
    expect(catalogs).toContain('var(--density-table-pad-y)');
    expect(catalogs).toContain('var(--density-page-gap)');
    expect(catalogs).toContain('var(--density-btn-pad-y)');
    expect(modal).toContain('var(--density-modal-body)');
    expect(modal).toContain('var(--density-modal-header-y)');
    // No ad-hoc table cell padding left on th/td base rule
    expect(catalogs).not.toMatch(
      /\.catalog-table th,\s*\.catalog-table td\s*\{[^}]*padding:\s*0\.55rem/,
    );
  });

  it('reset.css exists and sets a sensible base on body', () => {
    const css = read(resetPath);
    expect(css).toMatch(/box-sizing:\s*border-box/);
    expect(css).toMatch(/body\s*\{/);
    expect(css).toContain('var(--font-sans');
    expect(css).toContain('var(--surface-app');
  });

  it('package.json depends on lucide-react and exports design-system CSS', () => {
    const pkg = JSON.parse(read(packageJsonPath)) as {
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };

    expect(pkg.dependencies?.['lucide-react']).toBeDefined();
    expect(pkg.exports?.['./design-system/tokens.css']).toBeDefined();
    expect(pkg.exports?.['./design-system/reset.css']).toBeDefined();
  });
});
