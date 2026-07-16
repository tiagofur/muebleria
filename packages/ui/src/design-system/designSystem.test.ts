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

    // Compact density (issue #49)
    expect(css).toContain('--density-table-pad-y:');
    expect(css).toContain('--density-page-gap:');
    expect(css).toContain('--density-modal-body:');
    expect(css).toContain('--density-card-pad:');
    expect(css).toContain('--density-row-min-height:');
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
