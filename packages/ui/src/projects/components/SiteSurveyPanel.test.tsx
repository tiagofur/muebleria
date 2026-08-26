// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SiteSurveyPanel, type SurveyHandlers } from './SiteSurveyPanel';
import type { SiteSurvey } from '@granete/domain';

afterEach(cleanup);

const handlers = (): SurveyHandlers => ({
  onStart: vi.fn(),
  onUpsertSpace: vi.fn(),
  onRemoveSpace: vi.fn(),
  onCaptureMeasures: vi.fn(),
  onVerify: vi.fn(),
  onApproveSpace: vi.fn(),
  onFreeze: vi.fn(),
});

function surveyWith(intent: SiteSurvey['spaces'][number]['intent']): SiteSurvey {
  return {
    id: 'svy-1',
    projectId: 'p1',
    revision: 2,
    createdAt: '2026-08-21T10:00:00Z',
    capturedByUserId: 'vend-1',
    spaces: [
      {
        id: 'spc-1',
        name: 'Cocina',
        intent,
        measures: { widthMm: 3200, heightMm: 2600 },
        preliminaryMeasures: { widthMm: 3150, heightMm: 2600 },
        elements: [{ id: 'elm-1', kind: 'opening', label: 'Ventana', widthMm: 1200, heightMm: 900 }],
        photoIds: [],
      },
    ],
  };
}

describe('SiteSurveyPanel (OC-040/OC-041)', () => {
  it('renders the empty state with the start CTA for capture roles', () => {
    const h = handlers();
    render(<SiteSurveyPanel projectId="p1" survey={undefined} handlers={h} canCapture />);
    expect(screen.getByText(/Sin levantamiento estructurado/i)).toBeTruthy();
    expect(screen.getByText(/una medida preliminar nunca llega a CNC/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Iniciar levantamiento/i }));
    expect(h.onStart).toHaveBeenCalledWith('p1');
  });

  it('hides the start CTA without permission', () => {
    render(<SiteSurveyPanel projectId="p1" survey={undefined} handlers={handlers()} />);
    expect(screen.queryByRole('button', { name: /Iniciar levantamiento/i })).toBeNull();
  });

  it('shows OC-041 blockers for a preliminary space and routes the fix', () => {
    render(
      <SiteSurveyPanel projectId="p1" survey={surveyWith('preliminary')} handlers={handlers()} canApprove />,
    );
    const blockers = screen.getByTestId('site-survey-blockers');
    expect(blockers.textContent).toContain('Cocina');
    expect(blockers.textContent).toContain('preliminares');
    expect(screen.queryByTestId('site-survey-ok')).toBeNull();
  });

  it('shows the ready state when the whole gate passes', () => {
    const survey = {
      ...surveyWith('fabrication'),
      verifiedAt: '2026-08-21T12:00:00Z',
      verifiedByUserId: 'ing-1',
      spaces: [{ ...surveyWith('fabrication').spaces[0]!, approvedAt: '2026-08-21T12:30:00Z', approvedByUserId: 'ing-1' }],
    };
    render(<SiteSurveyPanel projectId="p1" survey={survey} handlers={handlers()} />);
    expect(screen.getByTestId('site-survey-ok')).toBeTruthy();
    expect(screen.queryByTestId('site-survey-blockers')).toBeNull();
  });

  it('labels the intent and shows preliminary deviation side by side', () => {
    render(<SiteSurveyPanel projectId="p1" survey={surveyWith('field')} handlers={handlers()} />);
    expect(screen.getByText('Levantada en obra')).toBeTruthy();
    expect(screen.getByText('Preliminar').parentElement?.textContent).toContain('3,150');
  });

  it('captures field measures through the inline form', () => {
    const h = handlers();
    render(<SiteSurveyPanel projectId="p1" survey={surveyWith('preliminary')} handlers={h} canCapture />);
    fireEvent.click(screen.getByTestId('site-survey-capture-toggle'));
    fireEvent.change(screen.getByTestId('site-survey-width'), { target: { value: '3250' } });
    fireEvent.change(screen.getByTestId('site-survey-height'), { target: { value: '2600' } });
    fireEvent.click(screen.getByTestId('site-survey-capture-submit'));
    expect(h.onCaptureMeasures).toHaveBeenCalledWith('p1', 'spc-1', {
      widthMm: 3250,
      heightMm: 2600,
    });
  });

  it('rejects non-positive measures inline (validation before dispatch)', () => {
    const h = handlers();
    render(<SiteSurveyPanel projectId="p1" survey={surveyWith('preliminary')} handlers={h} canCapture />);
    fireEvent.click(screen.getByTestId('site-survey-capture-toggle'));
    fireEvent.change(screen.getByTestId('site-survey-width'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('site-survey-height'), { target: { value: '2600' } });
    fireEvent.click(screen.getByTestId('site-survey-capture-submit'));
    expect(h.onCaptureMeasures).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('mayores a cero');
  });

  it('adds a space and dispatches verify/approve with RBAC gates', () => {
    const h = handlers();
    render(<SiteSurveyPanel projectId="p1" survey={surveyWith('field')} handlers={h} canCapture canVerify canApprove />);
    fireEvent.change(screen.getByTestId('site-survey-new-space'), { target: { value: 'Closet' } });
    fireEvent.click(screen.getByRole('button', { name: /^Agregar/i }));
    expect(h.onUpsertSpace).toHaveBeenCalledWith('p1', { name: 'Closet' });

    fireEvent.click(screen.getByTestId('site-survey-verify'));
    expect(h.onVerify).toHaveBeenCalledWith('p1');

    fireEvent.click(screen.getByTestId('site-survey-approve'));
    expect(h.onApproveSpace).toHaveBeenCalledWith('p1', 'spc-1');
  });

  it('disables freeze while blockers remain and explains why', () => {
    const h = handlers();
    render(<SiteSurveyPanel projectId="p1" survey={surveyWith('preliminary')} handlers={h} canApprove />);
    const freeze = screen.getByTestId('site-survey-freeze') as HTMLButtonElement;
    expect(freeze.disabled).toBe(true);
    expect(freeze.title).toContain('preliminares');
    expect(h.onFreeze).not.toHaveBeenCalled();
  });
});
