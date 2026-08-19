/**
 * F109 — Semantic tabs rollout gate.
 *
 * The app has exactly one tab implementation: common/Tabs.tsx
 * (WorkspaceTabs/WorkflowTabs). This test fails if any screen reintroduces a
 * local tablist or the legacy .tab-bar/.tab-btn classes.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(tsx|css)$/.test(entry) ? [full] : [];
  });
}

const files = walk(srcRoot).filter(
  (file) => !file.includes(join('common', 'tabs.css')),
);

describe('Semantic tabs single implementation (F109)', () => {
  it('has no local role="tablist" outside common/Tabs.tsx', () => {
    const offenders = files.filter((file) => {
      if (file.endsWith(join('common', 'Tabs.tsx'))) return false;
      const source = readFileSync(file, 'utf8');
      // `role="tablist"` as markup; `[role="tablist"]` selectors are allowed
      // (keyboard guards that defer to the shared tablist).
      return /(?<!\[)role="tablist"/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('has no legacy tab-btn/tab-bar classes in markup or CSS', () => {
    const offenders = files.filter((file) =>
      /['"} ]tab-btn|\.tab-btn|\.tab-bar\b|['"} ]tab-bar['"} ]/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
