/**
 * @vitest-environment jsdom
 *
 * #642: the Inicio home wiring must not present guest/local sessions as an
 * endless commercial "Cargando…". The composition under test is the REAL one:
 * the adapter ShellView spreads into the Dashboard, fed with the dataset
 * states the hook really produces, rendered through the real Dashboard.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Dashboard } from '@granete/ui';
import type { ProjectCommercialSummary } from '@granete/storage';
import { homeCommercialSummariesProps } from './homeCommercialSummaries';
import type { ProjectsCommercialSummaries } from './projectsCommercialSummaries';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** What useProjectsCommercialSummaries returns when there is no token. */
const idleDataset: ProjectsCommercialSummaries = { kind: 'idle' };

const guestRecent = [
  { id: 'prj-1', name: 'Cocina Local', customerLabel: 'Ana López' },
];

function renderHome(
  props: ReturnType<typeof homeCommercialSummariesProps>,
): HTMLElement {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(Dashboard, {
        stats: {
          activeProjects: 1,
          monthlyQuotedTotal: 0,
          modulesCount: 2,
          activeMaterials: 2,
        },
        recentProjects: guestRecent,
        onOpenProject: () => {},
        ...props,
      }),
    );
  });
  return container;
}

describe('Inicio wiring — guest/local commercial dataset (#642)', () => {
  it('guest (hook idle, no request in flight) is an explicit limitation, never an endless “Cargando…”', () => {
    const props = homeCommercialSummariesProps('guest', idleDataset);
    // Wiring contract: without a remote session there is no dataset to wait
    // for — the state must say so, not impersonate an in-flight request.
    expect(props.commercialSummariesStatus).toBe('unavailable');
    expect(props.commercialSummaries).toBeUndefined();
    // No retry can legitimately query without a token.
    expect(props.onRetryCommercialSummaries).toBeUndefined();

    const container = renderHome(props);
    const card = container.querySelector(
      '[data-testid="dashboard-recent-prj-1"]',
    );
    expect(card).toBeTruthy();
    expect(card?.textContent).not.toContain('Cargando…');
    // No authoritative answer exists → never claim "Sin cotización".
    expect(card?.textContent).not.toContain('Sin cotización');
    // No commercial price from legacy data.
    expect(card?.textContent).not.toContain('$');
    // Navigation identity is kept.
    expect(card?.textContent).toContain('Cocina Local');
    // The remote limitation is explicit on the surface…
    expect(
      container
        .querySelector('[data-testid="commercial-summaries-unavailable"]')
        ?.textContent,
    ).toMatch(/sesi[oó]n/i);
    // …and offers no retry button.
    expect(
      container.querySelector(
        '[data-testid="commercial-summaries-unavailable"] button',
      ),
    ).toBeNull();
  });

  it('an auth session with the token still pending stays a real loading', () => {
    // Auth will query as soon as the token exists; idle there is a transient
    // in-flight-like state, NOT the definitive local mode of a guest session.
    const props = homeCommercialSummariesProps('auth', idleDataset);
    expect(props.commercialSummariesStatus).toBe('loading');
    expect(props.onRetryCommercialSummaries).toBeUndefined();
  });

  it('guest → auth transition swaps the limitation for the authoritative dataset', () => {
    const summaries = new Map<string, ProjectCommercialSummary>([
      [
        'prj-1',
        {
          projectId: 'prj-1',
          projectName: 'Cocina Local',
          customerId: 'cus-1',
          customerName: 'Ana López',
          currency: 'MXN',
          quoteStatus: 'accepted',
          quoteRevisionId: 'qr-1',
          quoteRevisionNumber: 1,
          activeDraftRevisionNumber: null,
          isLegacy: false,
          saleTotal: 650,
          furnitureQuantity: 3,
          commercialActivityAt: '2026-09-20T12:00:00.000Z',
        },
      ],
    ]);
    const retry = () => {};
    const readyDataset: ProjectsCommercialSummaries = {
      kind: 'ready',
      summaries,
      retry,
    };
    expect(
      homeCommercialSummariesProps('guest', readyDataset).commercialSummariesStatus,
    ).toBe('unavailable');
    const authProps = homeCommercialSummariesProps('auth', readyDataset);
    expect(authProps.commercialSummariesStatus).toBe('ready');
    expect(authProps.commercialSummaries).toBe(summaries);
    expect(authProps.onRetryCommercialSummaries).toBe(retry);

    const container = renderHome(authProps);
    const card = container.querySelector(
      '[data-testid="dashboard-recent-prj-1"]',
    );
    expect(card?.textContent).toContain('Q1 · Aceptada');
    expect(card?.textContent).toContain('$650.00 MXN');
    expect(
      container.querySelector('[data-testid="commercial-summaries-unavailable"]'),
    ).toBeNull();
  });
});
