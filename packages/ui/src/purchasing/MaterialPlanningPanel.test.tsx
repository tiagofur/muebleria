// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MaterialPlanningPanel } from './MaterialPlanningPanel';
import { materialPlanningCardView } from './materialPlanningView';
import type { MaterialPlanning, Project } from '@muebles/domain';

afterEach(cleanup);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra Test',
    customerId: 'c1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    status: 'accepted',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'item-1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    productionRelease: {
      id: 'rel-1',
      projectId: 'p1',
      projectVersion: 1,
      designRevisionId: 'dr-1',
      bomFingerprint: 'fp-abc',
      releasedBy: 'ing-1',
      releasedAt: '2026-08-20T10:00:00Z',
      checks: [],
    },
    ...overrides,
  };
}

function planningWith(overrides: Partial<MaterialPlanning> = {}): MaterialPlanning {
  return {
    id: 'mplan-1',
    projectId: 'p1',
    requirements: {
      releaseId: 'rel-1',
      bomFingerprint: 'fp-abc',
      derivedAt: '2026-08-21T10:00:00Z',
      lines: [{ kind: 'herrajes', materialId: 'hw-1', quantity: 10 }],
    },
    reservations: [],
    createdAt: '2026-08-21T10:00:00Z',
    ...overrides,
  };
}

describe('materialPlanningCardView (OC-054 evidence)', () => {
  it('derives coverage, shortage and release gates from warehouse context', () => {
    const project = makeProject({ materialPlanning: planningWith() });
    const view = materialPlanningCardView(project, [planningWith()], [], []);
    expect(view.requirementsDerived).toBe(true);
    expect(view.coverage[0]).toMatchObject({
      required: 10,
      reserved: 0,
      pendingReserve: 10,
      shortage: 10,
      covered: false,
    });
    expect(view.releaseReady).toBe(false);
    expect(view.shortageLines).toHaveLength(1);
  });

  it('marks a released project as released regardless of gates', () => {
    const project = makeProject({
      materialsRelease: { releasedBy: 'alm-1', releasedAt: '2026-08-21T12:00:00Z' },
    });
    const view = materialPlanningCardView(project, [], [], []);
    expect(view.released).toBe(true);
  });

  it('canDerive is false without a production release (no heuristics)', () => {
    const view = materialPlanningCardView(makeProject({ productionRelease: undefined }), [], [], []);
    expect(view.canDerive).toBe(false);
    expect(view.requirementsDerived).toBe(false);
  });
});

describe('MaterialPlanningPanel', () => {
  it('prompts to derive when no requirements exist and dispatches derive', () => {
    const onDerive = vi.fn();
    const project = makeProject();
    const view = materialPlanningCardView(project, [], [], []);
    render(
      <MaterialPlanningPanel view={view} handlers={{ onDerive }} testId="plan" />,
    );
    fireEvent.click(screen.getByTestId('purch-plan-derive-p1'));
    expect(onDerive).toHaveBeenCalledWith('p1');
  });

  it('shows coverage evidence with shortage and dispatches reserve / PO / release', () => {
    const onReserve = vi.fn();
    const onCreateShortagePO = vi.fn();
    const onRelease = vi.fn();
    const project = makeProject({ materialPlanning: planningWith() });
    const view = materialPlanningCardView(project, [planningWith()], [], []);
    render(
      <MaterialPlanningPanel
        view={view}
        handlers={{ onReserve, onCreateShortagePO, onRelease }}
        testId="plan"
      />,
    );
    expect(screen.getByTestId('plan').textContent).toContain('Falta comprar');
    fireEvent.click(screen.getByTestId('purch-plan-reserve-p1'));
    expect(onReserve).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByTestId('purch-plan-po-p1'));
    expect(onCreateShortagePO).toHaveBeenCalledWith('p1');
    // Gates failing → override input disabled until a reason is typed.
    expect(screen.getByTestId('purch-plan-gates-p1')).toBeTruthy();
    const overrideInput = screen.getByTestId('purch-plan-override-input-p1');
    expect(screen.getByTestId('purch-plan-override-release-p1')).toHaveProperty('disabled', true);
    fireEvent.change(overrideInput, { target: { value: 'Cliente provee herrajes' } });
    fireEvent.click(screen.getByTestId('purch-plan-override-release-p1'));
    expect(onRelease).toHaveBeenCalledWith('p1', 'Cliente provee herrajes');
    // Plain release also available (second call, without override).
    fireEvent.click(screen.getByTestId('purch-plan-release-p1'));
    expect(onRelease).toHaveBeenCalledTimes(2);
    expect(onRelease).toHaveBeenNthCalledWith(2, 'p1');
  });

  it('renders the released badge once the stamp exists', () => {
    const project = makeProject({
      materialsRelease: { releasedBy: 'alm-1', releasedAt: '2026-08-21T12:00:00Z' },
    });
    const view = materialPlanningCardView(project, [], [], []);
    render(<MaterialPlanningPanel view={view} handlers={{}} testId="plan" />);
    expect(screen.getByTestId('plan').textContent).toContain('Material liberado a producción');
  });
});
