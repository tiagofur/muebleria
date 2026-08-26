/**
 * @vitest-environment jsdom
 * Instalaciones — home: LISTA de obras con trabajo de instalación (el
 * trabajo del proceso vive en el detalle por obra, no acá).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Customer, Project, ProjectItem } from '@granete/domain';

import { InstalacionesScreen, instalacionesProjects } from './InstalacionesScreen';

afterEach(cleanup);

function makeItem(
  id: string,
  floorStatus?: ProjectItem['floorStatus'],
): ProjectItem {
  return { id, moduleId: 'mod-1', quantity: 1, optionChoices: {}, floorStatus };
}

function makeProject(
  id: string,
  items: ProjectItem[],
  status: Project['status'] = 'accepted',
): Project {
  return {
    id,
    name: `Obra ${id}`,
    customerId: 'c1',
    status,
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items,
  } as unknown as Project;
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    name: 'Cliente X',
    active: true,
    ...overrides,
  };
}

describe('instalacionesProjects (pure derivation)', () => {
  it('keeps works with loaded items, job work, or both; counts the summary', () => {
    const projects = [
      makeProject('p1', [
        makeItem('a', 'loaded'),
        makeItem('b', 'installed'),
        makeItem('c', 'packaged'), // still in Embarques
        makeItem('d'),
      ]),
      makeProject('p2', [makeItem('e', 'loaded')]),
      makeProject('p3', [makeItem('f', 'installed')]), // nothing pending, no job → out
      makeProject('p4', [makeItem('g', 'loaded')], 'draft'),
    ];
    const cards = instalacionesProjects(projects, () => makeCustomer());
    expect(cards.map((c) => c.projectId)).toEqual(['p1', 'p2']);
    expect(cards[0]!.toInstallCount).toBe(1);
    expect(cards[0]!.installedCount).toBe(1);
    expect(cards[0]!.customerLabel).toBe('Cliente X');
    expect(cards[0]!.job.units).toEqual({ mode: 'legacy', installed: 1, total: 4 });
  });

  it('keeps a work with everything installed but open punch blockers', () => {
    const project: Project = {
      ...makeProject('p1', [makeItem('a', 'installed')]),
      installation: {
        id: 'ijob-1',
        projectId: 'p1',
        visits: [],
        fieldIssues: [],
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
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    };
    const cards = instalacionesProjects([project]);
    expect(cards.map((c) => c.projectId)).toEqual(['p1']);
    expect(cards[0]!.job.blockingPunchCount).toBe(1);
    expect(cards[0]!.toInstallCount).toBe(0);
  });

  it('derives only the contact fields present in the customer', () => {
    const [card] = instalacionesProjects(
      [makeProject('p1', [makeItem('a', 'loaded')])],
      () => makeCustomer({ address: 'Av. Reforma 120', phone: '+52 55 1234 5678' }),
    );
    expect(card).toMatchObject({
      customerLabel: 'Cliente X',
      customerAddress: 'Av. Reforma 120',
      customerPhone: '+52 55 1234 5678',
    });
  });
});

describe('InstalacionesScreen (lista de obras)', () => {
  const projects = [
    makeProject('p1', [makeItem('a', 'loaded'), makeItem('b', 'installed')]),
    makeProject('p2', [makeItem('c', 'loaded')]),
  ];

  it('renders one card per project with the work summary, not the process work', () => {
    render(
      <InstalacionesScreen
        projects={projects}
        onOpenProject={() => undefined}
        customerFor={() => makeCustomer()}
      />,
    );
    expect(screen.getByTestId('instalaciones-card-p1')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-card-p2')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-to-install').textContent).toBe(
      '2 para instalar',
    );
    // Resumen por obra, no detalle del proceso:
    expect(screen.getByTestId('instalaciones-card-p1').textContent).toContain(
      '1/2 unidades instaladas',
    );
    expect(screen.getByTestId('instalaciones-card-p1').textContent).toContain(
      '1 en camino',
    );
    // La home no expone acciones del proceso (visitas/punch/cierre):
    expect(screen.queryByTestId('installation-new-visit-p1')).toBeNull();
    expect(screen.queryByTestId('instalaciones-advance-a')).toBeNull();
  });

  it('opens the per-project detail screen via the title trigger (mouse + keyboard)', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    render(
      <InstalacionesScreen
        projects={projects}
        onOpenProject={onOpenProject}
        customerFor={() =>
          makeCustomer({ phone: '+52 55 1234 5678' })
        }
      />,
    );
    const trigger = screen.getByTestId('instalaciones-open-p1');
    expect(trigger.getAttribute('aria-label')).toBe('Abrir instalación Obra p1');
    fireEvent.click(trigger);
    expect(onOpenProject).toHaveBeenCalledWith('p1');
    onOpenProject.mockClear();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(onOpenProject).toHaveBeenCalledWith('p1');
    // Sin botón dedicado: la apertura vive en el cuerpo de la card (stretched).
    expect(
      screen.queryByRole('button', { name: 'Abrir instalación' }),
    ).toBeNull();
    // El link tel: es contacto directo: no dispara la apertura de la obra.
    onOpenProject.mockClear();
    const p1Card = screen.getByTestId('instalaciones-card-p1');
    fireEvent.click(
      within(p1Card).getByRole('link', { name: '+52 55 1234 5678' }),
    );
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('renders the destination address and phone as actionable links', () => {
    render(
      <InstalacionesScreen
        projects={[makeProject('p1', [makeItem('a', 'loaded')])]}
        onOpenProject={() => undefined}
        customerFor={() =>
          makeCustomer({ address: 'Av. Reforma 120, CDMX', phone: '+52 55 1234 5678' })
        }
      />,
    );
    expect(screen.getByText('Av. Reforma 120, CDMX')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: '+52 55 1234 5678' }).getAttribute('href'),
    ).toBe('tel:+52 55 1234 5678');
  });

  it('does not render contact details when the customer is unavailable', () => {
    render(
      <InstalacionesScreen
        projects={[makeProject('p1', [makeItem('a', 'loaded')])]}
        onOpenProject={() => undefined}
        customerFor={() => undefined}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the empty state when nothing is loaded', () => {
    render(
      <InstalacionesScreen
        projects={[makeProject('p1', [makeItem('a', 'packaged')])]}
        onOpenProject={() => undefined}
      />,
    );
    expect(screen.getByText('Nada para instalar')).not.toBeNull();
    expect(screen.getByTestId('instalaciones-to-install').textContent).toBe(
      '0 para instalar',
    );
  });
});
