import { describe, it, expect } from 'vitest';
import installationContract from '../../../contracts/installationStatuses.json';
import {
  FIELD_ISSUE_STATUSES,
  FIELD_ISSUE_STATUS_TRANSITIONS,
  INSTALLATION_JOB_STATUSES,
  INSTALLATION_VISIT_RESULTS,
  INSTALLATION_VISIT_STATUSES,
  PUNCH_ITEM_STATUSES,
  PUNCH_SEVERITIES,
  blockingPunchItems,
  canTransitionFieldIssueStatus,
  cancelInstallationVisit,
  closeProjectCloseout,
  closePunchItem,
  completeInstallation,
  completeInstallationVisit,
  deriveInstallationJobStatus,
  evaluateCloseoutGates,
  evaluateCloseoutReadiness,
  installationUnitsSummary,
  openFieldIssues,
  openPunchItem,
  openPunchItems,
  reportFieldIssue,
  recordClientSignOff,
  scheduleInstallationVisit,
  startInstallationVisit,
  transitionFieldIssue,
  validateCloseoutEventAppend,
} from './installation';
import { deriveProjectStage } from './projectLifecycle';
import type { Project } from './types';
import type { ModuleUnitExecution } from './partExecution';
import { ValidationError } from './errors';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Obra Test',
    customerId: 'cust-1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    status: 'produced',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [
      { id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} },
    ],
    ...overrides,
  };
}

function makeUnit(status: ModuleUnitExecution['status']): ModuleUnitExecution {
  return {
    id: `unit-${status}`,
    projectId: 'proj-1',
    projectItemId: 'item-1',
    unitIndex: 1,
    productionRevision: 'rev-1',
    status,
  };
}

describe('installation — Domain Contract Parity (OC-070..OC-074)', () => {
  it('matches installationStatuses contract fixture exactly', () => {
    expect([...INSTALLATION_JOB_STATUSES]).toEqual(installationContract.jobStatuses);
    expect([...INSTALLATION_VISIT_STATUSES]).toEqual(installationContract.visitStatuses);
    expect([...INSTALLATION_VISIT_RESULTS]).toEqual(installationContract.visitResults);
    expect([...FIELD_ISSUE_STATUSES]).toEqual(installationContract.fieldIssueStatuses);
    expect([...PUNCH_ITEM_STATUSES]).toEqual(installationContract.punchItemStatuses);
    expect([...PUNCH_SEVERITIES]).toEqual(installationContract.punchSeverities);
  });

  it('mirrors field issue transitions from the contract', () => {
    for (const [from, targets] of Object.entries(installationContract.fieldIssueStatusTransitions)) {
      expect([...FIELD_ISSUE_STATUS_TRANSITIONS[from as keyof typeof FIELD_ISSUE_STATUS_TRANSITIONS]]).toEqual(targets);
    }
  });
});

describe('installation — visits (OC-070/OC-071)', () => {
  it('schedules multiple visits without hacks and auto-creates the job', () => {
    const { project: p1, job } = scheduleInstallationVisit(makeProject(), {
      date: '2026-09-01',
      crew: ['Juan', 'Pedro'],
    });
    expect(job.visits).toHaveLength(1);
    expect(job.projectId).toBe('proj-1');

    const { project: p2, job: job2 } = scheduleInstallationVisit(p1, {
      date: '2026-09-03',
      crew: ['Ana'],
    });
    expect(job2.visits).toHaveLength(2);
    expect(p2.installation?.visits.map((v) => v.date)).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('rejects visits without date or crew', () => {
    const project = makeProject();
    expect(() =>
      scheduleInstallationVisit(project, { date: '01-09-2026', crew: ['Juan'] }),
    ).toThrow(ValidationError);
    expect(() => scheduleInstallationVisit(project, { date: '2026-09-01', crew: [] })).toThrow(
      ValidationError,
    );
  });

  it('starts a visit once and appends installation_started only the first time', () => {
    const scheduled = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    const started = startInstallationVisit(scheduled.project, scheduled.visit.id, {
      byUserId: 'user-1',
    });

    expect(started.job.visits[0]!.status).toBe('in_progress');
    expect(started.project.events?.map((e) => e.type)).toEqual(['installation_started']);

    const second = scheduleInstallationVisit(started.project, { date: '2026-09-05', crew: ['Ana'] });
    const started2 = startInstallationVisit(second.project, second.visit.id, {});
    expect(started2.events).toHaveLength(0);
    expect(started2.project.events?.filter((e) => e.type === 'installation_started')).toHaveLength(1);
  });

  it('completes a visit with result, units worked and evidence', () => {
    const scheduled = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    const started = startInstallationVisit(scheduled.project, scheduled.visit.id, {});
    const done = completeInstallationVisit(started.project, scheduled.visit.id, {
      result: 'partial',
      resultNotes: 'Faltan ajustes de nivelación',
      unitIds: ['unit-installed'],
      photoIds: ['photo-1'],
    });

    const visit = done.job.visits[0]!;
    expect(visit.status).toBe('completed');
    expect(visit.result).toBe('partial');
    expect(visit.unitIds).toEqual(['unit-installed']);
    expect(visit.photoIds).toEqual(['photo-1']);
  });

  it('rejects completing a visit that never started and cancelling a completed one', () => {
    const scheduled = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    expect(() =>
      completeInstallationVisit(scheduled.project, scheduled.visit.id, { result: 'finished' }),
    ).toThrow(ValidationError);

    const started = startInstallationVisit(scheduled.project, scheduled.visit.id, {});
    const done = completeInstallationVisit(started.project, scheduled.visit.id, { result: 'finished' });
    expect(() =>
      cancelInstallationVisit(done.project, scheduled.visit.id, { reason: 'tarde' }),
    ).toThrow(ValidationError);
  });

  it('derives job status from real work, never from a stored field', () => {
    expect(deriveInstallationJobStatus(makeProject())).toBe('planned');
    const scheduled = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    expect(deriveInstallationJobStatus(scheduled.project)).toBe('planned');
    const started = startInstallationVisit(scheduled.project, scheduled.visit.id, {});
    expect(deriveInstallationJobStatus(started.project)).toBe('in_progress');
  });
});

describe('installation — field issues (OC-072)', () => {
  it('reports an issue linked to a mueble and a pieza with photos', () => {
    const withJob = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    const { job, issue } = reportFieldIssue(withJob.project, {
      description: 'Puerta rayada en obra',
      projectItemId: 'item-1',
      partInstanceId: 'part-9',
      photoIds: ['photo-2'],
    });

    expect(issue.status).toBe('open');
    expect(job.fieldIssues).toHaveLength(1);
    expect(openFieldIssues(job)).toHaveLength(1);
  });

  it('walks open → action_required → resolved → verified and rejects jumps', () => {
    const withJob = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    const reported = reportFieldIssue(withJob.project, { description: 'Cajón desalineado' });

    let { project } = reported;
    project = transitionFieldIssue(project, reported.issue.id, 'action_required', {}).project;
    expect(project.installation?.fieldIssues[0]!.status).toBe('action_required');

    expect(() => transitionFieldIssue(project, reported.issue.id, 'verified', {})).toThrow(
      ValidationError,
    );

    project = transitionFieldIssue(project, reported.issue.id, 'resolved', { byUserId: 'tech-1' }).project;
    const resolved = project.installation!.fieldIssues[0]!;
    expect(resolved.resolvedAt).toBeTruthy();
    expect(openFieldIssues(project.installation)).toHaveLength(0);

    project = transitionFieldIssue(project, reported.issue.id, 'verified', { byUserId: 'mgr-1' }).project;
    expect(project.installation?.fieldIssues[0]!.verifiedBy).toBe('mgr-1');
  });

  it('reopens a verified issue whose verification failed', () => {
    const withJob = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    const reported = reportFieldIssue(withJob.project, { description: 'Puerta floja' });
    let { project } = reported;
    project = transitionFieldIssue(project, reported.issue.id, 'resolved', {}).project;
    project = transitionFieldIssue(project, reported.issue.id, 'verified', {}).project;
    project = transitionFieldIssue(project, reported.issue.id, 'open', { notes: 'Cliente reportó que volvió a fallar' }).project;

    const reopened = project.installation!.fieldIssues[0]!;
    expect(reopened.status).toBe('open');
    expect(reopened.verifiedAt).toBeUndefined();
    expect(openFieldIssues(project.installation)).toHaveLength(1);
  });

  it('exposes canTransitionFieldIssueStatus consistent with the map', () => {
    expect(canTransitionFieldIssueStatus('open', 'resolved')).toBe(true);
    expect(canTransitionFieldIssueStatus('verified', 'resolved')).toBe(false);
  });
});

describe('installation — punch items (OC-073)', () => {
  function projectWithPunch(isBlocker: boolean) {
    const withJob = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    return openPunchItem(withJob.project, {
      description: 'Falta manija del cajón 3',
      owner: 'Instalación — Carlos',
      dueDate: '2026-09-10',
      severity: 'major',
      isBlocker,
      openedBy: 'user-1',
    });
  }

  it('opens a punch with owner, due date and severity, audited as punch_opened', () => {
    const { project, punchItem } = projectWithPunch(true);
    expect(punchItem.status).toBe('open');
    expect(punchItem.isBlocker).toBe(true);
    const types = project.events?.map((e) => e.type);
    expect(types).toContain('punch_opened');
    expect(blockingPunchItems(project.installation)).toHaveLength(1);
  });

  it('closing requires resolution evidence (notes or photos)', () => {
    const { project, punchItem } = projectWithPunch(false);
    expect(() => closePunchItem(project, punchItem.id, {})).toThrow(ValidationError);

    const closed = closePunchItem(project, punchItem.id, {
      resolutionNotes: 'Manija instalada y verificada',
      closedBy: 'user-2',
    });
    const updated = closed.job.punchItems[0]!;
    expect(updated.status).toBe('closed');
    expect(updated.resolutionNotes).toBe('Manija instalada y verificada');
    expect(closed.project.events?.map((e) => e.type)).toContain('punch_closed');
    expect(openPunchItems(closed.project.installation)).toHaveLength(0);
  });

  it('rejects closing twice', () => {
    const { project, punchItem } = projectWithPunch(false);
    const closed = closePunchItem(project, punchItem.id, { resolutionNotes: 'Listo' });
    expect(() => closePunchItem(closed.project, punchItem.id, { resolutionNotes: 'Otra vez' })).toThrow(
      ValidationError,
    );
  });
});

describe('installation — units summary (physical vs legacy)', () => {
  it('counts physical module units when they exist', () => {
    const project = makeProject({ moduleUnits: [makeUnit('installed'), makeUnit('loaded')] });
    expect(installationUnitsSummary(project)).toEqual({
      mode: 'physical',
      installed: 1,
      total: 2,
    });
  });

  it('falls back to legacy item floor status', () => {
    const project = makeProject({
      items: [
        { id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus: 'installed' },
        { id: 'item-2', moduleId: 'mod-2', quantity: 1, optionChoices: {}, floorStatus: 'loaded' },
      ],
    });
    expect(installationUnitsSummary(project)).toEqual({ mode: 'legacy', installed: 1, total: 2 });
  });

  it('reports none when there is nothing to install', () => {
    expect(installationUnitsSummary(makeProject({ items: [] }))).toEqual({
      mode: 'none',
      installed: 0,
      total: 0,
    });
  });
});

describe('installation — closeout gates (OC-074)', () => {
  function installedProject(): Project {
    return makeProject({ moduleUnits: [makeUnit('installed')] });
  }

  it('fails every gate on a fresh project and explains how to resolve each', () => {
    const scheduled = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    const started = startInstallationVisit(scheduled.project, scheduled.visit.id, {});
    const withIssue = reportFieldIssue(started.project, { description: 'Falta tornillería' });
    const withPunch = openPunchItem(withIssue.project, {
      description: 'Ajustar bisagra',
      owner: 'Carlos',
      severity: 'major',
      isBlocker: true,
    });

    const gates = evaluateCloseoutGates(withPunch.project);
    const failing = gates.filter((g) => !g.passed).map((g) => g.code);
    expect(failing).toEqual([
      'units_installed',
      'field_issues_resolved',
      'punch_blockers_closed',
      'visits_completed',
    ]);
    for (const gate of gates) {
      if (!gate.passed) expect(gate.details.length).toBeGreaterThan(10);
    }
  });

  it('all units installed alone do NOT make the project closeable (OC-074)', () => {
    const project = installedProject();
    const gates = evaluateCloseoutGates(project);
    expect(gates.find((g) => g.code === 'units_installed')!.passed).toBe(true);

    const withBlocker = openPunchItem(project, {
      description: 'Falta cubrir zócalo',
      owner: 'Carlos',
      severity: 'critical',
      isBlocker: true,
    });
    expect(evaluateCloseoutReadiness(withBlocker.project).ready).toBe(false);
    expect(() =>
      recordClientSignOff(withBlocker.project, { signedOffBy: 'Cliente S.A.' }),
    ).toThrow(ValidationError);
    expect(validateCloseoutEventAppend(withBlocker.project, 'client_signed_off').length).toBeGreaterThan(0);
  });

  it('non-blocking open punch does not block, blocking one does', () => {
    const project = installedProject();
    const withSoft = openPunchItem(project, {
      description: 'Retocar pintura',
      owner: 'Pintura',
      severity: 'minor',
      isBlocker: false,
    });
    expect(evaluateCloseoutReadiness(withSoft.project).ready).toBe(true);

    const withHard = openPunchItem(withSoft.project, {
      description: 'Falta módulo',
      owner: 'Taller',
      severity: 'critical',
      isBlocker: true,
    });
    expect(evaluateCloseoutReadiness(withHard.project).ready).toBe(false);

    const closed = closePunchItem(withHard.project, withHard.punchItem.id, {
      resolutionNotes: 'Módulo instalado',
    });
    expect(evaluateCloseoutReadiness(closed.project).ready).toBe(true);
  });

  it('sign-off requires gates; close requires sign-off on top of gates', () => {
    const project = installedProject();
    expect(() => closeProjectCloseout(project, { byUserId: 'mgr' })).toThrow(ValidationError);

    const signed = recordClientSignOff(project, {
      signedOffBy: 'María González',
      byUserId: 'mgr',
    });
    expect(signed.project.installation?.closeout?.signedOffBy).toBe('María González');
    expect(signed.project.events?.map((e) => e.type)).toContain('client_signed_off');

    const closed = closeProjectCloseout(signed.project, { byUserId: 'mgr' });
    expect(closed.project.installation?.closeout?.closedAt).toBeTruthy();
    expect(closed.project.events?.map((e) => e.type)).toContain('project_closed');
    expect(validateCloseoutEventAppend(closed.project, 'project_closed')).toEqual([]);
  });
});

describe('installation — completion of the subprocess', () => {
  it('rejects completion while units are missing or visits are open', () => {
    const scheduled = scheduleInstallationVisit(makeProject(), { date: '2026-09-01', crew: ['Juan'] });
    expect(() => completeInstallation(scheduled.project, {})).toThrow(ValidationError);

    const started = startInstallationVisit(scheduled.project, scheduled.visit.id, {});
    expect(() => completeInstallation(started.project, {})).toThrow(ValidationError);
  });

  it('completes only with all units installed and no open visits', () => {
    const project = makeProject({ moduleUnits: [makeUnit('installed')] });
    const result = completeInstallation(project, { byUserId: 'user-1' });
    expect(result.project.events?.map((e) => e.type)).toContain('installation_completed');
    expect(deriveInstallationJobStatus(result.project)).toBe('completed');

    expect(() => completeInstallation(result.project, {})).toThrow(ValidationError);
  });

  it('completion does not close the project (installed ≠ cerrado)', () => {
    const project = makeProject({ moduleUnits: [makeUnit('installed')] });
    const completed = completeInstallation(project, {});
    expect(evaluateCloseoutReadiness(completed.project, { requireSignOff: true }).ready).toBe(false);
    expect(validateCloseoutEventAppend(completed.project, 'project_closed').length).toBeGreaterThan(0);
  });
});

describe('installation — punch balance drives the punch stage', () => {
  it('stays in punch stage while opened punch items outnumber closed ones', () => {
    const project = makeProject({ moduleUnits: [makeUnit('installed')] });
    const one = openPunchItem(project, { description: 'A', owner: 'X', severity: 'minor' });
    expect(deriveProjectStage(one.project)).toBe('punch');

    const two = openPunchItem(one.project, { description: 'B', owner: 'Y', severity: 'minor' });
    const closedFirst = closePunchItem(two.project, one.punchItem.id, { resolutionNotes: 'ok' });
    expect(deriveProjectStage(closedFirst.project)).toBe('punch');

    const closedBoth = closePunchItem(closedFirst.project, two.punchItem.id, { resolutionNotes: 'ok' });
    expect(deriveProjectStage(closedBoth.project)).not.toBe('punch');
  });
});
