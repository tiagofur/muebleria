// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CostingPanel } from './CostingPanel';
import { costingPanelView } from '../costingView';
import {
  computeJobCostSummary,
  valueMaterialConsumptions,
  captureCostBaseline,
  setLaborRate,
  recordTimeEntry,
  recordOtherCost,
  type JobCosting,
  type Project,
} from '@granete/domain';

afterEach(cleanup);

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra Test',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.3,
    laborFixedCost: 10,
    status: 'produced',
    createdAt: '2026-08-21T10:00:00Z',
    updatedAt: '2026-08-21T10:00:00Z',
    items: [{ id: 'i1', moduleId: 'mod-1', quantity: 1, optionChoices: {} }],
    priceSnapshot: {
      capturedAt: '2026-08-20T10:00:00Z',
      breakdown: {
        materialsCost: 100,
        edgeTotal: 20,
        hardwareTotal: 30,
        directCost: 150,
        laborModular: 50,
        laborFixedCost: 10,
        marginFactor: 1.3,
        salePrice: 400,
      },
    },
    productionRelease: {
      id: 'rel-1',
      projectId: 'p1',
      projectVersion: 3,
      designRevisionId: 'dr-1',
      bomFingerprint: 'fp-aaa',
      releasedBy: 'ing-1',
      releasedAt: '2026-08-20T11:00:00Z',
      checks: [],
    },
    ...overrides,
  } as Project;
}

function seededCostingProject(): Project {
  const captured = captureCostBaseline(makeProject(), { byUserId: 'mgr-1', at: '2026-08-21T12:00:00Z' });
  const withRate = setLaborRate(captured.project, { ratePerHour: 30 });
  const withTime = recordTimeEntry(withRate.project, { category: 'cut', minutes: 60, byName: 'Operario' });
  const withOther = recordOtherCost(withTime.project, { kind: 'freight', amount: 80, vendor: 'Transporte' });
  return withOther.project;
}

const BASIS_LABELS: Readonly<Record<string, string>> = {
  po_unit_cost: 'Costo OC',
  catalog: 'Catálogo',
};

function makeView(project: Project) {
  const material = valueMaterialConsumptions([
    { materialId: 'mat-po', quantity: 5, poUnitCost: 10 },
    { materialId: 'mat-cat', quantity: 2, catalogUnitCost: 8 },
  ]);
  const summary = computeJobCostSummary({
    baseline: project.costing?.baseline,
    timeEntries: project.costing?.timeEntries ?? [],
    laborRatePerHour: project.costing?.laborRatePerHour ?? 0,
    rework: { materialCost: 12, laborMinutes: 30 },
    material,
    otherCosts: project.costing?.otherCosts ?? [],
  });
  return costingPanelView(project, {
    summary,
    materialLines: material.lines.map((line) => ({
      ...line,
      basisLabel: BASIS_LABELS[line.basis] ?? line.basis,
    })),
    missingValuationMaterialIds: material.missingValuationMaterialIds,
  });
}

describe('CostingPanel (OC-080..OC-084)', () => {
  it('without costing: explains blockers and offers the primary capture action', () => {
    const onCapture = vi.fn();
    const project = makeProject({ priceSnapshot: undefined, productionRelease: undefined });
    const view = makeView(project);
    render(<CostingPanel view={view} handlers={{ onCaptureBaseline: onCapture }} />);

    expect(screen.getByText(/snapshot de cotización/i)).toBeTruthy();
    expect(screen.getByText(/liberar la revisión/i)).toBeTruthy();
    // Bloqueado: sin fuentes no hay botón de captura.
    expect(screen.queryByTestId('costing-capture-p1')).toBeNull();
  });

  it('with sources ready: capture button is the single primary action', () => {
    const onCapture = vi.fn();
    const view = makeView(makeProject());
    render(<CostingPanel view={view} handlers={{ onCaptureBaseline: onCapture }} />);

    const capture = screen.getByTestId('costing-capture-p1');
    expect(capture.className).toContain('btn--primary');
    fireEvent.click(capture);
    expect(onCapture).toHaveBeenCalledWith('p1');
  });

  it('renders the OC-084 estimate vs actual summary with variance direction', () => {
    const view = makeView(seededCostingProject());
    render(<CostingPanel view={view} handlers={{}} />);

    expect(screen.getByText('Ingresos').parentElement?.textContent).toContain('400');
    expect(screen.getByText('Costo directo estimado', { exact: false }).parentElement?.textContent).toContain('210');
    // 66 material + 12 rework + 45 labor (60+30 rework @30/h) + 80 flete = 203
    // → variance −7 (bajo presupuesto) y margen real 197.
    expect(screen.getByTestId('costing-variance-p1').textContent).toContain('7');
    expect(screen.getByTestId('costing-variance-p1').className).toContain('costing-panel__under');
    expect(screen.getByText('Margen bruto real').parentElement?.textContent).toContain('197');
    expect(screen.getByTestId('costing-baseline-source-p1').textContent).toContain('rel-1');
  });

  it('shows material truth badge and per-line valuation basis', () => {
    const view = makeView(seededCostingProject());
    render(<CostingPanel view={view} handlers={{}} labelsByMaterial={{ 'mat-po': 'MDF 18mm' }} />);

    expect(screen.getAllByText('Estimado (catálogo)').length).toBeGreaterThan(0);
    expect(screen.getByText('MDF 18mm')).toBeTruthy();
    expect(screen.getByText('Costo OC')).toBeTruthy();
  });

  it('records time entries and other costs through the handlers', () => {
    const onRecordTime = vi.fn();
    const onRecordOther = vi.fn();
    const view = makeView(seededCostingProject());
    render(
      <CostingPanel
        view={view}
        handlers={{ onRecordTime, onRecordOtherCost: onRecordOther }}
      />,
    );

    fireEvent.change(screen.getByTestId('costing-time-category-p1'), { target: { value: 'assembly' } });
    fireEvent.change(screen.getByTestId('costing-time-minutes-p1'), { target: { value: '90' } });
    fireEvent.click(screen.getByTestId('costing-time-save-p1'));
    expect(onRecordTime).toHaveBeenCalledWith('p1', { category: 'assembly', minutes: 90 });

    fireEvent.change(screen.getByTestId('costing-other-kind-p1'), { target: { value: 'outsource' } });
    fireEvent.change(screen.getByTestId('costing-other-amount-p1'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('costing-other-save-p1'));
    expect(onRecordOther).toHaveBeenCalledWith('p1', {
      kind: 'outsource',
      amount: 25,
      vendor: undefined,
    });
  });

  it('void buttons only appear for supervisors', () => {
    const onVoidTime = vi.fn();
    const view = makeView(seededCostingProject());
    const entryId = (view.timeEntries[0] as { id: string }).id;
    const { rerender } = render(
      <CostingPanel view={view} handlers={{ onVoidTime }} canVoid={false} />,
    );
    expect(screen.queryByTestId(`costing-time-void-${entryId}`)).toBeNull();

    rerender(<CostingPanel view={view} handlers={{ onVoidTime }} canVoid={true} />);
    fireEvent.click(screen.getByTestId(`costing-time-void-${entryId}`));
    expect(onVoidTime).toHaveBeenCalledWith('p1', entryId);
  });

  it('updates the shop hourly rate through the handler', () => {
    const onSetRate = vi.fn();
    const view = makeView(seededCostingProject());
    render(<CostingPanel view={view} handlers={{ onSetLaborRate: onSetRate }} />);

    fireEvent.change(screen.getByTestId('costing-rate-input-p1'), { target: { value: '35' } });
    fireEvent.click(screen.getByTestId('costing-rate-save-p1'));
    expect(onSetRate).toHaveBeenCalledWith('p1', 35);
  });

  it('summary stays honest: em-dash when labor cannot be priced', () => {
    const captured = captureCostBaseline(makeProject(), { at: '2026-08-21T12:00:00Z' });
    const withTime = recordTimeEntry(captured.project, { category: 'cnc', minutes: 60 });
    const view = makeView(withTime.project);

    render(<CostingPanel view={view} handlers={{}} />);
    expect(screen.getByText('Costo directo real').parentElement?.textContent).toContain('—');
    expect(screen.queryByTestId('costing-variance-p1')).toBeNull();
  });
});

describe('costingPanelView', () => {
  it('flags recapture as blocked while the same release keeps its baseline', () => {
    const project = seededCostingProject();
    const view = makeView(project);
    expect(view.canCaptureBaseline).toBe(false);
    expect(view.captureBlockers).toEqual([]);
  });

  it('allows recapture after a new release (change order)', () => {
    const project = seededCostingProject();
    const reReleased: Project = {
      ...project,
      productionRelease: {
        ...(project.productionRelease as NonNullable<Project['productionRelease']>),
        id: 'rel-2',
        bomFingerprint: 'fp-bbb',
      },
    };
    const view = makeView(reReleased);
    expect(view.canCaptureBaseline).toBe(true);
  });
});
