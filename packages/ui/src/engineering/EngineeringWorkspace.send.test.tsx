/**
 * @vitest-environment jsdom
 *
 * roadmap-screens 2a.15 — the engineering→factory handshake lives in the
 * workspace header: visible for accepted projects with the callback wired,
 * calls it on click, hidden once produced.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Project } from '@muebles/domain';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

import { EngineeringWorkspace } from './EngineeringWorkspace';

afterEach(cleanup);

function makeProject(status: Project['status']): Project {
  return {
    id: 'p1',
    name: 'Cocina López',
    customerId: 'c1',
    status,
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    items: [],
  } as unknown as Project;
}

const baseProps = {
  project: makeProject('accepted'),
  modules: [],
  catalog: null,
  cutRows: [],
  labels: [],
  hardwareRows: [],
  readiness: {
    cutListOk: true,
    cutListError: null,
    cutRowCount: 3,
    moduleUnitCount: 3,
    moduleLineCount: 3,
    materialsResolved: true,
    hasKitchenLayout: false,
    hasPlacements: false,
    layoutCheckOk: true,
    optimizerGenerable: true,
    packGenerable: true,
    readyToCut: true,
    hasUnplacedItems: false,
  } satisfies ProductionOrderReadiness,
  onBack: () => undefined,
};

describe('EngineeringWorkspace — Enviar a Producción (2a.15)', () => {
  it('renders the handshake button for accepted projects and fires it', () => {
    const onSendToProduction = vi.fn();
    render(
      <EngineeringWorkspace {...baseProps} onSendToProduction={onSendToProduction} />,
    );
    const btn = screen.getByTestId('eng-send-to-production');
    btn.click();
    expect(onSendToProduction).toHaveBeenCalledTimes(1);
  });

  it('hides the button once the project is produced', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={makeProject('produced')}
        onSendToProduction={() => undefined}
      />,
    );
    expect(screen.queryByTestId('eng-send-to-production')).toBeNull();
  });

  it('hides the button when the callback is not wired', () => {
    render(<EngineeringWorkspace {...baseProps} />);
    expect(screen.queryByTestId('eng-send-to-production')).toBeNull();
  });
});
