/**
 * #642 / 2A: shell wiring contract for the batch commercial summaries.
 *
 * The endpoint, the generated client and the list UI exist, but the product
 * regressed once already by shipping the read model without any consumer.
 * These assertions keep ShellView → ProjectsScreen → ProjectsListView wired:
 * removing the Shell-side consumption fails here, not only in review.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const shellViewSrc = () => readFileSync(join(here, 'ShellView.tsx'), 'utf8');
const hookSrc = () =>
  readFileSync(join(here, 'projectsCommercialSummaries.ts'), 'utf8');
const reconciliationSrc = () =>
  readFileSync(
    join(here, '../../../packages/ui/src/digitalThread/ProjectReconciliationScreen.tsx'),
    'utf8',
  );

describe('#642 / 2A commercial summaries shell wiring', () => {
  it('ShellView feeds ProjectsScreen from one useProjectsCommercialSummaries batch', () => {
    const src = shellViewSrc();
    expect(src).toContain('useProjectsCommercialSummaries({');
    // The hook key comes from the canonical reconciliation keys, session-scoped.
    expect(src).toContain(').commercialSummaries,');
    // All four dataset props reach ProjectsScreen.
    expect(src).toContain('commercialSummaries={');
    expect(src).toContain('commercialSummariesStatus={');
    expect(src).toContain('commercialSummariesError={');
    expect(src).toContain('onRetryCommercialSummaries={');
  });

  it('the hook uses the generated batch client with the canonical query policy', () => {
    const src = hookSrc();
    expect(src).toContain('listProjectCommercialSummaries');
    expect(src).toContain("queryKey: args.queryKey");
    expect(src).toContain('signal');
    expect(src).toContain('retry: false');
    // Dataset states stay explicit: error is never folded into per-project data.
    expect(src).toContain("kind: 'error'");
    expect(src).toContain("kind: 'ready'");
  });

  it('commercial revision transitions invalidate the summaries dataset', () => {
    const src = reconciliationSrc();
    expect(src).toContain('queryKeys.commercialSummaries');
    expect(src).toContain(
      "commercialSummaries: ['project-commercial-summaries', ...scopeKey]",
    );
  });

  it('the list never falls back to legacy estimates as commercial truth', () => {
    const listSrc = readFileSync(
      join(here, '../../../packages/ui/src/projects/components/ProjectsListView.tsx'),
      'utf8',
    );
    expect(listSrc).not.toContain('estimateLabel(project.id)');
    expect(listSrc).not.toContain('project.items.length');
    expect(listSrc).not.toContain('project.updatedAt');
  });

  it('the Inicio recent cards consume the same batch (no second dataset, no legacy truth)', () => {
    const src = shellViewSrc();
    // The home render receives the SAME hook dataset through the pure wiring
    // adapter (session-aware: guest/local maps to the explicit `unavailable`
    // state, never an endless loading).
    expect(src).toContain('<Dashboard');
    expect(src).toContain(
      '{...homeCommercialSummariesProps(session, commercialSummaries)}',
    );
    const adapterSrc = readFileSync(
      join(here, 'homeCommercialSummaries.ts'),
      'utf8',
    );
    // The adapter never invents a second dataset or request: non-auth is
    // `unavailable` with no summaries and no retry.
    expect(adapterSrc).toContain("commercialSummariesStatus: 'unavailable'");
    expect(adapterSrc).toContain('onRetryCommercialSummaries: undefined');
    // The dashboard derivation feeds navigation identity only — commercial
    // fields are resolved from the summaries dataset, not from Project.
    const derivationsSrc = readFileSync(
      join(here, 'derivations/useQuoteDerivations.ts'),
      'utf8',
    );
    expect(derivationsSrc).toContain(
      'selectRecentProjects(projects, 5).map((project) => ({',
    );
    expect(derivationsSrc).not.toContain('salePrice: projectEstimates');
    const dashboardSrc = readFileSync(
      join(here, '../../../packages/ui/src/dashboard/Dashboard.tsx'),
      'utf8',
    );
    expect(dashboardSrc).toContain('resolveCommercialCardIdentity');
    expect(dashboardSrc).toContain('CommercialStatusBadge');
    expect(dashboardSrc).toContain("summary?.saleTotal");
    expect(dashboardSrc).not.toContain('projectStatusBadgeClass');
    expect(dashboardSrc).not.toContain('project.updatedAt');
    expect(dashboardSrc).not.toContain('formatDashboardMoney(project');
  });
});
