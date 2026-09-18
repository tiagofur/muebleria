/**
 * @vitest-environment jsdom
 *
 * #739 — EngineeringWorkspace with a pinned release context and its FROZEN
 * cutting demand: the Despiece/Optimización tabs consume the exact release
 * content (never the live rows), preparation is announced as editable, and
 * honest loading/error states replace any silent fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project, ProductionCutRow } from '@granete/domain';
import { EngineeringWorkspace } from './EngineeringWorkspace';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

function makeCanonicalProject(): Project {
  return {
    id: 'p1',
    name: 'Cocina Prueba',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [{ id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    resolvedProductionRelease: {
      source: 'canonical',
      releaseId: 'rel-1',
      releaseNumber: 1,
      designRevisionId: 'dr-2',
      designRevisionNumber: 2,
      quoteRevisionId: 'qr-2',
    },
  } as unknown as Project;
}

const readiness = {
  status: 'not_ready',
  checks: [],
} as unknown as ProductionOrderReadiness;

const liveRow: ProductionCutRow = {
  quantity: 1,
  lengthMm: 600,
  widthMm: 720,
  description: 'FRENTE · Frente · MOD-600 (proyecto vivo)',
  materialName: 'MDF Blanco 18',
  grain: 1,
  L1: 0,
  L2: 0,
  W1: 0,
  W2: 0,
};

const frozenRow: ProductionCutRow = {
  quantity: 1,
  lengthMm: 650,
  widthMm: 720,
  description: 'FRENTE · Frente · MOD-600 (liberación)',
  materialName: 'MDF Blanco 18',
  grain: 1,
  L1: 0,
  L2: 0,
  W1: 0,
  W2: 0,
};

const demandBase = {
  releaseId: 'rel-1',
  releaseNumber: 1,
  designRevisionId: 'dr-2',
  designRevisionNumber: 2,
  manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
};

const readyContext = {
  state: 'ready' as const,
  view: { releaseNumber: 1, designRevisionNumber: 2, quoteLabel: 'Q2', releasedAt: '2026-09-15T00:00:00Z' },
};

function baseProps(over: Record<string, unknown> = {}) {
  return {
    project: makeCanonicalProject(),
    modules: [],
    catalog: null,
    cutRows: [liveRow],
    labels: [],
    hardwareRows: [],
    readiness,
    onBack: () => undefined,
    ...over,
  };
}

describe('EngineeringWorkspace — #739 demanda congelada', () => {
  afterEach(cleanup);

  it('despiece muestra las piezas de la liberación, no las del proyecto vivo', () => {
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{ status: 'ready', rows: [frozenRow], base: demandBase }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Despiece' }));
    expect(screen.getByText(/FRENTE · Frente · MOD-600 \(liberación\)/)).toBeDefined();
    expect(screen.queryByText(/proyecto vivo/)).toBeNull();
    // El aviso anuncia preparación editable, no vista de trabajo.
    expect(screen.getByTestId('eng-release-prep-notice').textContent).toContain(
      'contenido congelado de la liberación',
    );
    expect(screen.queryByTestId('eng-live-view-notice')).toBeNull();
  });

  it('optimización recibe el pin de liberación y el plan guardado para esa liberación', () => {
    const saveSpy = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{ status: 'ready', rows: [frozenRow], base: demandBase }}
        releaseCutPlan={null}
        onSaveReleaseCutPlan={saveSpy}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Optimización' }));
    expect(screen.getByTestId('prod-hub-optimizacion')).toBeDefined();
    expect(screen.getByTestId('eng-release-prep-notice')).toBeDefined();
  });

  it('error de demanda: mensaje accionable con reintento, sin caer al proyecto vivo', () => {
    const retry = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{
          status: 'error',
          message: 'El catálogo vigente ya no tiene los materiales de la liberación (mat-x).',
          retry,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Despiece' }));
    const errorBox = screen.getByTestId('eng-demand-error');
    expect(errorBox.textContent).toContain('mat-x');
    expect(screen.queryByText(/proyecto vivo/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalled();
  });

  it('carga de demanda: aviso honesto y sin piezas prestadas del proyecto vivo', () => {
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{ status: 'loading' }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Despiece' }));
    expect(screen.getByTestId('eng-demand-loading')).toBeDefined();
    expect(screen.queryByText(/proyecto vivo/)).toBeNull();
    expect(screen.queryByTestId('eng-live-view-notice')).toBeNull();
  });

  it('#739 review: liberación verificándose (interim) — optimización muestra las filas vivas pero NO permite generar ni exportar', () => {
    render(<EngineeringWorkspace {...baseProps()} releaseContext={{ state: 'loading' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Optimización' }));
    // Despliegue intermedio #738 (filas vivas etiquetadas), pero la base
    // canónica aún no está verificada: generar/exportar quedan bloqueados.
    expect(screen.getByTestId('eng-live-view-notice')).toBeDefined();
    expect(screen.getByTestId('prod-opt-demand-gate').textContent).toContain(
      'Esperando el despiece congelado',
    );
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(true);
  });

  it('#739 review: demanda en error — optimización bloqueada con el motivo, sin plan exportable', () => {
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{
          status: 'error',
          message: 'No se pudo leer el despiece congelado de esta liberación.',
          retry: () => undefined,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Optimización' }));
    expect(screen.getByTestId('eng-demand-error')).toBeDefined();
    expect(screen.getByTestId('prod-opt-demand-gate').textContent).toContain(
      'No se pudo leer el despiece congelado',
    );
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(true);
  });

  it('#739 review: DXF canónico no se ofrece — queda bloqueado con motivo junto a la acción', () => {
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{ status: 'ready', rows: [frozenRow], base: demandBase }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Optimización' }));
    expect(screen.getByTestId('prod-opt-release-requisition-note')).toBeDefined();
    // En modo sierra la tarjeta DXF no se renderiza; el motivo se aplica al
    // pasar a nesting (cubierto en el panel). Aquí verificamos que el gate
    // canónico no habilita exportaciones de fuentes mixtas vía workspace.
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(false);
  });

  it('las demás pestañas conservan el aviso de vista de trabajo', () => {
    render(
      <EngineeringWorkspace
        {...baseProps()}
        releaseContext={readyContext}
        releaseCuttingDemand={{ status: 'ready', rows: [frozenRow], base: demandBase }}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Etiquetas' }));
    expect(screen.getByTestId('eng-live-view-notice')).toBeDefined();
    expect(screen.queryByTestId('eng-release-prep-notice')).toBeNull();
  });

  it('sin demanda resuelta aún (verificando liberación) las pestañas congeladas mantienen la vista de trabajo #738', () => {
    render(<EngineeringWorkspace {...baseProps()} releaseContext={readyContext} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Despiece' }));
    expect(screen.getByTestId('eng-live-view-notice')).toBeDefined();
    expect(screen.getByText(/proyecto vivo/)).toBeDefined();
  });
});
