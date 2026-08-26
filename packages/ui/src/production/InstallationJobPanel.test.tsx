/**
 * @vitest-environment jsdom
 * InstallationJobPanel — instalación como subproceso (OC-070..OC-074):
 * visitas, incidencias, punch con evidencia y gates de cierre explicando
 * cómo resolverse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { InstallationJob, Project, ProjectItem } from '@granete/domain';

import { InstallationJobPanel } from './InstallationJobPanel';

afterEach(cleanup);

function makeItems(installed: number, total: number): ProjectItem[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `item-${i + 1}`,
    moduleId: 'mod-1',
    quantity: 1,
    optionChoices: {},
    floorStatus: i < installed ? 'installed' : 'loaded',
  }));
}

function makeProject(job?: InstallationJob, installed = 1, total = 1): Project {
  return {
    id: 'p1',
    name: 'Obra Test',
    customerId: 'c1',
    status: 'produced',
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    items: makeItems(installed, total),
    installation: job,
  } as unknown as Project;
}

function makeJob(overrides: Partial<InstallationJob> = {}): InstallationJob {
  return {
    id: 'ijob-1',
    projectId: 'p1',
    visits: [
      {
        id: 'ivis-1',
        date: '2026-09-02',
        crew: ['Juan', 'Pedro'],
        status: 'scheduled',
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    fieldIssues: [],
    punchItems: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
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

describe('InstallationJobPanel — visitas (OC-071)', () => {
  it('schedules a visit with date and crew parsed from the inline form', () => {
    const handlers = makeHandlers();
    render(
      <InstallationJobPanel
        project={makeProject()}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByTestId('installation-new-visit-p1'));
    fireEvent.change(screen.getByLabelText('Fecha de la visita'), {
      target: { value: '2026-09-10' },
    });
    fireEvent.change(screen.getByLabelText('Crew de la visita'), {
      target: { value: 'Juan, Ana' },
    });
    fireEvent.click(screen.getByTestId('installation-schedule-visit-p1'));

    expect(handlers.onScheduleVisit).toHaveBeenCalledWith('p1', {
      date: '2026-09-10',
      crew: ['Juan', 'Ana'],
    });
  });

  it('starts and cancels a scheduled visit through the callbacks', () => {
    const handlers = makeHandlers();
    render(
      <InstallationJobPanel
        project={makeProject(makeJob())}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByTestId('installation-visit-start-ivis-1'));
    expect(handlers.onStartVisit).toHaveBeenCalledWith('p1', 'ivis-1');

    fireEvent.click(screen.getByText('Cancelar'));
    expect(handlers.onCancelVisit).toHaveBeenCalledWith('p1', 'ivis-1');
  });

  it('completes a visit in progress with result and notes', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      visits: [
        {
          id: 'ivis-1',
          date: '2026-09-02',
          crew: ['Juan'],
          status: 'in_progress',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    });
    render(
      <InstallationJobPanel
        project={makeProject(job)}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByText('Completar'));
    fireEvent.change(screen.getByLabelText('Resultado de la visita'), {
      target: { value: 'partial' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Notas del resultado/), {
      target: { value: 'Faltan ajustes' },
    });
    fireEvent.click(screen.getByTestId('installation-visit-complete-ivis-1'));

    expect(handlers.onCompleteVisit).toHaveBeenCalledWith('p1', 'ivis-1', {
      result: 'partial',
      resultNotes: 'Faltan ajustes',
    });
  });

  it('hides visit actions for read-only roles', () => {
    render(
      <InstallationJobPanel
        project={makeProject(makeJob())}
        canManage={false}
        canCloseout={false}
        handlers={makeHandlers()}
      />,
    );
    expect(screen.queryByTestId('installation-visit-start-ivis-1')).toBeNull();
    expect(screen.queryByTestId('installation-new-visit-p1')).toBeNull();
  });
});

describe('InstallationJobPanel — incidencias y punch (OC-072/073)', () => {
  it('reports a field issue and offers only legal transitions', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      fieldIssues: [
        {
          id: 'fiss-1',
          description: 'Puerta rayada',
          status: 'open',
          reportedAt: '2026-09-02T12:00:00.000Z',
        },
      ],
    });
    render(
      <InstallationJobPanel
        project={makeProject(job)}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    // open → action_required | blocked | resolved (verified is illegal from open)
    expect(screen.getByTestId('installation-issue-fiss-1-action_required')).not.toBeNull();
    expect(screen.queryByTestId('installation-issue-fiss-1-verified')).toBeNull();

    fireEvent.click(screen.getByTestId('installation-issue-fiss-1-resolved'));
    expect(handlers.onTransitionIssue).toHaveBeenCalledWith('p1', 'fiss-1', 'resolved');

    fireEvent.change(screen.getByLabelText('Descripción de la incidencia'), {
      target: { value: 'Cajón desalineado' },
    });
    fireEvent.click(screen.getByTestId('installation-report-issue-p1'));
    expect(handlers.onReportIssue).toHaveBeenCalledWith('p1', {
      description: 'Cajón desalineado',
    });
  });

  it('opens a punch with owner, severity and blocker flag', () => {
    const handlers = makeHandlers();
    render(
      <InstallationJobPanel
        project={makeProject()}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByTestId('installation-new-punch-p1'));
    fireEvent.change(screen.getByLabelText('Descripción del pendiente'), {
      target: { value: 'Falta manija' },
    });
    fireEvent.change(screen.getByLabelText('Responsable del pendiente'), {
      target: { value: 'Carlos' },
    });
    fireEvent.change(screen.getByLabelText('Fecha límite'), {
      target: { value: '2026-09-15' },
    });
    fireEvent.change(screen.getByLabelText(/Severidad/), {
      target: { value: 'critical' },
    });
    fireEvent.click(screen.getByTestId('installation-open-punch-p1'));

    expect(handlers.onOpenPunch).toHaveBeenCalledWith('p1', {
      description: 'Falta manija',
      owner: 'Carlos',
      dueDate: '2026-09-15',
      severity: 'critical',
      isBlocker: true,
    });
  });

  it('closing a punch requires resolution evidence', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      punchItems: [
        {
          id: 'pnch-1',
          description: 'Ajustar bisagra',
          owner: 'Carlos',
          severity: 'major',
          isBlocker: true,
          status: 'open',
          openedAt: '2026-09-02T15:00:00.000Z',
        },
      ],
    });
    render(
      <InstallationJobPanel
        project={makeProject(job)}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    fireEvent.click(screen.getByTestId('installation-punch-close-pnch-1'));
    const confirm = screen.getByTestId(
      'installation-punch-confirm-close-pnch-1',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Evidencia de resolución del pendiente'), {
      target: { value: 'Bisagra ajustada y verificada' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(handlers.onClosePunch).toHaveBeenCalledWith('p1', 'pnch-1', {
      resolutionNotes: 'Bisagra ajustada y verificada',
    });
  });
});

describe('InstallationJobPanel — cierre y conformidad (OC-074)', () => {
  it('explains every failing gate and keeps sign-off blocked', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      punchItems: [
        {
          id: 'pnch-1',
          description: 'Falta zócalo',
          owner: 'Taller',
          severity: 'critical',
          isBlocker: true,
          status: 'open',
          openedAt: '2026-09-02T15:00:00.000Z',
        },
      ],
    });
    render(
      <InstallationJobPanel
        project={makeProject(job, 0, 1)} // nothing installed yet
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    const unitsGate = screen.getByTestId('installation-gate-units_installed');
    expect(unitsGate.textContent).toContain('Faltan instalar 1 de 1 unidades');
    const punchGate = screen.getByTestId('installation-gate-punch_blockers_closed');
    expect(punchGate.textContent).toContain('cerrar con evidencia');
    const visitsGate = screen.getByTestId('installation-gate-visits_completed');
    expect(visitsGate.textContent).toContain('completar o cancelar');

    const signOff = screen.getByTestId('installation-signoff-p1') as HTMLButtonElement;
    expect(signOff.disabled).toBe(true);
  });

  it('enables sign-off once gates pass and shows close after signing', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      visits: [
        {
          id: 'ivis-1',
          date: '2026-09-02',
          crew: ['Juan'],
          status: 'completed',
          result: 'finished',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    });
    render(
      <InstallationJobPanel
        project={makeProject(job, 1, 1)}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    fireEvent.change(screen.getByLabelText('Nombre de quien firma la conformidad'), {
      target: { value: 'María González' },
    });
    const signOff = screen.getByTestId('installation-signoff-p1') as HTMLButtonElement;
    expect(signOff.disabled).toBe(false);
    fireEvent.click(signOff);
    expect(handlers.onSignOff).toHaveBeenCalledWith('p1', {
      signedOffBy: 'María González',
    });
  });

  it('offers the completion milestone when units are done and visits closed', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      visits: [
        {
          id: 'ivis-1',
          date: '2026-09-02',
          crew: ['Juan'],
          status: 'completed',
          result: 'finished',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    });
    render(
      <InstallationJobPanel
        project={makeProject(job, 1, 1)}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );
    const complete = screen.getByTestId('installation-complete-p1');
    fireEvent.click(complete);
    expect(handlers.onCompleteInstallation).toHaveBeenCalledWith('p1');
  });

  it('shows the audited closeout once the project is closed', () => {
    const handlers = makeHandlers();
    const job = makeJob({
      visits: [],
      closeout: {
        signedOffBy: 'María González',
        signedOffAt: '2026-09-05T12:00:00.000Z',
        closedAt: '2026-09-05T12:30:00.000Z',
      },
    });
    render(
      <InstallationJobPanel
        project={makeProject(job, 1, 1)}
        canManage
        canCloseout
        handlers={handlers}
      />,
    );

    const audit = screen.getByTestId('installation-closeout-audit-p1');
    expect(audit.textContent).toContain('María González');
    expect(screen.queryByTestId('installation-signoff-p1')).toBeNull();
    expect(screen.queryByTestId('installation-close-p1')).toBeNull();
  });
});
