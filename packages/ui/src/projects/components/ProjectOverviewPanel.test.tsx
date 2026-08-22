// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProjectOverviewPanel } from './ProjectOverviewPanel';
import type { Project } from '@muebles/domain';

afterEach(cleanup);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina López',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 10,
    status: 'produced',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-20T10:00:00Z',
    items: [{ id: 'i1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    ...overrides,
  } as Project;
}

describe('ProjectOverviewPanel (OC-091)', () => {
  it('renders the transversal facts of the obra', () => {
    render(
      <ProjectOverviewPanel
        project={makeProject({
          productionRelease: {
            id: 'rel-1',
            projectId: 'p1',
            projectVersion: 4,
            designRevisionId: 'dr-1',
            bomFingerprint: 'fp-1',
            releasedBy: 'ing-1',
            releasedAt: '2026-08-15T10:00:00Z',
            checks: [],
          },
          installationScheduledDate: '2026-08-30',
        })}
        nav={{}}
      />,
    );
    expect(screen.getByText('Etapa').parentElement?.textContent).toContain('Producción');
    expect(screen.getByTestId('project-overview-release').textContent).toBe('v4');
    expect(screen.getByTestId('project-overview-installation').textContent).toBe('2026-08-30');
    expect(screen.getByTestId('project-overview-ok')).toBeTruthy();
  });

  it('lists actionable blockers from real domain state', () => {
    render(
      <ProjectOverviewPanel
        project={makeProject({
          siteSurvey: {
            id: 'svy-1',
            projectId: 'p1',
            revision: 1,
            createdAt: '2026-08-10T10:00:00Z',
            spaces: [{ id: 'spc-1', name: 'Cocina', intent: 'preliminary', elements: [], photoIds: [] }],
          },
          installation: {
            id: 'ij-1',
            projectId: 'p1',
            createdAt: '2026-08-15T10:00:00Z',
            visits: [],
            fieldIssues: [
              { id: 'fi-1', description: 'Mueble rayado', status: 'open', reportedAt: '2026-08-20T10:00:00Z' },
            ],
            punchItems: [
              {
                id: 'pj-1',
                description: 'Falta zócalo',
                owner: 'taller',
                severity: 'major',
                isBlocker: true,
                status: 'open',
                openedAt: '2026-08-20T10:00:00Z',
              },
            ],
          },
        })}
        nav={{}}
      />,
    );
    const blockers = screen.getByTestId('project-overview-blockers');
    expect(blockers.textContent).toContain('Cocina');
    expect(blockers.textContent).toContain('Punch bloqueante: Falta zócalo');
    expect(blockers.textContent).toContain('Incidencia en obra: Mueble rayado');
    expect(screen.queryByTestId('project-overview-ok')).toBeNull();
  });

  it('navigates to each area workspace from a single context', () => {
    const onOpenEngineering = vi.fn();
    const onOpenInProduction = vi.fn();
    render(
      <ProjectOverviewPanel
        project={makeProject()}
        nav={{ onOpenEngineering, onOpenInProduction }}
      />,
    );
    fireEvent.click(screen.getByTestId('project-overview-link-engineering'));
    expect(onOpenEngineering).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByTestId('project-overview-link-production'));
    expect(onOpenInProduction).toHaveBeenCalledWith('p1');

    // Links without a handler stay visibly disabled with an explanation.
    const shipping = screen.getByTestId('project-overview-link-shipping') as HTMLButtonElement;
    expect(shipping.disabled).toBe(true);
    expect(shipping.title).toContain('No disponible');
  });
});
