/**
 * @vitest-environment jsdom
 *
 * #738 — the Engineering workspace with an EXACT pinned release context:
 * the header names the liberation the screen was opened with (never the
 * server's implicit "latest"), the honest preparation status is pending or
 * unverified, live data tabs are separated from frozen release content and
 * live-data document exports are NOT offered as release documents (#739
 * owns the frozen despiece/exports).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@granete/domain';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

import { EngineeringWorkspace } from './EngineeringWorkspace';

afterEach(cleanup);

function makeCanonicalProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina Liberada',
    customerId: 'c1',
    status: 'draft',
    currency: 'MXN',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    items: [],
    resolvedProductionRelease: {
      source: 'canonical',
      releaseId: 'rel-1',
      releaseNumber: 1,
      designRevisionId: 'dr-2',
      designRevisionNumber: 2,
      quoteRevisionId: 'qr-2',
    },
    ...overrides,
  } as unknown as Project;
}

const baseProps = {
  project: makeCanonicalProject(),
  modules: [],
  catalog: null,
  cutRows: [],
  labels: [],
  hardwareRows: [],
  readiness: {
    cutListOk: true,
    cutListError: null,
    cutRowCount: 3,
    moduleUnitCount: 3,
    moduleLineCount: 3,
    materialsResolved: true,
    hasKitchenLayout: false,
    hasPlacements: false,
    layoutCheckOk: true,
    optimizerGenerable: true,
    packGenerable: true,
    readyToCut: true,
    hasUnplacedItems: false,
  } satisfies ProductionOrderReadiness,
  onBack: () => undefined,
};

const readyContext = {
  state: 'ready' as const,
  view: {
    releaseNumber: 1,
    designRevisionNumber: 2,
    quoteLabel: 'Q2',
    releasedAt: '2026-09-05T10:00:00Z',
  },
};

describe('EngineeringWorkspace — exact release context (#738)', () => {
  it('shows the pinned release strip and honest pending status', () => {
    render(<EngineeringWorkspace {...baseProps} releaseContext={readyContext} />);
    const strip = screen.getByTestId('eng-release-context');
    expect(strip.textContent).toContain('Liberación #1');
    expect(strip.textContent).toContain('Diseño R2');
    expect(strip.textContent).toContain('Q2');
    expect(screen.getByTestId('eng-entry-status').textContent).toContain('Pendiente');
    // The implicit authority badge must not compete with the pinned context.
    expect(screen.queryByTestId('eng-canonical-release')).toBeNull();
  });

  it('labels an uncorrelated legacy log as unverified, never completed', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={makeCanonicalProject({
          status: 'accepted',
          engineeringLog: {
            startedBy: 'ing1',
            startedAt: '2026-08-02T08:00:00.000Z',
            generatedBy: 'ing1',
            generatedAt: '2026-08-03T08:00:00.000Z',
            revision: 1,
          },
        })}
        releaseContext={readyContext}
      />,
    );
    expect(screen.getByTestId('eng-entry-status').textContent).toContain(
      'Sin verificar',
    );
    // The legacy log action is not offered for a canonical obra.
    expect(screen.queryByTestId('eng-mark-documented')).toBeNull();
    expect(screen.queryByTestId('eng-send-to-production')).toBeNull();
  });

  it('separates live data tabs from frozen release content', () => {
    render(<EngineeringWorkspace {...baseProps} releaseContext={readyContext} />);
    const notice = screen.getByTestId('eng-live-view-notice');
    expect(notice.textContent).toContain('Vista de trabajo actual');
    expect(notice.textContent).toContain(
      'no desde el contenido congelado de la liberación',
    );
  });

  it('does not offer live-data document downloads as release documents', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        onExportCsv={vi.fn()}
        onExportProductionPack={vi.fn()}
      />,
    );
    // The pure-downloads tab is not part of the canonical workspace.
    expect(screen.queryByRole('tab', { name: 'Documentos' })).toBeNull();
    // Despiece keeps its data view but its CSV export is not wired.
    fireEvent.click(screen.getByRole('tab', { name: 'Despiece' }));
    expect(screen.getByTestId('eng-live-view-notice')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Exportar CSV/i })).toBeNull();
  });

  it('keeps the full legacy workspace without a release context', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={makeCanonicalProject({
          resolvedProductionRelease: undefined,
          status: 'accepted',
        })}
      />,
    );
    expect(screen.queryByTestId('eng-release-context')).toBeNull();
    expect(screen.queryByTestId('eng-live-view-notice')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Documentos' })).not.toBeNull();
  });
});
