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
