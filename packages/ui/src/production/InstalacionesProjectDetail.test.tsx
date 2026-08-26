/**
 * @vitest-environment jsdom
 * InstalacionesProjectDetail — el trabajo del proceso de instalación de UNA
 * obra: unidades en camino + panel de job (visitas, incidencias, punch,
 * cierre) con navegación de vuelta a la lista.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { ItemFloorStatus, Project, ProjectItem } from '@granete/domain';

import { InstalacionesProjectDetail } from './InstalacionesProjectDetail';

afterEach(cleanup);

function makeItem(
  id: string,
  floorStatus?: ProjectItem['floorStatus'],
): ProjectItem {
  return { id, moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus };
}

function makeProject(items: ProjectItem[]): Project {
  return {
    id: 'p1',
    name: 'Obra Test',
    customerId: 'c1',
    status: 'produced',
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    items,
    installation: {
      id: 'ijob-1',
      projectId: 'p1',
      visits: [
        {
          id: 'ivis-1',
          date: '2026-09-02',
          crew: ['Juan'],
          status: 'scheduled',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
      fieldIssues: [],
      punchItems: [],
      createdAt: '2026-09-01T10:00:00.000Z',
    },
  } as unknown as Project;
}

function makeHandlers() {
  return {
    onScheduleVisit: vi.fn(),
    onStartVisit: vi.fn(),
    onCompleteVisit: vi.fn(),
    onCancelVisit: vi.fn(),
    onReportIssue: vi.fn(),
    onTransitionIssue: vi.fn(),
    onOpenPunch: vi.fn(),
    onClosePunch: vi.fn(),
    onCompleteInstallation: vi.fn(),
    onSignOff: vi.fn(),
    onCloseProject: vi.fn(),
  };
}

describe('InstalacionesProjectDetail', () => {
  it('shows the project context, the loaded units and the job panel together', () => {
    render(
      <InstalacionesProjectDetail
        project={makeProject([makeItem('a', 'loaded'), makeItem('b', 'installed')])}
        customerName="Cliente X"
        canAdvance
        onAdvance={() => undefined}
        canManageJob
        canCloseout
        jobHandlers={makeHandlers()}
      />,
    );

    expect(screen.getByText('Obra Test')).not.toBeNull();
    expect(screen.getByText('Cliente X')).not.toBeNull();
    // Unidad en camino con su acción de instalación (vive en el detalle):
    expect(screen.getByTestId('instalaciones-install-a')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-advance-a')).not.toBeNull();
    // El trabajo del proceso (visitas, cierre) vive en el detalle:
    expect(screen.getByTestId('installation-job-p1')).not.toBeNull();
    expect(screen.getByTestId('installation-new-visit-p1')).not.toBeNull();
    expect(screen.getByTestId('installation-gate-units_installed')).not.toBeNull();
  });

  it('advances loaded → installed through the callback', () => {
    const onAdvance = vi.fn();
    render(
      <InstalacionesProjectDetail
        project={makeProject([makeItem('a', 'loaded')])}
        canAdvance
        onAdvance={onAdvance}
        jobHandlers={makeHandlers()}
      />,
    );
    fireEvent.click(screen.getByTestId('instalaciones-advance-a'));
    expect(onAdvance).toHaveBeenCalledWith('p1', 'a', 'installed' satisfies ItemFloorStatus);
  });

  it('goes back to the list via the callback', () => {
    const onBack = vi.fn();
    render(
      <InstalacionesProjectDetail
        project={makeProject([makeItem('a', 'loaded')])}
        onBack={onBack}
        jobHandlers={makeHandlers()}
      />,
    );
    fireEvent.click(screen.getByTestId('instalaciones-back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('hides unit actions and job management for read-only roles', () => {
    render(
      <InstalacionesProjectDetail
        project={makeProject([makeItem('a', 'loaded')])}
        jobHandlers={makeHandlers()}
      />,
    );
    expect(screen.queryByTestId('instalaciones-advance-a')).toBeNull();
    expect(screen.queryByTestId('installation-new-visit-p1')).toBeNull();
    expect(screen.queryByTestId('installation-signoff-p1')).toBeNull();
  });

  it('renders customer contact as actionable links', () => {
    render(
      <InstalacionesProjectDetail
        project={makeProject([makeItem('a', 'loaded')])}
        customerName="Cliente X"
        customerAddress="Av. Reforma 120, CDMX"
        customerPhone="+52 55 1234 5678"
        jobHandlers={makeHandlers()}
      />,
    );
    expect(
      screen.getByRole('link', { name: '+52 55 1234 5678' }).getAttribute('href'),
    ).toBe('tel:+52 55 1234 5678');
    expect(screen.getByText('Av. Reforma 120, CDMX')).not.toBeNull();
  });
});
