/**
 * @vitest-environment jsdom
 *
 * F111 — the Resumen tab's KPI totals row uses the shared .stat-card
 * vocabulary (common/statCard.css) with the engineering area variant
 * --eng, instead of the old local eng-resumen__stat family.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Project } from '@muebles/domain';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

import { EngineeringWorkspace } from './EngineeringWorkspace';

afterEach(cleanup);

const project = {
  id: 'p1',
  name: 'Cocina López',
  customerId: 'c1',
  status: 'accepted',
  currency: 'MXN',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  items: [],
} as unknown as Project;

const readiness = {
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
} satisfies ProductionOrderReadiness;

describe('EngineeringWorkspace — Resumen KPI stat cards (F111)', () => {
  it('renders totals as .stat-card with the --eng area variant', () => {
    const { container } = render(
      <EngineeringWorkspace
        project={project}
        modules={[]}
        catalog={null}
        cutRows={[]}
        labels={[]}
        hardwareRows={[]}
        readiness={readiness}
        onBack={() => undefined}
      />,
    );

    const cards = container.querySelectorAll('.stat-card.stat-card--eng');
    expect(cards.length).toBe(4);

    const values = [...container.querySelectorAll('.stat-card__value')].map(
      (el) => el.textContent,
    );
    const labels = [...container.querySelectorAll('.stat-card__label')].map(
      (el) => el.textContent,
    );

    // Value formatting unchanged: 3 módulos, cut rows '—' (empty cutRows).
    expect(values).toContain('3');
    expect(values).toContain('—');
    expect(labels.join(' ')).toContain('módulos');
    expect(labels.join(' ')).toContain('piezas de tablero');
    expect(labels.join(' ')).toContain('m² de tablero');
    expect(labels.join(' ')).toContain('ml de canto');

    // Old local stat family is gone.
    expect(container.querySelector('.eng-resumen__stat')).toBeNull();
    expect(container.querySelector('.eng-resumen__stat-icon')).toBeNull();
  });
});
