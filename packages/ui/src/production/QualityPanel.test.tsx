// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QualityPanel } from './QualityPanel';
import { qualityPanelView } from './qualityView';
import type { ModuleUnitExecution, Project, QualityJob } from '@granete/domain';

afterEach(cleanup);

function makeUnit(status: ModuleUnitExecution['status']): ModuleUnitExecution {
  return {
    id: 'p1_i1_u1',
    projectId: 'p1',
    projectItemId: 'i1',
    unitIndex: 1,
    productionRevision: 'rel-1',
    status,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra Test',
    customerId: 'c1',
    currency: 'USD',
    marginFactor: 1.2,
    laborFixedCost: 0,
    status: 'produced',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'i1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    moduleUnits: [makeUnit('module_qc')],
    ...overrides,
  };
}

describe('qualityPanelView', () => {
  it('resolves open issues, rework cost and the per-unit QC gate', () => {
    const quality: QualityJob = {
      id: 'qjob-1',
      projectId: 'p1',
      issues: [
        {
          id: 'qiss-1',
          description: 'Cajón trabado',
          category: 'armado',
          status: 'open',
          moduleUnitId: 'p1_i1_u1',
          reportedAt: '2026-08-21T11:00:00Z',
        },
      ],
      reworkActions: [
        { id: 'a1', issueId: 'qiss-x', action: 'rework', materialCost: 25, laborMinutes: 30, at: '2026-08-21T12:00:00Z' },
      ],
      unitQc: [],
      createdAt: '2026-08-21T10:00:00Z',
    };
    const view = qualityPanelView(makeProject({ quality }));
    expect(view.openIssues).toHaveLength(1);
    expect(view.reworkCost).toEqual({ materialCost: 25, laborMinutes: 30 });
    expect(view.unitGates[0]?.gate.ready).toBe(false);
    expect(view.unitGates[0]?.gate.failing.map((c) => c.code)).toEqual([
      'qc_passed',
      'no_open_issues',
    ]);
    expect(view.qcChecklist.map((c) => c.label)).toContain('Escuadra');
  });

  it('covers packaged units too (already through the gate)', () => {
    const view = qualityPanelView(
      makeProject({ moduleUnits: [makeUnit('packaged')] }),
    );
    expect(view.unitGates).toHaveLength(1);
  });
});

describe('QualityPanel', () => {
  it('reports an issue through the handler with projectId', () => {
    const onReportIssue = vi.fn();
    const view = qualityPanelView(makeProject());
    render(<QualityPanel view={view} handlers={{ onReportIssue }} testId="q" />);
    fireEvent.change(screen.getByTestId('quality-report-desc-p1'), {
      target: { value: 'Frente rayado' },
    });
    fireEvent.change(screen.getByTestId('quality-report-category-p1'), {
      target: { value: 'dano' },
    });
    fireEvent.click(screen.getByTestId('quality-report-submit-p1'));
    expect(onReportIssue).toHaveBeenCalledWith('p1', {
      description: 'Frente rayado',
      category: 'dano',
    });
  });

  it('records the QC checklist only when every point is checked', () => {
    const onRecordQc = vi.fn();
    const view = qualityPanelView(makeProject());
    render(<QualityPanel view={view} handlers={{ onRecordQc }} testId="q" />);
    const submit = screen.getByTestId('quality-qc-submit-p1_i1_u1');
    expect(submit).toHaveProperty('disabled', true);
    for (const code of ['square', 'dimensions', 'hardware', 'doors_drawers', 'finish', 'identification']) {
      fireEvent.click(screen.getByTestId(`quality-qc-p1_i1_u1-${code}`));
    }
    expect(submit).toHaveProperty('disabled', false);
    fireEvent.click(submit);
    expect(onRecordQc).toHaveBeenCalledTimes(1);
    const [, , checklist] = onRecordQc.mock.calls[0]!;
    expect(checklist).toHaveLength(6);
    expect(checklist.every((c: { passed: boolean }) => c.passed)).toBe(true);
  });

  it('dispatches the supervisor override with the reason', () => {
    const onOverrideQc = vi.fn();
    const view = qualityPanelView(makeProject());
    render(
      <QualityPanel
        view={view}
        handlers={{ onOverrideQc }}
        canOverride
        testId="q"
      />,
    );
    const overrideBtn = screen.getByTestId('quality-qc-override-p1_i1_u1');
    expect(overrideBtn).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByTestId('quality-qc-override-input-p1_i1_u1'), {
      target: { value: 'Despacho urgente acordado' },
    });
    fireEvent.click(overrideBtn);
    expect(onOverrideQc).toHaveBeenCalledWith('p1', 'p1_i1_u1', 'Despacho urgente acordado');
  });

  it('hides the override control when the role cannot supervise', () => {
    const view = qualityPanelView(makeProject());
    render(<QualityPanel view={view} handlers={{}} canOverride={false} testId="q" />);
    expect(
      screen.queryByTestId('quality-qc-override-p1_i1_u1'),
    ).toBeNull();
  });

  it('resolves an open issue with a rework action and costing', () => {
    const onRework = vi.fn();
    const quality: QualityJob = {
      id: 'qjob-1',
      projectId: 'p1',
      issues: [
        {
          id: 'qiss-1',
          description: 'Canto despegado',
          category: 'acabado_canto',
          status: 'open',
          partInstanceId: 'part-1',
          reportedAt: '2026-08-21T11:00:00Z',
        },
      ],
      reworkActions: [],
      unitQc: [],
      createdAt: '2026-08-21T10:00:00Z',
    };
    const view = qualityPanelView(makeProject({ quality }));
    render(<QualityPanel view={view} handlers={{ onRework }} testId="q" />);
    fireEvent.change(screen.getByTestId('quality-rework-action-qiss-1'), {
      target: { value: 'rework' },
    });
    fireEvent.change(screen.getByTestId('quality-rework-part-qiss-1'), {
      target: { value: 'part-1' },
    });
    const submit = screen.getByTestId('quality-rework-submit-qiss-1');
    expect(submit).toHaveProperty('disabled', false);
    fireEvent.click(submit);
    expect(onRework).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ issueId: 'qiss-1', action: 'rework', partInstanceId: 'part-1' }),
    );
  });
});
