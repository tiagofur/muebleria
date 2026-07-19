import { readFileSync, readdirSync, statSync } from 'node:fs';
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

/**
 * Walks every .css file under uiRoot/src and returns those that aren't tests
 * or the tokens file itself. Used to enforce that feature CSS must only
 * reference tokens that exist in tokens.css (F0 UI Fase 0 regression guard).
 */
function listFeatureCss(): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry === 'design-system') continue; // tokens/reset live here
        walk(full);
      } else if (entry.endsWith('.css')) {
        results.push(full);
      }
    }
  };
  walk(join(uiRoot, 'src'));
  return results;
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
    // Since F1 UI sub-fase 1c, table base lives in common/dataTable.css.
    const dataTable = read(join(uiRoot, 'src/common/dataTable.css'));
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

    expect(dataTable).toContain('overscroll-behavior-x: contain');
    expect(dataTable).toContain('-webkit-overflow-scrolling: touch');
    expect(dataTable).toContain('var(--touch-min)');
    expect(dataTable).toMatch(/@media \(max-width: 639px\)/);
    expect(shell).toContain('var(--touch-min)');
  });

  it('catalog tables and modals use density tokens (issue #49)', () => {
    // Since F1 UI sub-fase 1c, table density lives in common/dataTable.css.
    const dataTable = read(join(uiRoot, 'src/common/dataTable.css'));
    const catalogs = read(join(uiRoot, 'src/catalogs/catalogs.css'));
    const modal = read(join(uiRoot, 'src/common/modal.css'));
    const buttons = read(join(uiRoot, 'src/common/buttons.css'));
    expect(dataTable).toContain('var(--density-table-pad-y)');
    expect(catalogs).toContain('var(--density-page-gap)');
    // .btn density lives in common/buttons.css since F0 UI Fase 0
    expect(buttons).toContain('var(--density-btn-pad-y)');
    expect(modal).toContain('var(--density-modal-body)');
    expect(modal).toContain('var(--density-modal-header-y)');
    // No ad-hoc table cell padding left on th/td base rule
    expect(dataTable).not.toMatch(
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
    // F0 UI Fase 0: shared button system CSS is exported
    expect(pkg.exports?.['./common/buttons.css']).toBeDefined();
  });

  it('feature CSS only references tokens that exist in tokens.css (F0 UI Fase 0)', () => {
    const tokensCss = read(tokensPath);
    // Extract every `--<name>` token defined in tokens.css (definitions only,
    // not usages). Definitions look like `--name:` (with a colon right after).
    const definedTokens = new Set<string>();
    const defRegex = /(--[a-z0-9-]+)\s*:/g;
    let m: RegExpExecArray | null;
    while ((m = defRegex.exec(tokensCss)) !== null) {
      const name = m[1];
      if (name) definedTokens.add(name);
    }
    expect(
      definedTokens.size,
      'should have extracted at least 50 tokens',
    ).toBeGreaterThan(50);

    // For each feature CSS, find every var(--x) reference and ensure either:
    //   (a) --x is defined in tokens.css, OR
    //   (b) the reference has an inline fallback `var(--x, …)` (deliberate).
    // Aliases introduced in Fase 0 are defined tokens, so they pass.
    const varRegex = /var\(\s*(--[a-z0-9-]+)\s*(,|\))/g;
    const failures: string[] = [];

    for (const file of listFeatureCss()) {
      const css = read(file);
      let ref: RegExpExecArray | null;
      while ((ref = varRegex.exec(css)) !== null) {
        const token = ref[1];
        const sep = ref[2];
        if (!token || !sep) continue;
        const hasFallback = sep === ',';
        if (!definedTokens.has(token) && !hasFallback) {
          const rel = file.replace(uiRoot + '/src/', '');
          failures.push(`${rel}: var(${token})`);
        }
      }
    }

    expect(
      failures,
      `feature CSS references undefined tokens without fallback:\n  ${failures.join('\n  ')}`,
    ).toEqual([]);
  });

  it('.btn base + modifiers live in common/buttons.css only (F0 UI Fase 0)', () => {
    const buttons = read(join(uiRoot, 'src/common/buttons.css'));
    expect(buttons).toMatch(/^\.btn\s*{/m);
    expect(buttons).toMatch(/^\.btn--primary\s*{/m);
    expect(buttons).toMatch(/^\.btn--ghost\s*{/m);
    expect(buttons).toMatch(/^\.btn--danger\s*{/m);
    expect(buttons).toMatch(/^\.btn--success\s*{/m);
    expect(buttons).toMatch(/^\.btn--small\s*{/m);
    expect(buttons).toMatch(/^\.btn--icon\s*{/m);

    // Feature CSS must NOT redefine .btn base. We allow scoped overrides like
    // `.catalog-picker__apply .btn { … }` but reject a top-level `.btn {` rule.
    const featureFiles = listFeatureCss().filter(
      (f) => !f.endsWith('common/buttons.css'),
    );
    const redefinitions: string[] = [];
    for (const file of featureFiles) {
      const css = read(file);
      // Top-level `.btn {` (selector starts at line beginning, optionally
      // preceded by whitespace; no preceding class/selector on same line).
      if (/^\.btn\s*\{/m.test(css)) {
        const rel = file.replace(uiRoot + '/src/', '');
        redefinitions.push(rel);
      }
    }
    expect(
      redefinitions,
      `.btn base redefined in feature CSS (must live in common/buttons.css only):\n  ${redefinitions.join('\n  ')}`,
    ).toEqual([]);
  });
});
